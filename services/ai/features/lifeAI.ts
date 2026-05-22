

import { AIConfig, AppSettings, DefaultSettings, LogEntry, GameAttribute, Character, DebugLog, MapLocation, MapRegion, Trigger, GameState } from "../../../types";
import { createClient, robustGenerate, supportsJsonMode } from "../core";
import { buildContextMessages, parsePromptStructure } from "../promptUtils";
import { evaluateTriggers } from "../../triggerService";
import { DEFAULT_AI_CONFIG } from "../../../config";
import { ImageContextBuilder } from "../ImageContextBuilder";
import { processMacros, MacroContext } from "../../macroService";

export const generateLife = async (
    char: Character,
    history: LogEntry[],
    worldAttributes: Record<string, GameAttribute>,
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    globalContextConfig: any,
    fullGameState: GameState,
    lifeChangeReason: string = "", 
    onDebug?: (log: DebugLog) => void,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<string | null> => {
    // Priority: Char Override > Global Gen > Global Judge
    const finalConfig = (char.useAiOverride && char.aiConfig?.provider)
        ? char.aiConfig 
        : (fullGameState.charGenConfig || fullGameState.judgeConfig || DEFAULT_AI_CONFIG);

    const client = createClient(finalConfig, appSettings.apiKeys, appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }
    
    const imageBuilder = new ImageContextBuilder();
    const locationId = fullGameState.map.charPositions[char.id]?.locationId;

    const ctx: MacroContext = {
        gameState: fullGameState,
        activeCharId: char.id,
        activeLocationId: locationId,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            lifeChangeReason: lifeChangeReason
        }
    };

    let prompt = processMacros(defaultSettings.prompts.generateLife, ctx);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'generateLife' as any, onTriggerUpdate, char.id);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(log => onLog(log.content));
    }

    const promptParts = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
    const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, char.contextConfig, promptParts, appSettings);
    
    const result = await robustGenerate<{ chapterContent: string }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: appSettings.maxOutputTokens 
            }
        }),
        (json) => json && typeof json.chapterContent === 'string' && json.chapterContent.length > 0,
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_life_fail_${char.name}_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Life Gen Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_life_${char.name}_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Life Gen)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    return result ? result.chapterContent : null;
};
