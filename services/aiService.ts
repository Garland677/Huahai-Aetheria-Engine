
import { GoogleGenAI } from "@google/genai";
import { 
    AIConfig, LogEntry, AppSettings, DefaultSettings, GlobalContextConfig, 
    GameState, Trigger, DebugLog, Provider, Character, Card, MapLocation, MapRegion, PrizePool,
    TurnAction, GameAttribute
} from "../types";
import { DEFAULT_AI_CONFIG } from "../config";
import { evaluateTriggers } from "./triggerService";
import { 
    formatCharacterPersona, formatLocationInfo, formatKnownRegions, 
    formatOtherCharacters, formatSelfDetailed, formatPrizePools,
    getVisibleAttributes, filterWorldAttributes 
} from "./contextUtils";

// Helper: Fill Prompt
export const fillPrompt = (template: string, data: Record<string, string>, settings?: AppSettings) => {
    let prompt = template;
    // Handle Global Variables
    if (settings && settings.globalVariables) {
        settings.globalVariables.forEach(v => {
            prompt = prompt.split(`{{${v.key}}}`).join(v.value);
        });
    }
    // Handle Data
    Object.entries(data).forEach(([key, val]) => {
        prompt = prompt.split(`{{${key}}}`).join(val);
    });
    return prompt;
};

// Helper: Build Context Messages
export const buildContextMessages = (
    globalContext: GlobalContextConfig, 
    characterContext: any, // contextConfig from Char
    prompt: string,
    settings?: AppSettings
) => {
    const messages = [];
    // 1. Global Context
    if (globalContext && globalContext.messages) {
        messages.push(...globalContext.messages);
    }
    // 2. Character Context (if any)
    if (characterContext && characterContext.messages) {
        messages.push(...characterContext.messages);
    }
    // 3. The Prompt (as User message)
    messages.push({ role: 'user', content: prompt });
    
    // Convert content to 'parts' for Gemini SDK compatibility
    return messages.map(m => ({ 
        role: m.role === 'model' ? 'model' : (m.role === 'system' ? 'system' : 'user'), 
        parts: [{ text: m.content }] 
    }));
};

interface UnifiedClient {
    models: {
        generateContent: (params: { model: string, contents: any[], config?: any }) => Promise<{ text: string }>
    }
}

export const createClient = (config: AIConfig, apiKeys: Record<string, string>): UnifiedClient => {
    const apiKey = config.apiKey || apiKeys[config.provider] || "";
    
    if (config.provider === Provider.GEMINI) {
        const ai = new GoogleGenAI({ apiKey });
        return {
            models: {
                generateContent: async (params) => {
                    const res = await ai.models.generateContent({
                        model: params.model,
                        contents: params.contents,
                        config: params.config
                    });
                    return { text: res.text || "" };
                }
            }
        }
    }
    
    // Fallback for OpenAI compatible providers
    return {
        models: {
            generateContent: async (params) => {
                const baseURLs: Record<string, string> = {
                    [Provider.XAI]: "https://api.x.ai/v1",
                    [Provider.OPENAI]: "https://api.openai.com/v1",
                    [Provider.OPENROUTER]: "https://openrouter.ai/api/v1",
                    [Provider.VOLCANO]: "https://ark.cn-beijing.volces.com/api/v3",
                    [Provider.CLAUDE]: "https://api.anthropic.com/v1"
                };
                
                const baseURL = baseURLs[config.provider] || "https://api.openai.com/v1";
                
                const messages = params.contents.map(c => {
                    // Try to extract text from parts (Gemini style) or content (Fallback)
                    const textContent = c.parts?.[0]?.text || c.content?.[0]?.text || (typeof c.content === 'string' ? c.content : "");
                    return {
                        role: c.role === 'model' ? 'assistant' : (c.role === 'system' ? 'system' : 'user'),
                        content: textContent
                    };
                });

                const response = await fetch(`${baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: params.model,
                        messages: messages,
                        temperature: config.temperature,
                        response_format: params.config?.responseMimeType === 'application/json' ? { type: "json_object" } : undefined
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`API Error: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                return { text: data.choices?.[0]?.message?.content || "" };
            }
        }
    }
}

export const robustGenerate = async <T>(
    callApi: () => Promise<{ text: string }>,
    validator: (json: any) => any,
    maxRetries: number = 3
): Promise<T | null> => {
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            const result = await callApi();
            let text = result.text;
            // Clean markdown code blocks if present
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const json = JSON.parse(text);
            const validated = validator(json);
            if (validated) return json as T;
        } catch (e) {
            console.warn(`Generate attempt ${attempts + 1} failed:`, e);
        }
        attempts++;
    }
    return null;
};

// --- Memory Functions ---

export const getGlobalMemory = (history: LogEntry[], currentRound: number, roundsToKeep: number = 20): string => {
    const minRound = Math.max(1, currentRound - roundsToKeep);
    return history
        .filter(e => e.round >= minRound)
        .slice(-50) // Limit to last 50 entries to fit context
        .map(entry => `[R${entry.round} T${entry.turnIndex}] ${entry.content}`)
        .join('\n');
};

/**
 * Extracts character-specific memory based on Rounds.
 * Logic:
 * 1. Groups logs by Round.
 * 2. Checks if the character was present in that Round (location match or explicit presence).
 * 3. If present, includes the ENTIRE round's logs to ensure context integrity.
 * 4. Limits to the last `roundsToKeep` qualified rounds.
 */
export const getCharacterMemory = (history: LogEntry[], charId: string, currentLocationId?: string, roundsToKeep: number = 20): string => {
    if (!history || history.length === 0) return "";

    // 1. Group by Round
    const roundsMap = new Map<number, LogEntry[]>();
    history.forEach(entry => {
        if (!roundsMap.has(entry.round)) {
            roundsMap.set(entry.round, []);
        }
        roundsMap.get(entry.round)?.push(entry);
    });

    // 2. Filter Rounds based on Presence
    const qualifiedRounds: LogEntry[][] = [];
    const sortedRoundNumbers = Array.from(roundsMap.keys()).sort((a, b) => b - a); // Descending (newest first)

    for (const roundNum of sortedRoundNumbers) {
        const roundLogs = roundsMap.get(roundNum) || [];
        let isPresent = false;

        // Check each log in the round for presence indicators
        for (const log of roundLogs) {
            // A. Explicit presence tag in log
            if (log.presentCharIds && log.presentCharIds.includes(charId)) {
                isPresent = true;
                break;
            }
            // B. Location Match (Spatial Presence)
            // If the log happened at a location, and the character is currently at that location (or was), they saw it.
            // Note: Since we don't track historical position per round efficiently, we use currentLocationId as the primary filter for "Local Memory".
            // Ideally, we assume if a character is at a location, they know the recent history of that location.
            if (currentLocationId && log.locationId === currentLocationId) {
                isPresent = true;
                break;
            }
            // C. Global System Logs (Round Start/End usually have no location, but define structure)
            // We include them ONLY if we decided the character was present in this round via other logs, 
            // OR if it's a generic system message. 
            // However, to build a *Round*, we need to decide inclusion first.
        }

        // D. Special Case: Environment Characters always see their location's logs
        if (!isPresent && charId.startsWith('env_')) {
             const suffix = charId.replace('env_', '');
             // If any log in this round belongs to this location ID
             if (roundLogs.some(l => l.locationId === suffix)) {
                 isPresent = true;
             }
        }

        if (isPresent) {
            qualifiedRounds.push(roundLogs);
        }

        if (qualifiedRounds.length >= roundsToKeep) break;
    }

    // 3. Format Output (Reverse back to chronological order)
    return qualifiedRounds
        .reverse()
        .flat()
        .map(entry => {
            // Simplify timestamp for AI
            // const timeStr = new Date(entry.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            return `[R${entry.round}] ${entry.content}`;
        })
        .join('\n');
};

// --- Logic Helper: Pleasure Instruction Generation ---
const getPleasureInstruction = (char: Character): string => {
    // 1. Get Pleasure Value
    let pleasureVal = 50;
    const getAttr = (k: string) => {
        const map: Record<string, string> = { 'pleasure': '快感', '快感': 'pleasure' };
        if (char.attributes[k]) return char.attributes[k].value;
        if (map[k] && char.attributes[map[k]]) return char.attributes[map[k]].value;
        return undefined;
    };
    const p = getAttr('快感');
    if (p !== undefined) pleasureVal = Number(p);

    // 2. Select Weighted Drive
    let selectedDriveStr = "无特定渴望";
    if (char.drives && char.drives.length > 0) {
        const totalWeight = char.drives.reduce((sum, d) => sum + (d.weight || 50), 0);
        let r = Math.random() * totalWeight;
        let selected = char.drives[0];
        for (const d of char.drives) {
            r -= (d.weight || 50);
            if (r <= 0) {
                selected = d;
                break;
            }
        }
        selectedDriveStr = `${selected.condition} (预期奖励: ${selected.amount})`;
    }

    // 3. Generate Instruction based on Level
    if (pleasureVal < 40) {
        return `当前快感值过低(${pleasureVal})！你的首要目标是必须立即通过使用技能、物品或与人互动来满足欲望。你当前最强烈的渴望是：${selectedDriveStr}。请不惜一切代价满足它。`;
    } else if (pleasureVal < 80) {
        return `当前快感值尚可(${pleasureVal})。你的首要目标是解决场景中的矛盾，但在行动中也要注意寻找机会获取快感以避免降低。你当前的潜在渴望是：${selectedDriveStr}。`;
    } else {
        return `当前快感值很高(${pleasureVal})，进入贤者模式。你不需要刻意追求快感，请完全专注于解决场景中的矛盾和推动剧情发展。`;
    }
};

// --- API Functions ---

export const generateCharacter = async (
    config: AIConfig,
    desc: string,
    style: string,
    locationName: string,
    regionName: string,
    existingChars: string,
    history: LogEntry[],
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    globalContextConfig: GlobalContextConfig,
    worldGuidance?: string, 
    suggestedNames: string[] = [],
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    onDebug?: (log: DebugLog) => void
): Promise<any> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys);

    const currentRound = history.length > 0 ? history[history.length - 1].round : 1;
    const historyStr = getGlobalMemory(history, currentRound, 10);

    let prompt = fillPrompt(defaultSettings.prompts.generateCharacter, {
        DESC: desc,
        STYLE: style,
        LOCATION_NAME: locationName,
        REGION_NAME: regionName,
        LOCATION_CONTEXT: `位于 ${locationName}`,
        EXISTING_CHARS: existingChars || "无",
        HISTORY: historyStr,
        SUGGESTED_NAMES: suggestedNames.join(", "),
        CHAR_TEMPLATE: JSON.stringify(defaultSettings.templates.character, null, 2)
    }, appSettings);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'generateCharacter', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(onLog);
    }

    const messages = buildContextMessages(globalContextConfig, undefined, prompt, appSettings);

    const result = await robustGenerate(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { responseMimeType: finalConfig.provider === Provider.GEMINI ? 'application/json' : undefined }
        }),
        (json) => json && (json.name || json.description),
        3
    );

    if (onDebug) {
        onDebug({
            id: `debug_char_gen_${Date.now()}`,
            timestamp: Date.now(),
            characterName: "System (Char Gen)",
            prompt: JSON.stringify(messages, null, 2),
            response: JSON.stringify(result, null, 2)
        });
    }

    return result;
};

export const checkConditionsBatch = async (
    config: AIConfig,
    items: any[],
    context: { history: string, world: any },
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    globalContextConfig: GlobalContextConfig,
    entitiesContext: Record<string, any>,
    onDebug?: (log: DebugLog) => void,
    strictMode: boolean = false,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<any> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys);

    let prompt = fillPrompt(defaultSettings.prompts.checkConditionsBatch, {
        SHORT_HISTORY: context.history,
        WORLD: JSON.stringify(context.world, null, 2),
        ENTITIES: JSON.stringify(entitiesContext, null, 2),
        ITEMS: JSON.stringify(items, null, 2)
    }, appSettings);

    if (strictMode) {
        prompt += `\n${defaultSettings.prompts.checkConditionsStrictInstruction}`;
    }

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'checkConditionsBatch', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(onLog);
    }

    const messages = buildContextMessages(globalContextConfig, undefined, prompt, appSettings);

    const result = await robustGenerate<{ results: any }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { responseMimeType: finalConfig.provider === Provider.GEMINI ? 'application/json' : undefined }
        }),
        (json) => json && json.results,
        3
    );

    if (onDebug) {
        onDebug({
            id: `debug_chk_${Date.now()}`,
            timestamp: Date.now(),
            characterName: "System (Logic)",
            prompt: JSON.stringify(messages, null, 2),
            response: JSON.stringify(result, null, 2)
        });
    }

    return result ? result.results : {};
};

export const determineCharacterAction = async (
    char: Character,
    history: LogEntry[],
    worldAttributes: Record<string, GameAttribute>,
    otherChars: Character[],
    globalContextConfig: GlobalContextConfig,
    cardPool: Card[],
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    worldGuidance?: string,
    currentLocation?: MapLocation,
    nearbyContext?: string,
    knownRegions?: Record<string, MapRegion>,
    prizePools?: Record<string, PrizePool>,
    allLocations?: Record<string, MapLocation>,
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<TurnAction> => {
    const finalConfig = char.aiConfig?.provider ? char.aiConfig : (fullGameState?.judgeConfig || DEFAULT_AI_CONFIG);
    const client = createClient(finalConfig, appSettings.apiKeys);

    // REMOVED: Global History Generation
    // const currentRound = history.length > 0 ? history[history.length - 1].round : 1;
    // const historyStr = getGlobalMemory(history, currentRound, appSettings.maxHistoryRounds);
    
    // Filter pools at current location
    const locationId = fullGameState?.map.charPositions[char.id]?.locationId;
    const poolsStr = formatPrizePools(prizePools, locationId, allLocations);

    // Get Filtered Character Memory (Strictly rounds experienced)
    const memoryStr = getCharacterMemory(history, char.id, locationId, appSettings.maxCharacterMemoryRounds);

    // Calculate Pleasure Instruction
    const pleasureInstruction = getPleasureInstruction(char);

    let prompt = fillPrompt(defaultSettings.prompts.determineCharacterAction, {
        // HISTORY: historyStr, // REMOVED GLOBAL HISTORY INJECTION
        WORLD_STATE: JSON.stringify(filterWorldAttributes(worldAttributes), null, 2),
        SELF_CONTEXT: formatSelfDetailed(char, cardPool, locationId),
        LOCATION_CONTEXT: formatLocationInfo(currentLocation),
        KNOWN_REGIONS: formatKnownRegions(knownRegions),
        NEARBY_CONTEXT: nearbyContext || "未知",
        OTHERS_CONTEXT: formatOtherCharacters(char.id, otherChars, locationId, cardPool),
        HISTORY_CONTEXT: memoryStr, // Only Character Memory
        SPECIFIC_CONTEXT: formatCharacterPersona(char),
        SHOP_CONTEXT: "（此处可列出商店物品，暂略）", 
        PRIZE_POOLS: poolsStr,
        COST: String(defaultSettings.gameplay.defaultCreationCost),
        PLEASURE_GOAL: pleasureInstruction
    }, appSettings);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'determineCharacterAction', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(onLog);
    }

    const messages = buildContextMessages(globalContextConfig, char.contextConfig, prompt, appSettings);

    const result = await robustGenerate<TurnAction>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { responseMimeType: finalConfig.provider === Provider.GEMINI ? 'application/json' : undefined }
        }),
        (json) => json && (json.narrative || json.speech || json.commands),
        3
    );

    if (onDebug) {
        onDebug({
            id: `debug_act_${char.name}_${Date.now()}`,
            timestamp: Date.now(),
            characterName: char.name,
            prompt: JSON.stringify(messages, null, 2),
            response: JSON.stringify(result, null, 2)
        });
    }

    return result || { narrative: "...", commands: [] };
};

export const determineCharacterReaction = async (
    char: Character,
    triggerEvent: string,
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    worldAttributes: Record<string, GameAttribute>,
    history: LogEntry[],
    locationId: string | undefined,
    memoryRounds: number,
    onDebug?: (log: DebugLog) => void,
    otherChars?: Character[],
    cardPool?: Card[],
    globalContextConfig?: GlobalContextConfig,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<string> => {
    const finalConfig = char.aiConfig?.provider ? char.aiConfig : (fullGameState?.judgeConfig || DEFAULT_AI_CONFIG);
    const client = createClient(finalConfig, appSettings.apiKeys);

    // Use getCharacterMemory for Reaction Context as well to ensure consistency
    const memoryStr = getCharacterMemory(history, char.id, locationId, memoryRounds);
    const othersStr = otherChars ? formatOtherCharacters(char.id, otherChars, locationId, cardPool) : "无";
    
    // Calculate Pleasure Instruction
    const pleasureInstruction = getPleasureInstruction(char);

    let prompt = fillPrompt(defaultSettings.prompts.determineCharacterReaction, {
        CHAR_NAME: char.name,
        CHAR_ID: char.id,
        CHAR_DESC: char.description,
        PLEASURE_GOAL: pleasureInstruction,
        WORLD_STATE: JSON.stringify(filterWorldAttributes(worldAttributes), null, 2),
        OTHERS_CONTEXT: othersStr,
        RECENT_HISTORY: memoryStr, // Use filtered memory
        TRIGGER_EVENT: triggerEvent
    }, appSettings);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'determineCharacterReaction', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(onLog);
    }

    const messages = buildContextMessages(globalContextConfig || { messages: [] }, char.contextConfig, prompt, appSettings);

    const result = await robustGenerate<{ speech: string }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { responseMimeType: finalConfig.provider === Provider.GEMINI ? 'application/json' : undefined }
        }),
        (json) => json && json.speech,
        2
    );

    if (onDebug) {
        onDebug({
            id: `debug_react_${char.name}_${Date.now()}`,
            timestamp: Date.now(),
            characterName: char.name,
            prompt: JSON.stringify(messages, null, 2),
            response: JSON.stringify(result, null, 2)
        });
    }

    return result ? result.speech : "";
};

export const determineTurnOrder = async (
    config: AIConfig,
    history: LogEntry[],
    currentOrder: string[],
    defaultOrder: string[],
    characters: Record<string, Character>,
    appSettings: AppSettings,
    worldAttributes: Record<string, GameAttribute>,
    defaultSettings: DefaultSettings,
    globalContextConfig: GlobalContextConfig,
    locationContext?: { name: string, activeCharIds: string[] },
    worldGuidance?: string,
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<{ order: string[], worldUpdates?: Record<string, any> }> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys);

    const activeIds = locationContext ? locationContext.activeCharIds : Object.keys(characters);
    const activeCharsList = activeIds.map(id => {
        const c = characters[id];
        return `${c.name} (ID: ${c.id}) - CP: ${c.attributes['cp']?.value || 0}, Health: ${c.attributes['health']?.value || 0}`;
    }).join('\n');

    let prompt = fillPrompt(defaultSettings.prompts.determineTurnOrder, {
        WORLD_STATE: JSON.stringify(worldAttributes, null, 2),
        LOCATION_NAME: locationContext ? locationContext.name : "未知",
        ACTIVE_CHARS: activeIds.join(", "),
        CHAR_LIST: activeCharsList,
        HISTORY: getGlobalMemory(history, history[history.length-1].round, 10)
    }, appSettings);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'determineTurnOrder', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(onLog);
    }

    const messages = buildContextMessages(globalContextConfig, undefined, prompt, appSettings);

    const result = await robustGenerate<{ order: string[], worldUpdates?: Record<string, any> }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { responseMimeType: finalConfig.provider === Provider.GEMINI ? 'application/json' : undefined }
        }),
        (json) => json && Array.isArray(json.order),
        3
    );

    if (onDebug) {
        onDebug({
            id: `debug_order_${Date.now()}`,
            timestamp: Date.now(),
            characterName: "System (Order)",
            prompt: JSON.stringify(messages, null, 2),
            response: JSON.stringify(result, null, 2)
        });
    }

    return result || { order: defaultOrder };
};

export const generateLocationDetails = async (
    config: AIConfig,
    coords: { x: number, y: number, z: number },
    history: LogEntry[],
    worldAttributes: Record<string, GameAttribute>,
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    globalContextConfig: GlobalContextConfig,
    worldGuidance: string,
    needsRegionGen: boolean,
    regionInfo: { name: string, description: string } | undefined,
    terrainAnalysis: any,
    regionStats: any,
    existingCharsContext: string,
    suggestedNames: string[],
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<{ name: string, description: string, region?: { name: string, description: string } }> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys);

    let prompt = fillPrompt(defaultSettings.prompts.generateLocationDetails, {
        X: coords.x.toFixed(0),
        Y: coords.y.toFixed(0),
        Z: coords.z.toFixed(0),
        WORLD_GUIDANCE: worldGuidance || "",
        REGION_CONTEXT_INSTRUCTION: regionInfo ? defaultSettings.prompts.instruction_existingRegionContext : "",
        REGION_GEN_INSTRUCTION: needsRegionGen ? defaultSettings.prompts.instruction_generateNewRegion : "",
        REGION_NAME: regionInfo?.name || "",
        REGION_DESC: regionInfo?.description || "",
        REGION_STATS_CONTEXT: regionStats ? `区域统计: ${JSON.stringify(regionStats)}` : "",
        TERRAIN_ANALYSIS: JSON.stringify(terrainAnalysis, null, 2),
        EXISTING_CHARS_CONTEXT: existingCharsContext ? defaultSettings.prompts.context_nearbyCharacters.replace("{{CHARS_LIST}}", existingCharsContext) : "",
    }, appSettings);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'generateLocationDetails', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(onLog);
    }

    const messages = buildContextMessages(globalContextConfig, undefined, prompt, appSettings);

    const result = await robustGenerate<{ name: string, description: string, region?: any }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { responseMimeType: finalConfig.provider === Provider.GEMINI ? 'application/json' : undefined }
        }),
        (json) => json && json.name && json.description,
        3
    );

    if (onDebug) {
        onDebug({
            id: `debug_loc_${Date.now()}`,
            timestamp: Date.now(),
            characterName: "System (Location)",
            prompt: JSON.stringify(messages, null, 2),
            response: JSON.stringify(result, null, 2)
        });
    }

    return result || { name: "未知", description: "生成失败" };
};

export const analyzeSettlement = async (
    config: AIConfig,
    history: LogEntry[],
    activeConflicts: any[],
    activeDrives: any[],
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    worldAttributes: Record<string, GameAttribute>,
    globalContextConfig: GlobalContextConfig,
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<{ solvedConflictIds: string[], fulfilledDriveIds: string[] } | null> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys);

    let prompt = fillPrompt(defaultSettings.prompts.analyzeSettlement, {
        WORLD_STATE: JSON.stringify(worldAttributes, null, 2),
        HISTORY: getGlobalMemory(history, history[history.length-1].round, 5),
        CONFLICTS_LIST: JSON.stringify(activeConflicts, null, 2),
        DRIVES_LIST: JSON.stringify(activeDrives, null, 2)
    }, appSettings);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'analyzeSettlement', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(onLog);
    }

    const messages = buildContextMessages(globalContextConfig, undefined, prompt, appSettings);

    const result = await robustGenerate<{ solvedConflictIds: string[], fulfilledDriveIds: string[] }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { responseMimeType: finalConfig.provider === Provider.GEMINI ? 'application/json' : undefined }
        }),
        (json) => json && (Array.isArray(json.solvedConflictIds) || Array.isArray(json.fulfilledDriveIds)),
        3
    );

    if (onDebug) {
        onDebug({
            id: `debug_settle_${Date.now()}`,
            timestamp: Date.now(),
            characterName: "System (Settlement)",
            prompt: JSON.stringify(messages, null, 2),
            response: JSON.stringify(result, null, 2)
        });
    }

    return result;
};
