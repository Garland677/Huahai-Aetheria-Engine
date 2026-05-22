

import { AIConfig, AppSettings, Character, GameState, LetterTemplate, DebugLog, GameAttribute, MapLocation, MapRegion, GameImage } from "../../../types";
import { createClient, robustGenerate, supportsJsonMode } from "../core";
import { buildContextMessages, replaceGlobalVariables, parsePromptStructure } from "../promptUtils";
import { DEFAULT_AI_CONFIG } from "../../../config";
import { ImageContextBuilder } from "../ImageContextBuilder";
import { processMacros, MacroContext } from "../../macroService";

export const generateLetter = async (
    char: Character,
    template: LetterTemplate,
    userRequest: string,
    gameState: GameState,
    onDebug?: (log: DebugLog) => void,
    attachedImages?: GameImage[]
): Promise<any> => {
    // Priority: Char Override > Global Behavior > Global Judge
    const finalConfig = (char.useAiOverride && char.aiConfig?.provider)
        ? char.aiConfig 
        : (gameState.charBehaviorConfig || gameState.judgeConfig || DEFAULT_AI_CONFIG);
        
    const client = createClient(finalConfig, gameState.appSettings.apiKeys, gameState.appSettings.customEndpoints);
    
    // Resolve custom endpoint config if applicable
    let customEndpointConfig = undefined;
    if (finalConfig.provider === 'custom' && finalConfig.customEndpointId) {
        customEndpointConfig = gameState.appSettings.customEndpoints.find(e => e.id === finalConfig.customEndpointId);
    }
    
    const imageBuilder = new ImageContextBuilder();

    // Register User Attached Images
    const userRequestWithImages = imageBuilder.registerAndAppend(userRequest, attachedImages, "附图");

    const locationId = gameState.map.charPositions[char.id]?.locationId;
    let currentLocation: MapLocation | undefined;
    if (locationId) {
        currentLocation = gameState.map.locations[locationId];
    }

    // Construct JSON Structure Example based on Template
    const structureExample: Record<string, any> = {
        "语言":"中文",
        intro: "（可选）在此处写一些寒暄或回复的话（纯文本，非表格内容）"
    };
    template.paragraphs.forEach(p => {
        const fragObj: Record<string, string> = {};
        p.fragments.forEach(f => {
            fragObj[f.key] = `(${f.label}的内容)`;
        });
        structureExample[p.key] = fragObj;
    });

    const ctx: MacroContext = {
        gameState: gameState,
        activeCharId: char.id,
        activeLocationId: locationId,
        imageBuilder: imageBuilder,
        aiConfig: finalConfig,
        onDebug: onDebug,
        dynamicParams: {
            userRequest: userRequestWithImages,
            jsonStructureExample: JSON.stringify(structureExample, null, 2)
        }
    };

    let prompt = processMacros(gameState.defaultSettings.prompts.generateLetter, ctx);

    // Append user's template specific prompt instructions if any
    if (template.prompt) {
        // We use replaceGlobalVariables for template specific parts as they are user input strings
        const processedTemplatePrompt = replaceGlobalVariables(template.prompt, gameState.appSettings);
        prompt += `\n\n[额外指示]\n${processedTemplatePrompt}`;
    }

    const promptParts = imageBuilder.interleave(prompt); // Use builder helper to be safe

    const messages = buildContextMessages(gameState.globalContext, finalConfig.contextConfig, char.contextConfig, promptParts, gameState.appSettings);

    const result = await robustGenerate<any>(
        () => client.models.generateContent({
            model: finalConfig.model || DEFAULT_AI_CONFIG.model!,
            contents: messages,
            config: { 
                responseMimeType: supportsJsonMode(finalConfig.provider, customEndpointConfig) ? 'application/json' : undefined,
                maxOutputTokens: gameState.appSettings.maxOutputTokens
            }
        }),
        (json) => {
            return template.paragraphs.some(p => json[p.key]) || json.intro;
        },
        3,
        (error, rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_mail_fail_${char.name}_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: `Mail System (${char.name}) Failed`,
                    prompt: JSON.stringify(messages, null, 2),
                    response: `Error: ${error.message}\n\nRaw Response:\n${rawResponse || "(No Response)"}`
                });
            }
        },
        (rawResponse) => {
            if (onDebug) {
                onDebug({
                    id: `debug_mail_${char.name}_${Date.now()}`,
                    timestamp: Date.now(),
                    characterName: `Mail System (${char.name})`,
                    prompt: JSON.stringify(messages, null, 2),
                    response: JSON.stringify(rawResponse, null, 2)
                });
            }
        }
    );

    return result;
};
