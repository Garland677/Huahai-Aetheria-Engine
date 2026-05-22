
import { MutableRefObject } from 'react';
import { GameState, Character, MapLocation, Card, AttributeType, AttributeVisibility, Effect } from '../../types';
import { normalizeCard } from '../../services/aiService';
import { getAttr, getCP, removeInstances } from '../../services/attributeUtils';
import { generateCardId, generateConflictId, generateEffectId } from '../../services/idUtils';

interface UseWorldActionsProps {
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string, overrides?: any) => void;
}

export const useWorldActions = ({ stateRef, updateState, addLog }: UseWorldActionsProps) => {

    const processMove = (charId: string, destinationId: string, destinationName?: string) => {
        const state = stateRef.current;
        const char = state.characters[charId];
        const dest = state.map.locations[destinationId];
        
        // Validation handled by caller mostly, but double check
        if (!char || !dest) {
            addLog(`> 目标地点无效。`);
            return;
        }

        // --- Physique Check (Threshold: 30) ---
        // Environment characters (env_*) bypass this check to ensure story progression.
        if (!char.id.startsWith('env_')) {
            const physiqueAttr = getAttr(char, '体能');
            const physiqueVal = physiqueAttr ? Number(physiqueAttr.value) : 0;
            
            if (!isNaN(physiqueVal) && physiqueVal < 30) {
                addLog(`> ${char.name} 体能不足 (${physiqueVal}/30)，身体过于疲惫，无法移动至其它地点。`);
                return;
            }
        }
        // --------------------------------------

        updateState(prev => {
            const newChars = { ...prev.characters };
            const movingChar = { ...newChars[charId] };
            
            // --- Update Active Attribute (+30 on Move) ---
            const activeAttr = movingChar.attributes['活跃'] || movingChar.attributes['active'];
            if (activeAttr) {
                movingChar.attributes = {
                    ...movingChar.attributes,
                    [activeAttr.id]: { ...activeAttr, value: Math.min(100, Number(activeAttr.value) + 30) }
                };
            } else {
                movingChar.attributes = {
                    ...movingChar.attributes,
                    '活跃': { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 80, visibility: AttributeVisibility.PUBLIC }
                };
            }
            // ---------------------------------------------
            
            // Add conflict on move
            const newConflictId = generateConflictId(movingChar.conflicts || []);

            movingChar.conflicts = [
                ...(movingChar.conflicts || []),
                {
                    id: newConflictId,
                    desc: "刚到此地，对当地情况不熟悉",
                    apReward: 2,
                    solved: false
                }
            ];

            // Clear Move Plan upon execution
            movingChar.movePlan = undefined;

            newChars[charId] = movingChar;

            const newMap = { ...prev.map };
            
            // Update Char Position
            newMap.charPositions = {
                ...newMap.charPositions,
                [charId]: {
                    x: dest.coordinates.x,
                    y: dest.coordinates.y,
                    locationId: dest.id
                }
            };

            // Removed: Do NOT update activeLocationId when a character moves.
            // Players might want to stay observing the current location.

            return {
                ...prev,
                map: newMap,
                characters: newChars
            };
        });
        
        const isUnknown = !dest.isKnown;
        const nameToLog = destinationName || dest.name;
        // Updated: Log as ACTION type so AI sees it in history
        addLog(`${char.name} 移动前往了 ${isUnknown ? "未知地点" : `[${nameToLog}]`}`, { type: 'action', actingCharId: charId });
    };

    const processCardCreation = (charId: string, cardTemplate: Card) => {
        const state = stateRef.current;
        const char = state.characters[charId];
        if (!char) return;

        const cost = state.defaultSettings.gameplay.defaultCreationCost ?? 20;
        const currentCP = getCP(char);

        if (currentCP >= cost) {
            const cpAttr = getAttr(char, 'cp');
            if (cpAttr) {
                const newName = cardTemplate.name;
                const newDesc = cardTemplate.description || "AI Generated Skill";
                
                // Check for duplicate in pool
                const existing = state.cardPool.find(c => c.name === newName && c.description === newDesc);
                
                const finalCardCost = Math.max(1, Math.floor(cost / 2));

                // FIX: Ensure default effects for active cards if missing
                const effectiveEffects: Effect[] = (cardTemplate.effects && cardTemplate.effects.length > 0) 
                    ? cardTemplate.effects 
                    : (cardTemplate.triggerType === 'active' || cardTemplate.triggerType === 'reaction' 
                        ? [{
                            id: generateEffectId(new Set()), // Isolated creation, assume unique enough for single use
                            name: "基础效果",
                            targetType: 'specific_char' as const,
                            targetAttribute: '健康',
                            value: 0,
                            conditionDescription: "无",
                            conditionContextKeys: []
                          }]
                        : []);

                const finalCard = existing || normalizeCard({ 
                    ...cardTemplate, 
                    itemType: cardTemplate.itemType || 'skill',
                    triggerType: cardTemplate.triggerType || 'active',
                    effects: effectiveEffects,
                    id: generateCardId(state.cardPool),
                    description: newDesc,
                    cost: finalCardCost 
                });
                
                updateState(prev => {
                    const newPool = existing ? prev.cardPool : [...prev.cardPool, finalCard];
                    
                    const newChars = { ...prev.characters };
                    const targetChar = { ...newChars[charId] };
                    
                    // Safe update of attributes
                    targetChar.attributes = { ...targetChar.attributes };

                    // Deduct CP
                    if (targetChar.attributes[cpAttr.id]) {
                        targetChar.attributes[cpAttr.id] = { ...targetChar.attributes[cpAttr.id], value: currentCP - cost };
                    }

                    // --- Update Active Attribute (+30 on Create) ---
                    const activeAttr = targetChar.attributes['活跃'] || targetChar.attributes['active'];
                    if (activeAttr) {
                        targetChar.attributes[activeAttr.id] = { ...activeAttr, value: Math.min(100, Number(activeAttr.value) + 30) };
                    } else {
                        targetChar.attributes['活跃'] = { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 80, visibility: AttributeVisibility.PUBLIC };
                    }
                    // -----------------------------------------------

                    targetChar.inventory = [...targetChar.inventory, finalCard.id];
                    newChars[charId] = targetChar;

                    return {
                        ...prev,
                        cardPool: newPool,
                        characters: newChars
                    };
                });
                
                addLog(`> ${char.name} 领悟了技能 [${finalCard.name}] (-${cost} CP) 并加入了背包。${existing ? '(复用现有技能)' : ''}`);
            }
        } else {
            addLog(`> ${char.name} 想要领悟 [${cardTemplate.name}] 但创造点数不足。`);
        }
    };

    const processRedeem = (charId: string, targetCharId: string, oldCardId: string, newCardTemplate: Card) => {
        const state = stateRef.current;
        const targetChar = state.characters[targetCharId];
        
        if (targetChar && targetChar.inventory.includes(oldCardId)) {
            // Used for unique effect generation
            const tempEffectIds = new Set<string>();

            // Fix: ensure effects exist here too if needed
            const effectiveEffects = (newCardTemplate.effects && newCardTemplate.effects.length > 0)
                ? newCardTemplate.effects
                : (newCardTemplate.triggerType === 'active' || newCardTemplate.triggerType === 'reaction'
                    ? [{
                        id: generateEffectId(tempEffectIds),
                        name: "基础效果",
                        targetType: 'specific_char' as const,
                        targetAttribute: '健康',
                        value: 0,
                        conditionDescription: "无",
                        conditionContextKeys: []
                      }]
                    : []);

            let realCard: Card = {
                ...newCardTemplate,
                id: generateCardId(state.cardPool), // New card from redemption
                effects: effectiveEffects.map((e: any) => {
                     const eid = generateEffectId(tempEffectIds);
                     tempEffectIds.add(eid);
                     return {...e, id: eid};
                })
            };
            realCard = normalizeCard(realCard);

            updateState(prev => ({
                ...prev,
                cardPool: [...prev.cardPool, realCard],
                characters: {
                    ...prev.characters,
                    [targetCharId]: {
                        ...prev.characters[targetCharId],
                        inventory: [...removeInstances(prev.characters[targetCharId].inventory, [oldCardId]), realCard.id]
                    }
                }
            }));
            addLog(`> [系统] 奖励兑现: ${targetChar.name} 的奖励已兑换为 [${realCard.name}]。`);
        }
    };

    return { processMove, processCardCreation, processRedeem };
};
