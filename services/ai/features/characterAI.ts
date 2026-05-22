

import { AIConfig, AppSettings, DefaultSettings, LogEntry, GameState, Trigger, DebugLog, GameImage, Character, MapRegion, Card, Effect, AttributeVisibility } from "../../../types";
import { createClient, robustGenerate, supportsJsonMode } from "../core";
import { buildContextMessages, parsePromptStructure } from "../promptUtils";
import { evaluateTriggers } from "../../triggerService";
import { DEFAULT_AI_CONFIG } from "../../../config";
import { ImageContextBuilder } from "../ImageContextBuilder";
import { processMacros, MacroContext } from "../../macroService";

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
    globalContextConfig: any,
    worldGuidance?: string, 
    suggestedNames: string[] = [],
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    onDebug?: (log: DebugLog) => void,
    appearanceImages?: GameImage[],
    settingImages?: GameImage[]
): Promise<any> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys, appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }

    // Initialize Image Builder for multimodal context
    const imageBuilder = new ImageContextBuilder();

    // Register provided images
    const appearanceRefStr = imageBuilder.registerList(appearanceImages, "外观参考图");
    const settingRefStr = imageBuilder.registerList(settingImages, "设定参考图");

    // Construct Macro Context
    // We need a GameState. If fullGameState is missing (unlikely in normal flow), we might need a mock.
    // For now, we assume fullGameState is provided or valid enough.
    // If not, macroService might crash on property access.
    
    // Fallback Mock State if needed (Safety)
    const safeGameState = fullGameState || {
        world: { attributes: {}, history: history, worldGuidance: worldGuidance || "" },
        map: { locations: {}, regions: {}, charPositions: {}, activeLocationId: "" },
        characters: {},
        round: { roundNumber: 1, activeCharId: "" },
        appSettings: appSettings,
        defaultSettings: defaultSettings,
        cardPool: []
    } as unknown as GameState;

    const ctx: MacroContext = {
        gameState: safeGameState,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
             desc: desc + appearanceRefStr + settingRefStr,
             style: style, // Used to guide skill generation, but not stored in Char object anymore
             locationName: locationName,
             regionName: regionName,
             // Note: REGION_DESC logic is handled inside MacroService if available in map, 
             // but here we might not have the region in map yet if it's new.
             // MacroService doesn't accept raw regionDesc as param, so we might need to rely on map state or add it.
             // Actually MacroService's REGION_DESC falls back to dynamicParams.regionDesc.
             existingCharsContext: existingChars,
             suggestedNames: suggestedNames
        }
    };

    let prompt = processMacros(defaultSettings.prompts.generateCharacter, ctx);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'generateCharacter', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(log => onLog(log.content));
    }

    const promptParts = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));

    const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, undefined, promptParts, appSettings);

    const result = await robustGenerate(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: appSettings.maxOutputTokens
            }
        }),
        (json) => json && (json.name || json.description),
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_char_gen_fail_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Char Gen Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_char_gen_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Char Gen)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    return result;
};
