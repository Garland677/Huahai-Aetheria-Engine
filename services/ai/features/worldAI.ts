

import { AIConfig, LogEntry, Character, AppSettings, GameAttribute, DefaultSettings, GameState, Trigger, DebugLog, GameImage } from "../../../types";
import { createClient, robustGenerate, supportsJsonMode } from "../core";
import { buildContextMessages, parsePromptStructure } from "../promptUtils";
import { evaluateTriggers } from "../../triggerService";
import { DEFAULT_AI_CONFIG } from "../../../config";
import { ImageContextBuilder } from "../ImageContextBuilder";
import { processMacros, MacroContext } from "../../macroService";

export const generateLocationDetails = async (
    config: AIConfig,
    coords: { x: number, y: number, z: number },
    history: LogEntry[],
    worldAttributes: Record<string, GameAttribute>,
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    globalContextConfig: any,
    worldGuidance: string,
    needsRegionGen: boolean,
    regionInfo: { name: string, description: string } | undefined,
    terrainAnalysis: any,
    regionStats: any,
    existingCharsContext: string,
    nearbyLocationsContext: string,
    suggestedNames: string[],
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string) => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    locationInstruction: string = "",
    cultureInstruction: string = "",
    locationImages: GameImage[] = [],
    characterImages: GameImage[] = [],
    fixedName?: string // New optional parameter
): Promise<{ 
    name: string, 
    description: string, 
    region?: { name: string, description: string }, 
    localItems?: {name: string, description: string}[],
    lotteryrule?: string,
    chars?: { name: string, description: string, appearanceImageId?: string }[]
}> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys, appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }

    const imageBuilder = new ImageContextBuilder();

    // Register User Provided Images
    const locImagesStr = imageBuilder.registerList(locationImages, "地点定义参考图");
    const charImagesStr = imageBuilder.registerList(characterImages, "人文/角色定义参考图");

    // Prepend fixed name requirement if exists
    let finalLocationInstruction = locationInstruction + locImagesStr;
    if (fixedName) {
        finalLocationInstruction = `(本次任务强制要求: 地点名称必须为 "${fixedName}"。) ` + finalLocationInstruction;
    }

    const gameStateForMacro = fullGameState || {
        world: { attributes: worldAttributes, history: history, worldGuidance: worldGuidance },
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
            x: coords.x,
            y: coords.y,
            z: coords.z,
            regionInfo: regionInfo, // Pass explicit region info if dealing with new region gen
            regionName: regionInfo?.name,
            regionDesc: regionInfo?.description,
            // Instruction Logic
            regionContextInstruction: regionInfo ? defaultSettings.prompts.instruction_existingRegionContext : "",
            regionGenInstruction: needsRegionGen ? defaultSettings.prompts.instruction_generateNewRegion : "",
            regionStats: regionStats,
            terrainAnalysis: terrainAnalysis,
            existingCharsContext: existingCharsContext ? defaultSettings.prompts.context_nearbyCharacters.replace("{{CHARS_LIST}}", existingCharsContext) : "",
            nearbyContext: nearbyLocationsContext,
            locationInstruction: finalLocationInstruction,
            cultureInstruction: cultureInstruction + charImagesStr,
            suggestedNames: suggestedNames
        }
    };

    let prompt = processMacros(defaultSettings.prompts.generateLocationDetails, ctx);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'generateLocationDetails', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) logs.forEach(log => onLog(log.content));
    }

    const promptParts = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
    const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, undefined, promptParts, appSettings);

    const result = await robustGenerate<{ 
        name: string, 
        description: string, 
        region?: any, 
        localItems?: {name: string, description: string}[],
        lotteryrule?: string,
        chars?: { name: string, description: string, appearanceImageId?: string }[]
    }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: appSettings.maxOutputTokens
            }
        }),
        (json) => json && json.name && json.description,
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_loc_fail_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Location Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_loc_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Location)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    return result || { name: "未知", description: "生成失败" };
};
