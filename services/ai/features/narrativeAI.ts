

import { Character, LogEntry, GameAttribute, Card, AppSettings, DefaultSettings, MapLocation, MapRegion, GameState, AIConfig, DebugLog, StoryTag, Trigger } from "../../../types";
import { createClient, robustGenerate, supportsJsonMode } from "../core";
import { buildContextMessages, parsePromptStructure, replaceGlobalVariables } from "../promptUtils";
import { DEFAULT_AI_CONFIG } from "../../../config";
import { ImageContextBuilder } from "../ImageContextBuilder";
import { processMacros, MacroContext } from "../../macroService";
import { formatCharacterSecrets } from "../../contextUtils";
import { evaluateTriggers } from "../../triggerService";

export const generateObservation = async (
    char: Character,
    query: string,
    history: LogEntry[],
    worldAttributes: Record<string, GameAttribute>,
    globalContextConfig: any,
    cardPool: Card[],
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    currentLocation?: MapLocation,
    knownRegions?: Record<string, MapRegion>,
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<string> => {
    // Priority: Char Override > Global Behavior > Global Judge
    // Updated: Uses charBehaviorConfig (Character Behavior AI) as primary fallback
    const finalConfig = (char.useAiOverride && char.aiConfig?.provider)
        ? char.aiConfig
        : (fullGameState?.charBehaviorConfig || fullGameState?.judgeConfig || DEFAULT_AI_CONFIG);

    const client = createClient(finalConfig, appSettings.apiKeys, appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }
    
    const imageBuilder = new ImageContextBuilder();

    const gameStateForMacro = fullGameState || {
        world: { attributes: worldAttributes, history: history, worldGuidance: "" },
        map: { 
            locations: currentLocation ? { [currentLocation.id]: currentLocation } : {}, 
            regions: knownRegions || {}, 
            charPositions: {}, 
            activeLocationId: currentLocation?.id 
        },
        characters: { [char.id]: char },
        round: { roundNumber: 1, activeCharId: char.id },
        appSettings: appSettings,
        defaultSettings: defaultSettings,
        cardPool: cardPool
    } as unknown as GameState;

    const ctx: MacroContext = {
        gameState: gameStateForMacro,
        activeCharId: char.id,
        activeLocationId: currentLocation?.id,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            query: query,
            // secretContext removed; rely on {{SCENE_SECRETS}} in prompt
        }
    };

    let prompt = processMacros(defaultSettings.prompts.observation, ctx);

    // --- TRIGGER EVALUATION (New) ---
    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'observation', onTriggerUpdate, char.id);
        prompt += promptSuffix;
        // Inject logs if any
        if (logs.length > 0 && onLog) {
            logs.forEach(log => onLog(log.content));
        }
    }

    const promptParts = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
    const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, char.contextConfig, promptParts, appSettings);

    const genConfig = {
        maxOutputTokens: appSettings.maxOutputTokens,
        responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined
    };

    const result = await robustGenerate<{ content: string }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: genConfig
        }),
        (json) => json && typeof json.content === 'string' && json.content.length > 0,
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_obs_fail_${char.name}_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Observation Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_obs_${char.name}_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Observation)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    return result ? result.content : "（观测无法聚焦...）";
};

export const generateUnveil = async (
    config: AIConfig,
    history: LogEntry[],
    selectedLogs: string,
    targetCharsContext: string,
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    globalContextConfig: any,
    onDebug?: (log: DebugLog) => void,
    playerIntent?: string,
    fullGameState?: GameState
): Promise<{ results: Array<{ charId: string, unveilText: string }> } | null> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys, appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }
    
    const imageBuilder = new ImageContextBuilder();

    const gameStateForMacro = fullGameState || {
        world: { attributes: {}, history: history, worldGuidance: "" },
        map: { locations: {}, regions: {}, charPositions: {} },
        characters: {},
        round: { roundNumber: 1 },
        appSettings: appSettings,
        defaultSettings: defaultSettings
    } as unknown as GameState;

    const ctx: MacroContext = {
        gameState: gameStateForMacro,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            selectedLogs: selectedLogs,
            targetCharsContext: targetCharsContext,
            // Short History is handled by macro SHORT_HISTORY using gameState history
        }
    };

    let prompt = processMacros(defaultSettings.prompts.generateUnveil, ctx);

    if (playerIntent && playerIntent.trim()) {
        const processedIntent = replaceGlobalVariables(playerIntent, appSettings);
        prompt += `\n\n[要求的揭露内容 / Player Specific Request]\n${processedIntent}`;
    }

    const promptParts = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
    const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, undefined, promptParts, appSettings);

    const result = await robustGenerate<{ results: Array<{ charId: string, unveilText: string }> }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: appSettings.maxOutputTokens
            }
        }),
        (json) => json && Array.isArray(json.results),
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_unveil_fail_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Unveil Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_unveil_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Unveil)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    return result;
};

export const generateStorySuggest = async (
    gameState: GameState,
    onDebug?: (log: DebugLog) => void,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<{ funsuggest: string, tagsuggest: string[], comingchar?: string[] } | null> => {
    const finalConfig = gameState.charGenConfig || gameState.judgeConfig || DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, gameState.appSettings.apiKeys, gameState.appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = gameState.appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }

    const imageBuilder = new ImageContextBuilder();

    // Prepare Secrets Context logic removed.
    // SCENE_SECRETS macro now handles this automatically based on activeLocationId.

    const ctx: MacroContext = {
        gameState: gameState,
        activeLocationId: gameState.map.activeLocationId,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            // secretContext removed; rely on {{SCENE_SECRETS}}
        }
    };
    
    let prompt = processMacros(gameState.defaultSettings.prompts.storysuggest, ctx);

    // --- TRIGGER EVALUATION ---
    const { promptSuffix, logs } = evaluateTriggers(gameState, 'storysuggest', onTriggerUpdate);
    prompt += promptSuffix;
    if (logs.length > 0 && onLog) {
        logs.forEach(log => onLog(log.content));
    }

    const promptParts = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
    const messages = buildContextMessages(gameState.globalContext, finalConfig.contextConfig, undefined, promptParts, gameState.appSettings);

    const result = await robustGenerate<{ funsuggest: string, tagsuggest: string[], comingchar?: string[] }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: gameState.appSettings.maxOutputTokens
            }
        }),
        (json) => json && (json.funsuggest || (Array.isArray(json.tagsuggest))),
        3,
        (error, rawResponse) => {
             if (onDebug) {
                onDebug({
                    id: `debug_suggest_fail_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Story Suggest Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                let debugContent = JSON.stringify(rawResponse, null, 2);
                onDebug({
                    id: `debug_suggest_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Story Suggest)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: debugContent
                });
            }
        }
    );

    return result;
};
