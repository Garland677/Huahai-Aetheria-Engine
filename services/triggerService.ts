
import { Trigger, TriggerCondition, GameState, TriggerPhase, Character, Card, LogEntry } from "../types";
import { replaceGlobalVariables } from "./ai/promptUtils";

// Local Helper: Get Global Memory (Extracted from aiService to avoid circular dependency)
// Updated to accept tokenLimit for consistent truncation
const getGlobalMemory = (history: LogEntry[], currentRound: number, roundsToKeep: number = 20, tokenLimit: number = 64000): string => {
    // Heuristic: Reserve about 4000 tokens for system prompt + world state + misc context
    const budget = Math.max(1000, tokenLimit - 4000);

    const minRound = Math.max(1, currentRound - roundsToKeep);
    return history
        .filter(e => e.round >= minRound)
        .slice(-50)
        .map(entry => entry.content)
        .join('\n');
};

// Helper: Compare logic with enhanced type safety for number-strings
const compare = (val1: any, op: string, val2: any): boolean => {
    // Attempt to convert both to numbers first
    const n1 = Number(val1);
    const n2 = Number(val2);
    const isNum = !isNaN(n1) && !isNaN(n2) && val1 !== "" && val1 !== null && val2 !== "" && val2 !== null;

    // Use number comparison if both look like numbers, otherwise string comparison
    const v1 = isNum ? n1 : val1;
    const v2 = isNum ? n2 : val2;

    switch (op) {
        case '>': return v1 > v2;
        case '>=': return v1 >= v2;
        case '<': return v1 < v2;
        case '<=': return v1 <= v2;
        case '=': return v1 == v2; // Loose equality allowed
        case '!=': return v1 != v2;
        case 'exists': return !!val1;
        case 'not_exists': return !val1;
        case 'contains': return String(val1).includes(String(val2));
        case 'exact': return String(val1) === String(val2);
        default: return false;
    }
};

// Helper: Resolve Attribute Alias
const getAttrValue = (char: Character, key: string) => {
    if (!char || !char.attributes) return undefined;
    
    // Direct match
    if (char.attributes[key]) return char.attributes[key].value;
    
    // Common Alias map
    const map: Record<string, string> = {
        'health': '健康', '健康': 'health',
        'cp': '创造点', '创造点': 'cp',
        'status': '状态', '状态': 'status',
        'physique': '体能', '体能': 'physique',
        'pleasure': '快感', '快感': 'pleasure',
        'energy': '能量', '能量': 'energy'
    };
    const alias = map[key];
    if (alias && char.attributes[alias]) return char.attributes[alias].value;
    
    // Case-insensitive fallback
    const lowerKey = key.toLowerCase();
    const foundKey = Object.keys(char.attributes).find(k => k.toLowerCase() === lowerKey);
    if (foundKey) return char.attributes[foundKey].value;

    return undefined;
};

export interface TriggerResult {
    promptSuffix: string;
    logs: string[];
}

export const evaluateTriggers = (
    gameState: GameState, 
    phase: TriggerPhase,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    contextCharId?: string
): TriggerResult => {
    const allTriggers = Object.values(gameState.triggers || {});

    // 1. Filter by Phase & Enabled
    const relevantTriggers = allTriggers.filter(t => t.enabled && t.phase === phase);

    // 2. Evaluate Conditions
    const passedTriggers: { trigger: Trigger, values: Record<string, any> }[] = [];

    relevantTriggers.forEach(trigger => {
        let allConditionsMet = true;
        const conditionValues: Record<string, any> = {}; // Store actual values for macros {{condition N}}

        // If no conditions, it's always met
        if (trigger.conditions.length === 0) {
             passedTriggers.push({ trigger, values: {} });
             return;
        }

        for (let i = 0; i < trigger.conditions.length; i++) {
            const cond = trigger.conditions[i];
            let isMet = false;
            let actualValue: any = null; // The value found in game state

            // --- Condition Evaluation Logic ---
            switch (cond.type) {
                case 'char_attr': {
                    // Target Resolution
                    let targets: Character[] = [];
                    
                    if (cond.characterId === 'current') {
                        // Dynamic Context Resolution
                        const targetId = contextCharId || gameState.round.activeCharId;
                        if (targetId && gameState.characters[targetId]) {
                            targets = [gameState.characters[targetId]];
                        }
                    } else {
                        // Standard Selection
                        if (cond.locationId === 'all' || !cond.locationId) {
                            targets = Object.values(gameState.characters);
                        } else {
                            targets = Object.values(gameState.characters).filter(c => 
                                gameState.map.charPositions[c.id]?.locationId === cond.locationId
                            );
                        }
                        
                        if (cond.characterId && cond.characterId !== 'all') {
                            targets = targets.filter(c => c.id === cond.characterId);
                        }
                    }

                    // Check Logic
                    for (const char of targets) {
                        const val = getAttrValue(char, cond.targetName || "");
                        if (val !== undefined && compare(val, cond.comparator as string, cond.value)) {
                            isMet = true;
                            actualValue = val;
                            break; 
                        }
                    }
                    break;
                }
                case 'char_card': {
                    let targets: Character[] = [];
                    
                    if (cond.characterId === 'current') {
                        const targetId = contextCharId || gameState.round.activeCharId;
                        if (targetId && gameState.characters[targetId]) {
                            targets = [gameState.characters[targetId]];
                        }
                    } else {
                        if (cond.locationId === 'all' || !cond.locationId) targets = Object.values(gameState.characters);
                        else targets = Object.values(gameState.characters).filter(c => gameState.map.charPositions[c.id]?.locationId === cond.locationId);
                        
                        if (cond.characterId && cond.characterId !== 'all') targets = targets.filter(c => c.id === cond.characterId);
                    }

                    const searchName = (cond.targetName || "").toLowerCase();

                    for (const char of targets) {
                        // Combine Inventory & Skills
                        const allCards = [
                            ...char.skills,
                            ...char.inventory.map(id => gameState.cardPool.find(c => c.id === id)).filter(Boolean) as Card[]
                        ];
                        
                        const found = allCards.find(c => {
                            const cName = c.name.toLowerCase();
                            if (cond.comparator === 'exact') return cName === searchName;
                            return cName.includes(searchName);
                        });

                        // Standard exists check
                        if (['exists', 'contains', 'exact'].includes(cond.comparator)) {
                            if (found) { isMet = true; actualValue = found.name; break; }
                        }
                    }
                    
                    // Special handling for 'not_exists': check if NO ONE has it
                    if (cond.comparator === 'not_exists') {
                        const anyFound = targets.some(char => {
                             const allCards = [...char.skills, ...char.inventory.map(id => gameState.cardPool.find(c => c.id === id)).filter(Boolean) as Card[]];
                             return allCards.some(c => {
                                 const cName = c.name.toLowerCase();
                                 return cName.includes(searchName);
                             });
                        });
                        if (!anyFound) { isMet = true; actualValue = "None"; }
                        else { isMet = false; }
                    }
                    break;
                }
                case 'world_time': {
                    const timeAttr = gameState.world.attributes['worldTime'];
                    if (timeAttr) {
                        const curVal = String(timeAttr.value);
                        const targetVal = String(cond.value || "");
                        if (compare(curVal, cond.comparator as string, targetVal)) {
                            isMet = true;
                            actualValue = curVal;
                        }
                    }
                    break;
                }
                case 'world_attr': {
                    const attr = gameState.world.attributes[cond.targetName || ""];
                    if (attr) {
                        if (compare(attr.value, cond.comparator as string, cond.value)) {
                            isMet = true;
                            actualValue = attr.value;
                        }
                    }
                    break;
                }
                case 'char_name': {
                    const exists = Object.values(gameState.characters).some(c => c.name === cond.targetName);
                    if (cond.comparator === 'exists' && exists) { isMet = true; actualValue = cond.targetName; }
                    if (cond.comparator === 'not_exists' && !exists) { isMet = true; actualValue = "None"; }
                    break;
                }
                case 'loc_name': {
                    const exists = Object.values(gameState.map.locations).some(l => l.name === cond.targetName);
                    if (cond.comparator === 'exists' && exists) { isMet = true; actualValue = cond.targetName; }
                    if (cond.comparator === 'not_exists' && !exists) { isMet = true; actualValue = "None"; }
                    break;
                }
                case 'region_name': {
                    const exists = Object.values(gameState.map.regions).some(r => r.name === cond.targetName);
                    if (cond.comparator === 'exists' && exists) { isMet = true; actualValue = cond.targetName; }
                    if (cond.comparator === 'not_exists' && !exists) { isMet = true; actualValue = "None"; }
                    break;
                }
                case 'history': {
                    // Get recent history text
                    const rounds = cond.historyRounds || 5;
                    const currentRound = gameState.round.roundNumber;
                    // FIX: Pass maxInputTokens from settings to respect memory limits
                    const historyText = getGlobalMemory(gameState.world.history, currentRound, rounds, gameState.appSettings.maxInputTokens);
                    const search = (cond.value || "").toString();
                    const found = historyText.includes(search);
                    
                    if (cond.comparator === 'contains' && found) { isMet = true; actualValue = search; }
                    if (cond.comparator === 'not_exists' && !found) { isMet = true; actualValue = "None"; }
                    break;
                }
            }

            if (!isMet) {
                allConditionsMet = false;
                break;
            } else {
                // Store value for Macro: {{condition 1}}, {{condition 2}}... (1-based index)
                conditionValues[`condition ${i + 1}`] = actualValue;
            }
        }

        if (allConditionsMet) {
            passedTriggers.push({ trigger, values: conditionValues });
            
            // Handle Auto-Disable Logic
            if (trigger.maxTriggers !== undefined && trigger.maxTriggers > -1) {
                const newVal = Math.max(0, trigger.maxTriggers - 1);
                const updates: Partial<Trigger> = { maxTriggers: newVal };
                
                if (newVal === 0) {
                    updates.enabled = false;
                }
                
                if (onTriggerUpdate) {
                    onTriggerUpdate(trigger.id, updates);
                }
            }
        }
    });

    // 3. Construct Result
    let combinedPrompt = "";
    const combinedLogs: string[] = [];

    passedTriggers.forEach(({ trigger, values }) => {
        // Macro Replacement Helper using shared util
        const replaceMacros = (text: string): string => {
            let result = text;
            
            // 1. Trigger Conditions (Local scope)
            Object.entries(values).forEach(([key, val]) => {
                // Replace {{condition N}}
                result = result.split(`{{${key}}}`).join(String(val));
            });

            // 2. Global Variables (Global scope) via Shared Util
            result = replaceGlobalVariables(result, gameState.appSettings);

            return result;
        };

        if (trigger.urgentRequirement) {
            const req = replaceMacros(trigger.urgentRequirement);
            combinedPrompt += `\n[紧急需求 / URGENT (Trigger: ${trigger.name})]: ${req}`;
        }

        if (trigger.systemLog) {
            const log = replaceMacros(trigger.systemLog);
            combinedLogs.push(log);
        }
    });

    return {
        promptSuffix: combinedPrompt,
        logs: combinedLogs
    };
};
