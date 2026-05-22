

import { AIConfig, Character, LogEntry, GameAttribute, Card, MapLocation, MapRegion, PrizePool, TurnAction, AppSettings, DefaultSettings, GameState, Trigger, DebugLog, Secret, TriggerEffect } from "../../../types";
import { createClient, robustGenerate, supportsJsonMode, dispatchAIStatus } from "../core";
import { buildContextMessages, parsePromptStructure } from "../promptUtils";
import { evaluateTriggers } from "../../triggerService";
import { DEFAULT_AI_CONFIG } from "../../../config";
import { processMacros, MacroContext } from "../../macroService";
import { ImageContextBuilder } from "../ImageContextBuilder";

// Helper to extract JSON-like string content from partial stream buffer
const extractStreamContent = (buffer: string, key: 'narrative' | 'speech'): string => {
    const keyRegex = new RegExp(`"${key}"\\s*:\\s*"`);
    const match = keyRegex.exec(buffer);
    if (!match) return "";
    
    const startIdx = match.index + match[0].length;
    let content = "";
    let isEscaped = false;
    
    for (let i = startIdx; i < buffer.length; i++) {
        const char = buffer[i];
        if (isEscaped) {
            switch (char) {
                case 'n': content += '\n'; break;
                case 'r': content += '\r'; break;
                case 't': content += '\t'; break;
                case 'b': content += '\b'; break;
                case 'f': content += '\f'; break;
                case '"': content += '"'; break;
                case '\\': content += '\\'; break;
                case '/': content += '/'; break;
                case 'u':
                    if (i + 4 < buffer.length) {
                        const hex = buffer.substring(i + 1, i + 5);
                        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                            content += String.fromCharCode(parseInt(hex, 16));
                            i += 4;
                        } else {
                            content += 'u';
                        }
                    } else {
                        content += 'u';
                    }
                    break;
                default:
                    content += char;
            }
            isEscaped = false;
        } else {
            if (char === '\\') {
                isEscaped = true;
            } else if (char === '"') {
                break;
            } else {
                content += char;
            }
        }
    }
    return content;
};

export const determineCharacterAction = async (
    char: Character,
    history: LogEntry[],
    worldAttributes: Record<string, GameAttribute>,
    globalContextConfig: any,
    cardPool: Card[],
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    worldGuidance?: string,
    currentLocation?: MapLocation,
    knownRegions?: Record<string, MapRegion>,
    prizePools?: Record<string, PrizePool>,
    allLocations?: Record<string, MapLocation>,
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    onStream?: (text: string) => void,
    shouldAbort?: () => boolean,
    onEffects?: (effects: TriggerEffect[]) => void // New callback for trigger effects
): Promise<TurnAction> => {
    // Priority: Char Override > Global Behavior Config > Global Judge Config > Default
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

    // --- Action Memory Logic (Dropout) ---
    const isEnv = char.id.startsWith('env_');
    
    // 1. Determine Capacity
    let capacity = appSettings.maxCharacterMemoryRounds;
    if (char.memoryConfig?.useOverride) {
        capacity = char.memoryConfig.maxMemoryRounds;
    } else if (isEnv) {
        capacity = appSettings.maxEnvMemoryRounds ?? 5; 
    }

    // 2. Determine Dropout Rate
    const dropoutProb = char.memoryConfig?.useOverride 
        ? (char.memoryConfig.actionDropoutProbability ?? 0.34)
        : (appSettings.actionMemoryDropoutProbability ?? 0.34);

    let effectiveMemoryRounds = capacity;
    
    // 3. Apply Dropout
    if (Math.random() < dropoutProb) {
        effectiveMemoryRounds = 4; // Force short memory
        if (onDebug) {
            onDebug({
                id: `debug_dropout_act_${char.name}_${Date.now()}`,
                timestamp: Date.now(),
                characterName: "System (Action Dropout)",
                prompt: "Action Memory Dropout Triggered",
                response: `Memory reduced from ${capacity} to ${effectiveMemoryRounds} rounds.`
            });
        }
    }
    // -----------------------------------
    
    // Apply Context Window Override from Custom Endpoint if available
    let tokenLimit = appSettings.maxInputTokens;
    if (customEndpointConfig && customEndpointConfig.contextWindow) {
        tokenLimit = customEndpointConfig.contextWindow;
    }

    // Construct Macro Context
    const gameStateForMacro = fullGameState || {
        world: { attributes: worldAttributes, history: history, worldGuidance: worldGuidance || "" },
        map: { 
            locations: allLocations || {}, 
            regions: knownRegions || {}, 
            charPositions: {}, 
            activeLocationId: currentLocation?.id || "" 
        },
        characters: { [char.id]: char }, // Minimal
        round: { roundNumber: 1, activeCharId: char.id },
        appSettings: { ...appSettings, maxInputTokens: tokenLimit }, // Use local overridden limit
        defaultSettings: defaultSettings,
        cardPool: cardPool,
        prizePools: prizePools || {}
    } as unknown as GameState;

    const ctx: MacroContext = {
        gameState: gameStateForMacro,
        activeCharId: char.id,
        activeLocationId: currentLocation?.id,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            memoryRounds: effectiveMemoryRounds,
            // Inject streaming flag to help Time Utils ignore the current placeholder
            isStreaming: appSettings.enableStreaming !== false
        }
    };

    const promptTemplate = isEnv 
        ? defaultSettings.prompts.determineEnvAction 
        : (char.isProfessional 
            ? defaultSettings.prompts.determineCharacterActionPro 
            : defaultSettings.prompts.determineCharacterAction);

    // --- TRIGGER EVALUATION ---
    if (fullGameState) {
        // 1. Evaluate Triggers
        const { promptSuffix, guidanceSuffix, logs, effects } = evaluateTriggers(fullGameState, 'determineCharacterAction', onTriggerUpdate, char.id);
        
        // 2. Inject Guidance into Macro Context (Non-Urgent)
        if (guidanceSuffix) {
            ctx.dynamicParams = { ...ctx.dynamicParams, triggerGuidance: guidanceSuffix };
        }

        // 3. Process Prompt (This resolves WORLD_GUIDANCE with injected guidance)
        let prompt = processMacros(promptTemplate, ctx);
        
        // 4. Append Prompt Suffix (Urgent)
        prompt += promptSuffix;
        
        // 5. Handle Logs and Effects
        if (logs.length > 0 && onLog) logs.forEach(log => onLog(log.content));
        if (effects.length > 0 && onEffects) onEffects(effects); // Execute effects

        // Continue to API call...
        const promptMessages = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
        const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, char.contextConfig, promptMessages, appSettings);
        
        // ... (Rest of existing AI call logic)
        const requestId = `act_${char.id}_${Date.now()}`;
        const genConfig = {
            responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
            maxOutputTokens: appSettings.maxOutputTokens
        };

        // STREAMING LOGIC
        if (appSettings.enableStreaming !== false && client.models.generateContentStream && onStream) {
            try {
                dispatchAIStatus(requestId, 'blue'); 
                const stream = await client.models.generateContentStream({
                    model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
                    contents: messages,
                    config: genConfig
                });

                let fullBuffer = "";
                let currentNarrative = "";
                let currentSpeech = "";

                for await (const chunk of stream) {
                    if (shouldAbort && shouldAbort()) {
                        break;
                    }
                    
                    if (chunk.text) {
                        fullBuffer += chunk.text;
                        const newNarrative = extractStreamContent(fullBuffer, 'narrative');
                        const newSpeech = extractStreamContent(fullBuffer, 'speech');
                        
                        if (newNarrative !== currentNarrative || newSpeech !== currentSpeech) {
                            currentNarrative = newNarrative;
                            currentSpeech = newSpeech;
                            
                            const narrativeHtml = currentNarrative.replace(/\n+/g, '<br/>');
                            const speechHtml = currentSpeech.replace(/\n+/g, '<br/>');

                            let display = "";
                            if (narrativeHtml) display += `<span class="italic">* ${narrativeHtml} *</span>`;
                            if (speechHtml) display += (display ? "<br/>" : "") + `${speechHtml}`;
                            
                            onStream(display);
                        }
                    }
                }
                
                if (shouldAbort && shouldAbort()) {
                    dispatchAIStatus(requestId, 'gray');
                    return { narrative: "", speech: "", commands: [] };
                }

                let cleanText = fullBuffer.replace(/```json/g, '').replace(/```/g, '').trim();
                const json = JSON.parse(cleanText);

                if (onDebug) {
                    onDebug({
                        id: `debug_act_stream_${char.name}_${Date.now()}`,
                        timestamp: Date.now(),
                        characterName: char.name,
                        prompt: JSON.stringify(messages, null, 2),
                        response: fullBuffer
                    });
                }
                dispatchAIStatus(requestId, 'green'); 
                return json as TurnAction;

            } catch (e: any) {
                console.warn("Stream/Parse failed:", e);
                dispatchAIStatus(requestId, 'gray');
                return { narrative: "", speech: "", commands: [] };
            }
        }

        // NON-STREAMING
        const result = await robustGenerate<TurnAction>(
            () => client.models.generateContent({
                model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
                contents: messages,
                config: genConfig
            }),
            (json) => json && (json.narrative || json.speech || json.commands),
            3,
            (error, rawResponse) => {
                if (onDebug) {
                    onDebug({
                        id: `debug_act_fail_${char.name}_${Date.now()}`,
                        timestamp: Date.now(),
                        characterName: `${char.name} (Failed)`,
                        prompt: JSON.stringify(messages, null, 2),
                        response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                    });
                }
            },
            (rawResponse) => {
                if (onDebug) {
                    onDebug({
                        id: `debug_act_${char.name}_${Date.now()}`,
                        timestamp: Date.now(),
                        characterName: char.name,
                        prompt: JSON.stringify(messages, null, 2),
                        response: JSON.stringify(rawResponse, null, 2)
                    });
                }
            }
        );

        return result || { narrative: "...", commands: [] };
    }
    
    // Fallback if no fullGameState (should not happen in real execution)
    return { narrative: "...", commands: [] };
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
    globalContextConfig?: any,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    onStream?: (text: string) => void,
    shouldAbort?: () => boolean,
    onEffects?: (effects: TriggerEffect[]) => void // New callback
): Promise<{ speech: string, generatedSecrets?: Secret[] }> => {
    // Priority: Char Override > Global Behavior Config > Global Judge Config > Default
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

    // --- Reaction Memory Logic (Dropout) ---
    const isEnv = char.id.startsWith('env_');
    let capacity = memoryRounds;
    if (char.memoryConfig?.useOverride) {
        capacity = char.memoryConfig.maxMemoryRounds;
    } else if (isEnv) {
        capacity = appSettings.maxEnvMemoryRounds ?? 5;
    }

    const dropoutProb = char.memoryConfig?.useOverride 
        ? (char.memoryConfig.reactionDropoutProbability ?? 0.34)
        : (appSettings.reactionMemoryDropoutProbability ?? 0.34);
    
    let effectiveMemoryRounds = capacity;

    if (Math.random() < dropoutProb) {
        effectiveMemoryRounds = 2; // Force short memory
        if (onDebug) {
            onDebug({
                id: `debug_dropout_react_${char.name}_${Date.now()}`,
                timestamp: Date.now(),
                characterName: "System (Reaction Dropout)",
                prompt: "Reaction Memory Dropout Triggered",
                response: `Memory reduced from ${capacity} to ${effectiveMemoryRounds} rounds.`
            });
        }
    }
    
    // Apply Context Window Override from Custom Endpoint
    let tokenLimit = appSettings.maxInputTokens;
    if (customEndpointConfig && customEndpointConfig.contextWindow) {
        tokenLimit = customEndpointConfig.contextWindow;
    }

    // Inject Images for Reaction Trigger if available in the last log
    let enhancedTriggerEvent = triggerEvent;
    const lastLog = history[history.length - 1];
    if (lastLog && lastLog.images && lastLog.images.length > 0) {
         if (triggerEvent.includes(lastLog.content) || lastLog.content.includes(triggerEvent)) {
             enhancedTriggerEvent = imageBuilder.registerAndAppend(enhancedTriggerEvent, lastLog.images, "附件");
         }
    }
    
    const gameStateForMacro = fullGameState || {
        world: { attributes: worldAttributes, history: history, worldGuidance: "" },
        map: { locations: {}, regions: {}, charPositions: {} },
        characters: { [char.id]: char },
        round: { roundNumber: 1, activeCharId: char.id },
        appSettings: { ...appSettings, maxInputTokens: tokenLimit },
        defaultSettings: defaultSettings,
        cardPool: cardPool || []
    } as unknown as GameState;

    const ctx: MacroContext = {
        gameState: gameStateForMacro,
        activeCharId: char.id,
        activeLocationId: locationId,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            memoryRounds: effectiveMemoryRounds,
            triggerEvent: enhancedTriggerEvent,
            othersContext: otherChars ? undefined : "无",
            // Inject streaming flag for reaction as well, though usually reactions don't advance world time much
            isStreaming: appSettings.enableStreaming !== false
        }
    };

    const promptTemplate = isEnv
        ? defaultSettings.prompts.determineEnvReaction
        : (char.isProfessional 
            ? defaultSettings.prompts.determineCharacterReactionPro 
            : defaultSettings.prompts.determineCharacterReaction);

    // --- TRIGGER EVALUATION ---
    if (fullGameState) {
        // 1. Evaluate
        const { promptSuffix, guidanceSuffix, logs, effects } = evaluateTriggers(fullGameState, 'determineCharacterReaction', onTriggerUpdate, char.id);
        
        // 2. Inject Guidance
        if (guidanceSuffix) {
             ctx.dynamicParams = { ...ctx.dynamicParams, triggerGuidance: guidanceSuffix };
        }
        
        // 3. Process Prompt
        let prompt = processMacros(promptTemplate, ctx);
        
        // 4. Append Urgent Suffix
        prompt += promptSuffix;
        
        // 5. Handle outputs
        if (logs.length > 0 && onLog) logs.forEach(log => onLog(log.content));
        if (effects.length > 0 && onEffects) onEffects(effects); // Execute effects

        // Continue...
        const promptMessages = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
        const messages = buildContextMessages(globalContextConfig || { messages: [] }, finalConfig.contextConfig, char.contextConfig, promptMessages, appSettings);
        const requestId = `react_${char.id}_${Date.now()}`;
        const genConfig = {
            responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
            maxOutputTokens: appSettings.maxOutputTokens
        };

        if (appSettings.enableStreaming !== false && client.models.generateContentStream && onStream) {
            try {
                dispatchAIStatus(requestId, 'blue');
                const stream = await client.models.generateContentStream({
                    model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
                    contents: messages,
                    config: genConfig
                });

                let fullBuffer = "";
                let currentSpeech = "";

                for await (const chunk of stream) {
                    if (shouldAbort && shouldAbort()) {
                        break;
                    }
                    
                    if (chunk.text) {
                        fullBuffer += chunk.text;
                        const newSpeech = extractStreamContent(fullBuffer, 'speech');
                        if (newSpeech !== currentSpeech) {
                            currentSpeech = newSpeech;
                            onStream(`${currentSpeech.replace(/\n+/g, '<br/>')}`);
                        }
                    }
                }

                if (shouldAbort && shouldAbort()) {
                    dispatchAIStatus(requestId, 'gray');
                    return { speech: "" };
                }

                let cleanText = fullBuffer.replace(/```json/g, '').replace(/```/g, '').trim();
                const json = JSON.parse(cleanText);

                if (onDebug) {
                    onDebug({
                        id: `debug_react_stream_${char.name}_${Date.now()}`,
                        timestamp: Date.now(),
                        characterName: char.name,
                        prompt: JSON.stringify(messages, null, 2),
                        response: fullBuffer
                    });
                }

                dispatchAIStatus(requestId, 'green'); 
                const rawSecrets = Array.isArray(json.generatedSecrets) ? json.generatedSecrets : [];
                const mappedSecrets: Secret[] = rawSecrets.map((s: any) => ({
                    id: `sec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    question: s.question,
                    correctAnswer: s.correctAnswer,
                    wrongAnswerA: s.wrongAnswerA,
                    wrongAnswerB: s.wrongAnswerB,
                    solved: false
                }));
                return { speech: json.speech || "", generatedSecrets: mappedSecrets };

            } catch (e: any) {
                console.warn("Reaction Stream/Parse failed:", e);
                dispatchAIStatus(requestId, 'gray'); 
                const partialSpeech = extractStreamContent(e.message || "", 'speech');
                return { speech: partialSpeech };
            }
        }

        const result = await robustGenerate<{ speech: string, generatedSecrets?: any[] }>(
            () => client.models.generateContent({
                model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
                contents: messages,
                config: genConfig
            }),
            (json) => json && json.speech,
            2,
            (error, rawResponse) => {
                if (onDebug) {
                    onDebug({
                        id: `debug_react_fail_${char.name}_${Date.now()}`,
                        timestamp: Date.now(),
                        characterName: `${char.name} (Failed)`,
                        prompt: JSON.stringify(messages, null, 2),
                        response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                    });
                }
            },
            (rawResponse) => {
                if (onDebug) {
                    onDebug({
                        id: `debug_react_${char.name}_${Date.now()}`,
                        timestamp: Date.now(),
                        characterName: char.name,
                        prompt: JSON.stringify(messages, null, 2),
                        response: JSON.stringify(rawResponse, null, 2)
                    });
                }
            }
        );

        if (result) {
            const rawSecrets = Array.isArray(result.generatedSecrets) ? result.generatedSecrets : [];
            const mappedSecrets: Secret[] = rawSecrets.map((s: any) => ({
                id: `sec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                question: s.question,
                correctAnswer: s.correctAnswer,
                wrongAnswerA: s.wrongAnswerA,
                wrongAnswerB: s.wrongAnswerB,
                solved: false
            }));
            return { speech: result.speech, generatedSecrets: mappedSecrets };
        }

        return { speech: "" };
    }
    
    return { speech: "" };
};
