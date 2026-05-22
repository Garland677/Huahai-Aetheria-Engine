

import { Trigger, TriggerCondition, GameState, TriggerPhase, Character, Card, LogEntry, TriggerEffect, AttributeType, AttributeVisibility } from "../types";
import { processMacros, MacroContext } from "./macroService";
import { getGlobalMemory } from "./ai/memoryUtils";
import { getAttr } from "./attributeUtils";
import { generateCardId, generateAttributeId } from "./idUtils";
import { normalizeCard } from "./aiService";

// Helper: Normalize string input
const normalizeStr = (str: any): string => String(str || "").trim();

// Helper: Compare logic with enhanced type safety and trimming
const compare = (val1: any, op: string, val2: any): boolean => {
    let v1 = val1;
    let v2 = val2;

    // Pre-processing: Trim strings to avoid invisible whitespace issues
    if (typeof v1 === 'string') v1 = v1.trim();
    if (typeof v2 === 'string') v2 = v2.trim();

    // Attempt to convert both to numbers first
    const n1 = Number(v1);
    const n2 = Number(v2);
    // Use number comparison ONLY if both valid numbers and not empty strings (Number("") is 0)
    const isNum = !isNaN(n1) && !isNaN(n2) && v1 !== "" && v1 !== null && v2 !== "" && v2 !== null;

    const finalV1 = isNum ? n1 : v1;
    const finalV2 = isNum ? n2 : v2;

    switch (op) {
        case '>': return finalV1 > finalV2;
        case '>=': return finalV1 >= finalV2;
        case '<': return finalV1 < finalV2;
        case '<=': return finalV1 <= finalV2;
        case '=': 
        case '==':
            return finalV1 == finalV2; // Loose equality allowed for "50" == 50
        case '!=': return finalV1 != finalV2;
        case 'exists': return val1 !== undefined && val1 !== null && val1 !== "";
        case 'not_exists': return val1 === undefined || val1 === null || val1 === "";
        case 'contains': return normalizeStr(val1).includes(normalizeStr(val2));
        case 'exact': return normalizeStr(val1) === normalizeStr(val2);
        default: return false;
    }
};

// Helper: Resolve Character Attribute Value by Key OR Name
const getCharAttrValue = (char: Character, key: string) => {
    if (!char || !char.attributes) return undefined;
    const cleanKey = normalizeStr(key);
    
    // 1. Direct Key Match
    if (char.attributes[cleanKey]) return char.attributes[cleanKey].value;
    
    // 2. Name Property Match
    const allAttrs = Object.values(char.attributes);
    const byName = allAttrs.find(a => normalizeStr(a.name) === cleanKey);
    if (byName) return byName.value;

    // 3. Common Alias map (Case-insensitive fallback)
    const map: Record<string, string> = {
        'health': '健康', '健康': 'health',
        'cp': '创造点', '创造点': 'cp',
        'status': '状态', '状态': 'status',
        'physique': '体能', '体能': 'physique',
        'pleasure': '快感', '快感': 'pleasure',
        'active': '活跃', '活跃': 'active'
    };
    const lowerKey = cleanKey.toLowerCase();
    const alias = map[lowerKey];
    
    if (alias) {
        if (char.attributes[alias]) return char.attributes[alias].value;
        const aliasByName = allAttrs.find(a => normalizeStr(a.name) === alias);
        if (aliasByName) return aliasByName.value;
    }

    // 4. Last resort: Case-insensitive ID/Name scan
    const foundKey = Object.keys(char.attributes).find(k => k.toLowerCase() === lowerKey);
    if (foundKey) return char.attributes[foundKey].value;

    const foundByNameLower = allAttrs.find(a => a.name.toLowerCase() === lowerKey);
    if (foundByNameLower) return foundByNameLower.value;

    return undefined;
};

// Helper: Resolve World Attribute Value by Key OR Name
const getWorldAttrValue = (worldAttrs: Record<string, any>, key: string) => {
    if (!worldAttrs) return undefined;
    const cleanKey = normalizeStr(key);

    if (worldAttrs[cleanKey]) return worldAttrs[cleanKey].value;

    const attr = Object.values(worldAttrs).find((a: any) => normalizeStr(a.name) === cleanKey);
    if (attr) return attr.value;
    
    const map: Record<string, string> = {
         'worldtime': '世界时间', '世界时间': 'worldTime',
         'world_status': '状态', '状态': 'world_status'
    };
    const lowerKey = cleanKey.toLowerCase();
    const alias = map[lowerKey];
    if (alias) {
        if (worldAttrs[alias]) return worldAttrs[alias].value;
        const aliasAttr = Object.values(worldAttrs).find((a: any) => normalizeStr(a.name) === alias);
        if (aliasAttr) return aliasAttr.value;
    }

    return undefined;
};

// Helper: Calculate New Value with Math and Defaults
const calculateNewValue = (currentVal: string | number | undefined, expression: string): string | number => {
    // Determine default base value if undefined
    let baseVal = currentVal;
    
    if (baseVal === undefined) {
        // Heuristic: If expression implies math (+, -, *, /) or is a number, assume default is 50.
        // Otherwise assume empty text or "None".
        const isMathContext = /[\+\-\*\/]/.test(expression) || !isNaN(Number(expression));
        baseVal = isMathContext ? 50 : "None";
    }

    if (typeof expression === 'string' && expression.includes('a')) {
        try {
            const exp = expression.replace(/a/g, String(baseVal));
            // Simple safe eval for basic math
            // eslint-disable-next-line no-new-func
            const calculated = new Function('return ' + exp)();
            return isNaN(Number(calculated)) ? String(calculated) : Number(calculated);
        } catch (e) {
            console.warn(`Effect math error for ${expression}:`, e);
            return expression;
        }
    }
    
    // If expression is just a static value (no 'a'), return it directly
    return expression; 
};

// Helper: Common Condition Checking Logic
const checkConditionList = (
    conditions: TriggerCondition[] | undefined,
    gameState: GameState,
    contextCharId?: string
): { isMet: boolean, values: Record<string, any> } => {
    if (!conditions || conditions.length === 0) return { isMet: true, values: {} };

    const conditionValues: Record<string, any> = {};
    let allConditionsMet = true;

    for (let i = 0; i < conditions.length; i++) {
        const cond = conditions[i];
        let isMet = false;
        let actualValue: any = null;

        // --- Condition Evaluation Logic ---
        switch (cond.type) {
            case 'natural_language': {
                const activeSet = new Set(gameState.world.activeLanguageConditions || []);
                if (activeSet.has(cond.id)) {
                    isMet = true;
                    actualValue = "Fulfilled";
                }
                break;
            }
            case 'specific_round_type': {
                // Check if current round type matches any of the target types
                const targetTypes = cond.targetRoundTypes || [];
                if (targetTypes.length === 0) break;

                const isHidden = gameState.round.isHiddenRound;
                // We need to know WHICH hidden round it is. 
                // Since we don't have a direct counter in RoundState yet, we can infer it or rely on the Phase being passed?
                // Actually, the TriggerPhase itself tells us! 
                // But wait, this is a CONDITION check, which might be called during ANY phase.
                // If we are in 'determineTurnOrder', we might be in a hidden round.
                
                // Let's rely on a new property in RoundState: hiddenRoundCounter (1-based)
                // If not present, we assume 0 (Normal).
                const hiddenCounter = (gameState.round as any).hiddenRoundCounter || 0;
                
                let currentType = 'normal';
                if (isHidden) {
                    currentType = `hidden_${hiddenCounter}`;
                }

                if (targetTypes.includes(currentType)) {
                    isMet = true;
                    actualValue = currentType;
                }
                break;
            }
            case 'current_location': {
                const activeLocId = gameState.map.activeLocationId;
                if (!activeLocId) break;

                const activeLoc = gameState.map.locations[activeLocId];
                if (!activeLoc) break;

                const targetNames = (cond.targetLocationNames || []).map(n => normalizeStr(n));
                const currentName = normalizeStr(activeLoc.name);

                if (targetNames.includes(currentName)) {
                    isMet = true;
                    actualValue = currentName;
                }
                break;
            }
            case 'char_attr': {
                let targets: Character[] = [];
                if (cond.characterId === 'current') {
                    const targetId = contextCharId || gameState.round.activeCharId;
                    if (targetId && gameState.characters[targetId]) {
                        targets = [gameState.characters[targetId]];
                    }
                } else {
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

                for (const char of targets) {
                    const val = getCharAttrValue(char, cond.targetName || "");
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

                const searchName = normalizeStr(cond.targetName).toLowerCase();
                for (const char of targets) {
                    const allCards = [
                        ...char.skills,
                        ...char.inventory.map(id => gameState.cardPool.find(c => c.id === id)).filter(Boolean) as Card[]
                    ];
                    
                    const found = allCards.find(c => {
                        const cName = normalizeStr(c.name).toLowerCase();
                        if (cond.comparator === 'exact') return cName === searchName;
                        return cName.includes(searchName);
                    });

                    if (['exists', 'contains', 'exact'].includes(cond.comparator)) {
                        if (found) { isMet = true; actualValue = found.name; break; }
                    }
                }
                
                if (cond.comparator === 'not_exists') {
                    const anyFound = targets.some(char => {
                         const allCards = [...char.skills, ...char.inventory.map(id => gameState.cardPool.find(c => c.id === id)).filter(Boolean) as Card[]];
                         return allCards.some(c => {
                             const cName = normalizeStr(c.name).toLowerCase();
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
                const val = getWorldAttrValue(gameState.world.attributes, cond.targetName || "");
                if (val !== undefined && compare(val, cond.comparator as string, cond.value)) {
                    isMet = true;
                    actualValue = val;
                }
                break;
            }
            case 'char_name': {
                const targetName = normalizeStr(cond.targetName);
                const exists = Object.values(gameState.characters).some(c => normalizeStr(c.name) === targetName);
                if (cond.comparator === 'exists' && exists) { isMet = true; actualValue = targetName; }
                if (cond.comparator === 'not_exists' && !exists) { isMet = true; actualValue = "None"; }
                break;
            }
            case 'loc_name': {
                const targetName = normalizeStr(cond.targetName);
                const exists = Object.values(gameState.map.locations).some(l => normalizeStr(l.name) === targetName);
                if (cond.comparator === 'exists' && exists) { isMet = true; actualValue = targetName; }
                if (cond.comparator === 'not_exists' && !exists) { isMet = true; actualValue = "None"; }
                break;
            }
            case 'region_name': {
                const targetName = normalizeStr(cond.targetName);
                const exists = Object.values(gameState.map.regions).some(r => normalizeStr(r.name) === targetName);
                if (cond.comparator === 'exists' && exists) { isMet = true; actualValue = targetName; }
                if (cond.comparator === 'not_exists' && !exists) { isMet = true; actualValue = "None"; }
                break;
            }
            case 'history': {
                const rounds = cond.historyRounds || 5;
                const currentRound = gameState.round.roundNumber;
                const historyText = getGlobalMemory(gameState.world.history, currentRound, rounds, gameState.appSettings.maxInputTokens);
                const search = normalizeStr(cond.value);
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
            conditionValues[`condition ${i + 1}`] = actualValue;
        }
    }

    return { isMet: allConditionsMet, values: conditionValues };
};

export interface LogResult {
    content: string;
    type: 'system' | 'narrative';
}

export interface TriggerResult {
    promptSuffix: string;   // Urgent Requirements
    guidanceSuffix: string; // Normal Requirements
    logs: LogResult[];
    effects: TriggerEffect[]; // Collect all triggered effects
}

export const evaluateTriggers = (
    gameState: GameState, 
    phase: TriggerPhase,
    onTriggerUpdate?: (id: string, updates: Partial<Trigger>) => void,
    contextCharId?: string
): TriggerResult => {
    const allTriggers = Object.values(gameState.triggers || {});

    // 1. Filter by Phase & Enabled
    const relevantTriggers = allTriggers.filter(t => {
        if (!t.enabled) return false;
        
        if (Array.isArray(t.phase)) {
            return t.phase.includes(phase);
        }
        return t.phase === phase;
    });

    const passedTriggers: { trigger: Trigger, values: Record<string, any> }[] = [];

    relevantTriggers.forEach(trigger => {
        // --- A. Disable Conditions Check ---
        if (trigger.disableConditions && trigger.disableConditions.length > 0) {
            const disableCheck = checkConditionList(trigger.disableConditions, gameState, contextCharId);
            if (disableCheck.isMet) {
                if (onTriggerUpdate) {
                    onTriggerUpdate(trigger.id, { enabled: false });
                }
                return; // Skip evaluation
            }
        }

        // --- B. Trigger Conditions Check ---
        const triggerCheck = checkConditionList(trigger.conditions, gameState, contextCharId);
        
        if (triggerCheck.isMet) {
            passedTriggers.push({ trigger, values: triggerCheck.values });
            
            // Handle Auto-Disable Logic (Max Triggers)
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
    let promptSuffix = "";
    let guidanceSuffix = "";
    const combinedLogs: LogResult[] = [];
    const collectedEffects: TriggerEffect[] = [];

    passedTriggers.forEach(({ trigger, values }) => {
        // Construct MacroContext
        const ctx: MacroContext = {
            gameState,
            activeCharId: contextCharId || gameState.round.activeCharId,
            dynamicParams: values // Pass condition values as dynamic params
        };

        if (trigger.urgentRequirement) {
            const req = processMacros(trigger.urgentRequirement, ctx);
            if (trigger.isUrgent) {
                promptSuffix += `- 额外紧急需求: ${req}`;
            } else {
                guidanceSuffix += `- ${req}`;
            }
        }

        // Collect Effects
        if (trigger.effects) {
            collectedEffects.push(...trigger.effects);
        }

        // 1. Always add a system log indicating triggering
        combinedLogs.push({
            content: `系统: 「${trigger.name}」被触发。`,
            type: 'system'
        });

        // 2. Add custom log as Narrative (if exists)
        let rawNarrative = trigger.systemLog;
        if (trigger.narrativeLogs && trigger.narrativeLogs.length > 0) {
            const idx = Math.floor(Math.random() * trigger.narrativeLogs.length);
            rawNarrative = trigger.narrativeLogs[idx];
        }

        if (rawNarrative) {
            const log = processMacros(rawNarrative, ctx);
            if (log.trim()) {
                combinedLogs.push({
                    content: log,
                    type: 'narrative' 
                });
            }
        }
    });

    return {
        promptSuffix,
        guidanceSuffix,
        logs: combinedLogs,
        effects: collectedEffects
    };
};

/**
 * Execute Side Effects of Triggers.
 * This should be called by the Hook layer which has access to State Updates.
 */
export const executeEffects = (
    gameState: GameState, 
    effects: TriggerEffect[],
    updateState: (updater: (current: GameState) => GameState) => void,
    addLog: (text: string) => void,
    contextCharId?: string
) => {
    if (!effects || effects.length === 0) return;

    updateState(prev => {
        const newChars = { ...prev.characters };
        const newWorldAttrs = { ...prev.world.attributes };
        const newTriggers = { ...prev.triggers };
        let stateChanged = false;
        
        // Helper to resolve targets
        const resolveTargets = (eff: TriggerEffect): Character[] => {
            const currentId = contextCharId || prev.round.activeCharId;
            let targets: Character[] = [];

            if (eff.characterId === 'current') {
                if (currentId && newChars[currentId]) targets = [newChars[currentId]];
            } else if (eff.characterId && eff.characterId !== 'all') {
                if (newChars[eff.characterId]) targets = [newChars[eff.characterId]];
            } else {
                // All or filtered by location
                targets = Object.values(newChars);
                if (eff.locationId && eff.locationId !== 'all') {
                    targets = targets.filter(c => prev.map.charPositions[c.id]?.locationId === eff.locationId);
                }
            }
            return targets;
        };
        
        // Collect existing attribute IDs for generation
        const existingAttrIds = new Set<string>();
        Object.values(newChars).forEach(c => Object.keys(c.attributes).forEach(k => existingAttrIds.add(k)));
        Object.keys(newWorldAttrs).forEach(k => existingAttrIds.add(k));

        effects.forEach(eff => {
            if (eff.type === 'char_attr') {
                const targets = resolveTargets(eff);
                targets.forEach(char => {
                    const attrKey = eff.targetName || "";
                    if (!attrKey) return;
                    
                    const attr = getAttr(char, attrKey);
                    
                    // Calculation Logic with robust default (50)
                    let newVal: string | number = "";
                    const currentVal = attr ? attr.value : undefined;
                    
                    if (eff.value) {
                        newVal = calculateNewValue(currentVal, eff.value);
                    }

                    // Update or Create Attribute
                    if (attr) {
                         const newAttr = { ...attr, value: newVal };
                         char.attributes = { ...char.attributes, [attr.id]: newAttr };
                    } else {
                         // Create new using standardized ID
                         const newId = generateAttributeId(existingAttrIds);
                         existingAttrIds.add(newId);
                         
                         const type = typeof newVal === 'number' ? AttributeType.NUMBER : AttributeType.TEXT;
                         char.attributes = { 
                             ...char.attributes, 
                             [newId]: { id: newId, name: attrKey, type, value: newVal, visibility: AttributeVisibility.PUBLIC } 
                         };
                    }
                    stateChanged = true;
                    addLog(`系统: ${char.name} 的 [${attrKey}] 变更为 ${newVal}。`);
                });

            } else if (eff.type === 'world_attr') {
                // World Attribute Logic
                const attrKey = eff.targetName || "";
                if (!attrKey) return;

                let attrId = Object.keys(newWorldAttrs).find(id => newWorldAttrs[id].name === attrKey) || attrKey;
                const attr = newWorldAttrs[attrId];
                
                // Calculation Logic with robust default (50)
                let newVal: string | number = "";
                const currentVal = attr ? attr.value : undefined;
                
                if (eff.value) {
                    newVal = calculateNewValue(currentVal, eff.value);
                }

                if (attr) {
                    newWorldAttrs[attrId] = { ...attr, value: newVal };
                } else {
                    const newId = generateAttributeId(existingAttrIds);
                    existingAttrIds.add(newId);
                    
                    const type = typeof newVal === 'number' ? AttributeType.NUMBER : AttributeType.TEXT;
                    newWorldAttrs[newId] = { id: newId, name: attrKey, type, value: newVal, visibility: AttributeVisibility.PUBLIC };
                }
                stateChanged = true;
                addLog(`系统: 世界属性 [${attrKey}] 变更为 ${newVal}。`);

            } else if (eff.type === 'trigger_toggle') {
                // Trigger Toggle Logic
                if (eff.targetTriggerIds && eff.targetTriggerIds.length > 0 && eff.triggerOperation) {
                    eff.targetTriggerIds.forEach(tId => {
                        const trigger = newTriggers[tId];
                        if (trigger) {
                            const newEnabled = eff.triggerOperation === 'enable';
                            if (trigger.enabled !== newEnabled) {
                                newTriggers[tId] = { ...trigger, enabled: newEnabled };
                                addLog(`系统: 触发器 [${trigger.name}] 已被 ${newEnabled ? '启用' : '禁用'}。`);
                                stateChanged = true;
                            }
                        }
                    });
                }

            } else if (eff.type === 'char_card') {
                const targets = resolveTargets(eff);
                targets.forEach(char => {
                    if (eff.cardOperation === 'add') {
                         // Value is assumed to be JSON array of card IDs from CardPool
                         try {
                             const cardIds = JSON.parse(eff.cardValue || "[]");
                             if (Array.isArray(cardIds)) {
                                 // Logic: Clone from pool with new instance ID
                                 // We need to access pool from PREV state, but use generateCardId logic
                                 const usedCardIds = new Set(prev.cardPool.map(c => c.id)); 
                                 // Note: generateCardId requires access to current pool, which we have in 'prev'
                                 
                                 const newInventoryIds: string[] = [];
                                 const newPoolCards: Card[] = [];

                                 cardIds.forEach((poolId: string) => {
                                     const tmpl = prev.cardPool.find(c => c.id === poolId);
                                     if (tmpl) {
                                         const newId = generateCardId(usedCardIds);
                                         usedCardIds.add(newId);
                                         const newCard = { ...tmpl, id: newId };
                                         newCard.effects = (newCard.effects || []).map((e, i) => ({ ...e, id: `eff_${newId}_${i}` }));
                                         newPoolCards.push(normalizeCard(newCard));
                                         newInventoryIds.push(newId);
                                     }
                                 });

                                 if (newInventoryIds.length > 0) {
                                     char.inventory = [...char.inventory, ...newInventoryIds];
                                     // We need to update global card pool too
                                     // This is tricky inside a char loop. 
                                     // Ideally we'd accumulate all new cards and return them at end.
                                     // For simplicity, we assume we can mutate prev.cardPool here (since we return a new state object)
                                     // But better practice is to clone pool.
                                     // Let's do a direct mutation on the CLONED charMap, but for pool we need to be careful.
                                     // Since updateState is holistic, we can return updated cardPool.
                                     // BUT we are inside a char map update.
                                     
                                     // Workaround: Store new cards in a temp array outside loop and merge later?
                                     // For now, let's assume we can push to a temporary pool accumulation
                                 }
                                 // Note: Actual pool update needs to happen. 
                                 // We'll attach newPoolCards to the returned state.
                                 (prev as any)._tempNewCards = [...((prev as any)._tempNewCards || []), ...newPoolCards];
                                 
                                 addLog(`系统: ${char.name} 获得了 ${newInventoryIds.length} 张卡牌。`);
                                 stateChanged = true;
                             }
                         } catch (e) { console.warn("Card Add Parse Error", e); }

                    } else if (eff.cardOperation === 'remove') {
                        // Value is comma separated names
                        const names = (eff.cardValue || "").split(',').map(s => s.trim().toLowerCase());
                        const toRemove: string[] = [];
                        
                        char.inventory.forEach(invId => {
                            const card = prev.cardPool.find(c => c.id === invId);
                            if (card && names.some(n => card.name.toLowerCase().includes(n))) {
                                toRemove.push(invId);
                            }
                        });

                        if (toRemove.length > 0) {
                            char.inventory = char.inventory.filter(id => !toRemove.includes(id));
                            addLog(`系统: ${char.name} 失去了 ${toRemove.length} 张卡牌。`);
                            stateChanged = true;
                        }
                    }
                });
            }
        });

        if (!stateChanged) return prev;
        
        // Merge temp new cards if any
        let finalPool = prev.cardPool;
        if ((prev as any)._tempNewCards) {
            finalPool = [...prev.cardPool, ...(prev as any)._tempNewCards];
            delete (prev as any)._tempNewCards;
        }

        return { 
            ...prev, 
            characters: newChars, 
            cardPool: finalPool,
            world: { ...prev.world, attributes: newWorldAttrs },
            triggers: newTriggers
        };
    });
};
