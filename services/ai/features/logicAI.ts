
import { AIConfig, AppSettings, DefaultSettings, GameAttribute, GameState, LogEntry, Trigger, DebugLog } from "../../../types";
import { createClient, robustGenerate, supportsJsonMode } from "../core";
import { buildContextMessages, parsePromptStructure } from "../promptUtils";
import { evaluateTriggers } from "../../triggerService";
import { DEFAULT_AI_CONFIG } from "../../../config";
import { ImageContextBuilder } from "../ImageContextBuilder";
import { processMacros, MacroContext } from "../../macroService";

export const checkConditionsBatch = async (
    config: AIConfig,
    items: any[],
    context: { history: string, world: any },
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    globalContextConfig: any,
    entitiesContext: Record<string, any>,
    onDebug?: (log: DebugLog) => void,
    strictMode: boolean = false,
    fullGameState?: GameState,
    onLog?: (msg: string, type?: 'system' | 'narrative') => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    imageBuilder?: ImageContextBuilder
): Promise<any> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys, appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }

    const builder = imageBuilder || new ImageContextBuilder();

    // Format Items to structured text string
    const activeItems = items.filter(i => i.type !== 'passive');
    const formattedItemsStr = activeItems.map(item => {
        let str = `--- 待判定行动 (Action Check) ---\n`;
        str += `1. 来源卡牌: ${item.cardName || item.name} (ID: ${item.cardId || "unknown"})\n`;
        str += `2. 发起者 (Source): ${item.context.source || "未知"}\n`;
        str += `3. 目标 (Target): ${item.context.target || "未知"}\n`;
        str += `4. 行动定义 (Definition):\n`;
        str += `    - 描述: ${item.description || "(无描述)"}\n`;
        
        // Display full effect list
        if (item.allEffects && Array.isArray(item.allEffects) && item.allEffects.length > 0) {
             str += `    - 包含效果列表 (Effects):\n`;
             item.allEffects.forEach((e: any) => {
                 str += `      [Effect ID: ${e.id}]\n`;
                 str += `        Target: ${e.targetAttribute} (${e.targetType})\n`;
                 str += `        Base Value: ${e.dynamicValue ? 'AI决定' : e.value}\n`;
                 str += `        Condition: ${e.conditionDescription}\n`;
             });
        }

        if (item.targetPassives && item.targetPassives.length > 0) {
            str += `5. 目标已知被动 (Target Passives):\n`;
            item.targetPassives.forEach((p: any) => {
                str += `    - [Passive Card] ${p.name} (ID: ${p.id})\n`;
                str += `      Desc: ${p.description || "..."}\n`;
                if (p.effects && Array.isArray(p.effects)) {
                    str += `      Effects:\n`;
                    p.effects.forEach((e: any) => {
                         str += `        [Effect ID: ${e.id}]\n`;
                         str += `          Target: ${e.targetAttribute} (${e.targetType})\n`;
                         str += `          Value: ${e.dynamicValue ? 'AI决定' : e.value}\n`;
                         str += `          Condition: ${e.conditionDescription}\n`;
                    });
                }
            });
        }
        return str;
    }).join('\n\n----------------\n\n');

    const gameStateForMacro = fullGameState || {
        world: { attributes: context.world || {}, history: [], worldGuidance: "" },
        map: { locations: {}, regions: {}, charPositions: {} },
        characters: {},
        round: { roundNumber: 1 },
        appSettings: appSettings,
        defaultSettings: defaultSettings
    } as unknown as GameState;

    const ctx: MacroContext = {
        gameState: gameStateForMacro,
        imageBuilder: builder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            entities: entitiesContext,
            itemsStr: formattedItemsStr,
        }
    };

    let prompt = processMacros(defaultSettings.prompts.checkConditionsBatch, ctx);
    
    if (strictMode) {
        prompt += `\n${defaultSettings.prompts.checkConditionsStrictInstruction}`;
    }

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'checkConditionsBatch', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) {
            logs.forEach(log => onLog(log.content, log.type));
        }
    }

    const promptParts = parsePromptStructure(prompt, (t) => builder.interleave(t));
    const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, undefined, promptParts, appSettings);

    const result = await robustGenerate<any>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: appSettings.maxOutputTokens
            }
        }),
        (json) => {
            // Support both formats: Root object OR results map
            return json && (typeof json.result === 'boolean' || json.results);
        },
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_chk_fail_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Logic Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_chk_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Logic)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    // Normalize Output
    if (result) {
        if (result.results) {
            // Legacy/Batch format
            return result.results;
        } else {
            // Root format (Single Item)
            // Map the root result to the ID of the first item sent
            const firstId = items[0]?.id;
            if (firstId) {
                return { [firstId]: result };
            }
        }
    }
    return {};
};

export const analyzeSettlement = async (
    config: AIConfig,
    history: LogEntry[],
    conflictsList: any[],
    drivesList: any[],
    charLifeNow: string,
    appSettings: AppSettings,
    defaultSettings: DefaultSettings,
    worldAttributes: Record<string, GameAttribute>,
    globalContextConfig: any,
    onDebug?: (log: DebugLog) => void,
    fullGameState?: GameState,
    onLog?: (msg: string, type?: 'system' | 'narrative') => void,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void
): Promise<{
    analysis: string,
    solvedConflictIds: string[],
    fulfilledDriveIds: string[],
    completedLifeTrajectoryCharIds: any[],
    fulfilledTriggers: string[]
} | null> => {
    const finalConfig = config.provider ? config : DEFAULT_AI_CONFIG;
    const client = createClient(finalConfig, appSettings.apiKeys, appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }
    
    const imageBuilder = new ImageContextBuilder();

    const gameStateForMacro = fullGameState || {
        world: { attributes: worldAttributes, history: history, worldGuidance: "" },
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
            conflictsList: conflictsList,
            drivesList: drivesList,
            charLifeNow: charLifeNow
        }
    };

    let prompt = processMacros(defaultSettings.prompts.analyzeSettlement, ctx);

    if (fullGameState) {
        const { promptSuffix, logs } = evaluateTriggers(fullGameState, 'analyzeSettlement', onTriggerUpdate);
        prompt += promptSuffix;
        if (logs.length > 0 && onLog) {
            logs.forEach(log => onLog(log.content, log.type));
        }
    }

    const promptParts = parsePromptStructure(prompt, (t) => imageBuilder.interleave(t));
    const messages = buildContextMessages(globalContextConfig, finalConfig.contextConfig, undefined, promptParts, appSettings);

    const result = await robustGenerate<{
        analysis: string,
        solvedConflictIds: string[],
        fulfilledDriveIds: string[],
        completedLifeTrajectoryCharIds: any[],
        fulfilledTriggers: string[]
    }>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: appSettings.maxOutputTokens
            }
        }),
        (json) => {
            return json && (Array.isArray(json.solvedConflictIds) || Array.isArray(json.fulfilledDriveIds));
        },
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_settle_fail_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Settlement Failed)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_settle_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: "System (Settlement)",
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    return result;
};
