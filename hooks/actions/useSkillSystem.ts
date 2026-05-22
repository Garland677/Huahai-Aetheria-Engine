
import { MutableRefObject } from 'react';
import { GameState, Character, Card, AttributeType, AttributeVisibility, DebugLog, Trigger } from '../../types';
import { checkConditionsBatch, determineCharacterReaction, getGlobalMemory, normalizeCard } from '../../services/aiService';
import { DEFAULT_AI_CONFIG } from '../../config';
import { getAttr, getCP, removeInstances } from '../../services/attributeUtils';
import { ImageContextBuilder } from '../../services/ai/ImageContextBuilder';
import { generateAttributeId } from '../../services/idUtils';
import { updateStream, finishStream } from '../../services/streamService';

interface UseSkillSystemProps {
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string, overrides?: Partial<any>) => void;
    addDebugLog: (log: DebugLog) => void;
    checkSession: () => number;
    requestPlayerReaction?: (charId: string, title: string, message: string) => Promise<string | null>;
    handleTriggerUpdate: (id: string, updates: Partial<Trigger>) => void;
}

export const useSkillSystem = ({
    stateRef, updateState, addLog, addDebugLog, checkSession, requestPlayerReaction, handleTriggerUpdate
}: UseSkillSystemProps) => {

    const updateLogEntry = (logId: string, content: string) => {
        updateState(prev => ({
            ...prev,
            world: {
                ...prev.world,
                history: prev.world.history.map(l => l.id === logId ? { ...l, content } : l)
            }
        }));
    };

    const formatReason = (rawReason: string) => {
        if (!rawReason) return "条件符合";
        let cleaned = rawReason.replace(/eff_\d+/g, '').replace(/\(Hit Check\)/gi, '').trim();
        cleaned = cleaned.replace(/^(Because|Reason:|原因:|由于)/i, '').trim();
        return cleaned || "条件符合";
    };

    const executeSkill = async (cardInput: Card, sourceCharId: string, targetId?: string, isBurningLife: boolean = false, isFreeAction: boolean = false): Promise<void> => {
        // Deep copy the card to ensure isolation for this specific execution
        const card: Card = JSON.parse(JSON.stringify(cardInput));

        const startSession = checkSession();
        const currentState = stateRef.current;
        const sourceChar = currentState.characters[sourceCharId];
        if (!sourceChar) return;

        // Physique Cost & Burning Life Logic
        let costToPay = 0;
        let healthPenalty = 0;

        if (!isFreeAction && card.triggerType === 'active' && !sourceCharId.startsWith('env_')) {
            costToPay = 20; 

            if (isBurningLife) {
                costToPay += 20;
            }

            const physiqueAttr = getAttr(sourceChar, '体能');
            const currentPhy = physiqueAttr ? Number(physiqueAttr.value) : 0;

            if (currentPhy < costToPay) {
                healthPenalty = costToPay - currentPhy;
                costToPay = currentPhy; 
            }

            if (costToPay > 0 || healthPenalty > 0) {
                updateState(prev => {
                    const newChars = { ...prev.characters };
                    const c = newChars[sourceCharId];
                    if (c) {
                        if (costToPay > 0) {
                            const pAttr = getAttr(c, '体能');
                            if (pAttr) pAttr.value = Math.max(0, Number(pAttr.value) - costToPay);
                        }
                        if (healthPenalty > 0) {
                            const hAttr = getAttr(c, '健康');
                            if (hAttr && Number(hAttr.value) === -1) {
                                // Locked
                            } else if (hAttr) {
                                const newVal = Number(hAttr.value) - healthPenalty;
                                hAttr.value = Math.max(-1, newVal);
                            }
                        }
                    }
                    return { ...prev, characters: newChars };
                });

                if (healthPenalty > 0) {
                    addLog(`> ⚠️ 燃命: ${sourceChar.name} 体能不足，强行发动 [${card.name}] (体能-${costToPay}, 健康-${healthPenalty})!`);
                }
            }
        }

        let primaryTargetId = targetId || "";
        const activeLocId = currentState.map.activeLocationId;
        
        if (!primaryTargetId) {
             const firstTargetEffect = card.effects.find(e => e.targetType === 'specific_char' || e.targetType === 'ai_choice');
             if (firstTargetEffect) {
                 if (firstTargetEffect.targetId) primaryTargetId = firstTargetEffect.targetId;
                 else {
                    const candidates = (Object.values(currentState.characters) as Character[]).filter(c => {
                         const pos = currentState.map.charPositions[c.id];
                         return c.id !== sourceCharId && pos && pos.locationId === activeLocId;
                    }).map(c => c.id);
                    primaryTargetId = candidates[Math.floor(Math.random() * candidates.length)] || sourceCharId;
                 }
             }
        }

        let logMsg = `${sourceChar.name} 发动了${card.triggerType === 'reaction' ? '反应' : ''}技能「${card.name}」`;
        if (primaryTargetId && currentState.characters[primaryTargetId]) {
             logMsg += ` (目标: ${currentState.characters[primaryTargetId].name})`;
        }
        addLog(logMsg, { actingCharId: sourceCharId });

        if (!isFreeAction && card.triggerType === 'reaction' && !sourceCharId.startsWith('env_')) {
             updateState(prev => {
                 const newChars = { ...prev.characters };
                 const c = newChars[sourceCharId];
                 if (c) {
                     const activeAttr = getAttr(c, '活跃');
                     if (activeAttr) {
                         activeAttr.value = Math.min(100, Number(activeAttr.value) + 20);
                     } else {
                         c.attributes['活跃'] = { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 70, visibility: AttributeVisibility.PUBLIC };
                     }
                 }
                 return { ...prev, characters: newChars };
             });
        }

        const localChars = (Object.values(currentState.characters) as Character[]).filter(c => {
            const p = currentState.map.charPositions[c.id];
            return p && p.locationId === activeLocId;
        });

        // 1. Pure RP Cards (No Effects)
        if (!card.effects || card.effects.length === 0) {
            addLog(`> 互动生效`, { isReaction: true });
            
            if (card.itemType === 'consumable') {
                 updateState(prev => ({
                     ...prev,
                     characters: {
                         ...prev.characters,
                         [sourceCharId]: {
                             ...prev.characters[sourceCharId],
                             inventory: removeInstances(prev.characters[sourceCharId].inventory, [card.id])
                         }
                     }
                 }));
            }

            if (primaryTargetId) {
                if (!isFreeAction && !primaryTargetId.startsWith('env_')) {
                    updateState(prev => {
                        const newChars = { ...prev.characters };
                        const t = newChars[primaryTargetId];
                        if (t) {
                            const activeAttr = getAttr(t, '活跃');
                            if (activeAttr) {
                                activeAttr.value = Math.min(100, Number(activeAttr.value) + 10);
                            } else {
                                t.attributes['活跃'] = { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 60, visibility: AttributeVisibility.PUBLIC };
                            }
                        }
                        return { ...prev, characters: newChars };
                    });
                }

                const tChar = currentState.characters[primaryTargetId];
                if (tChar) {
                    let reactionText = "";
                    let generatedSecrets: any[] = [];
                    
                    const descInfo = `(描述: ${card.description})`;
                    const prompt = `${sourceChar.name} 对你使用了 [${card.name}] ${descInfo}。你如何回应？`;
                    
                    const isStreaming = stateRef.current.appSettings.enableStreaming !== false;
                    let streamLogId = "";
                    
                    if (tChar.isPlayer && !stateRef.current.round.autoReaction && requestPlayerReaction) {
                        const manual = await requestPlayerReaction(tChar.id, `反应 (Reaction)`, prompt);
                        if (manual === null) return;
                        reactionText = manual;
                    } else {
                        if (checkSession() !== startSession) return;
                        
                        if (isStreaming) {
                             streamLogId = `log_react_pure_${Date.now()}`;
                             addLog(`(...)`, { id: streamLogId, actingCharId: tChar.id, isReaction: true });
                        }

                        const result = await determineCharacterReaction(
                            tChar, 
                            prompt,
                            stateRef.current.appSettings, 
                            stateRef.current.defaultSettings, 
                            stateRef.current.world.attributes, 
                            stateRef.current.world.history,
                            activeLocId,
                            stateRef.current.appSettings.maxCharacterMemoryRounds ?? 10,
                            addDebugLog,
                            localChars,
                            stateRef.current.cardPool,
                            stateRef.current.globalContext,
                            stateRef.current, 
                            (msg) => addLog(msg, { type: 'system' }),
                            handleTriggerUpdate,
                            isStreaming ? (text) => updateStream(streamLogId, text) : undefined,
                            () => checkSession() !== startSession
                        );
                        reactionText = result.speech;
                        generatedSecrets = result.generatedSecrets || [];
                    }
                    
                    if (checkSession() === startSession) {
                        if (generatedSecrets.length > 0) {
                            updateState(prev => {
                                const newChars = { ...prev.characters };
                                const targetChar = newChars[primaryTargetId];
                                if (targetChar) {
                                    targetChar.secrets = [...(targetChar.secrets || []), ...generatedSecrets];
                                }
                                return { ...prev, characters: newChars };
                            });
                        }

                        if (reactionText) {
                            if (isStreaming && streamLogId && !tChar.isPlayer) {
                                updateLogEntry(streamLogId, reactionText);
                                finishStream(streamLogId);
                            } else {
                                addLog(`${tChar.isPlayer ? `${tChar.name}: ` : ''}${reactionText}`, { isReaction: true, actingCharId: tChar.id });
                            }
                        } else {
                            if (isStreaming && streamLogId && !tChar.isPlayer) {
                                updateLogEntry(streamLogId, `${tChar.name}有了反应。`);
                                finishStream(streamLogId);
                            } else {
                                addLog(`${tChar.name}有了反应。`, { type: 'action', actingCharId: tChar.id });
                            }
                        }
                    }
                }
            }
            return; 
        }

        // 2. Pre-Check Reaction Phase
        let preReactionText = "";
        
        if (card.triggerType === 'reaction' && primaryTargetId && primaryTargetId !== sourceCharId) {
            const tChar = currentState.characters[primaryTargetId];
            if (tChar) {
                const descInfo = `(描述: ${card.description})`;
                const prompt = `${sourceChar.name} 试图对你使用 [${card.name}] ${descInfo}。你同意吗？或者你如何回应？`;
                
                let generatedSecrets: any[] = [];
                const isStreaming = stateRef.current.appSettings.enableStreaming !== false;
                let streamLogId = "";

                if (tChar.isPlayer && !stateRef.current.round.autoReaction && requestPlayerReaction) {
                    const manual = await requestPlayerReaction(tChar.id, `前置反应 (Pre-Reaction)`, prompt);
                    if (manual === null) return;
                    preReactionText = manual;
                } else {
                    if (checkSession() !== startSession) return;
                    
                    if (isStreaming) {
                         streamLogId = `log_react_pre_${Date.now()}`;
                         addLog(`(...)`, { id: streamLogId, actingCharId: tChar.id, isReaction: true });
                    }

                    const result = await determineCharacterReaction(
                        tChar, 
                        prompt,
                        stateRef.current.appSettings, 
                        stateRef.current.defaultSettings, 
                        stateRef.current.world.attributes, 
                        stateRef.current.world.history,
                        activeLocId,
                        stateRef.current.appSettings.maxCharacterMemoryRounds ?? 10,
                        addDebugLog,
                        localChars,
                        stateRef.current.cardPool,
                        stateRef.current.globalContext,
                        stateRef.current, 
                        (msg) => addLog(msg, { type: 'system' }),
                        handleTriggerUpdate,
                        isStreaming ? (text) => updateStream(streamLogId, text) : undefined,
                        () => checkSession() !== startSession
                    );
                    preReactionText = result.speech;
                    generatedSecrets = result.generatedSecrets || [];
                }

                if (checkSession() === startSession) {
                    if (generatedSecrets.length > 0) {
                        updateState(prev => {
                            const newChars = { ...prev.characters };
                            const targetChar = newChars[primaryTargetId];
                            if (targetChar) {
                                targetChar.secrets = [...(targetChar.secrets || []), ...generatedSecrets];
                            }
                            return { ...prev, characters: newChars };
                        });
                    }

                    if (preReactionText) {
                        if (isStreaming && streamLogId && !tChar.isPlayer) {
                             updateLogEntry(streamLogId, preReactionText);
                             finishStream(streamLogId);
                        } else {
                             addLog(`${tChar.isPlayer ? `${tChar.name}: ` : ''}${preReactionText}`, { isReaction: true, actingCharId: tChar.id });
                        }
                    } else if (streamLogId) {
                        updateLogEntry(streamLogId, `${tChar.name}默默地看着。`);
                        finishStream(streamLogId);
                    }
                }
            }
        }

        // 3. AI Check Logic (Single Item Request)
        const updatedState = stateRef.current;
        const checkRequests: any[] = [];
        
        const getFullCharContext = (c: Character) => {
             const inventoryCards = c.inventory.map(id => updatedState.cardPool.find(card => card.id === id)).filter(Boolean) as Card[];
             return {
                 attributes: c.attributes,
                 skills: c.skills.map(s => ({ name: s.name, description: s.description, type: s.triggerType, visibility: s.visibility })),
                 inventory: inventoryCards.map(i => ({ name: i.name, description: i.description, type: i.itemType, visibility: i.visibility })),
                 description: c.description
             };
        };

        const entitiesContext: Record<string, any> = {
            [sourceChar.name]: getFullCharContext(sourceChar)
        };
        
        const activeLoc = activeLocId ? updatedState.map.locations[activeLocId] : null;
        if (activeLoc) {
            entitiesContext['Current_Location'] = {
                name: activeLoc.name,
                description: activeLoc.description,
                ...activeLoc.attributes
            };
        }
        
        let targetChar: Character | undefined;
        if (primaryTargetId && updatedState.characters[primaryTargetId]) {
            targetChar = updatedState.characters[primaryTargetId];
            entitiesContext[targetChar.name] = getFullCharContext(targetChar);
        }

        const isEnvironmentTarget = card.effects && card.effects[0]?.targetType === 'world';

        // Prepare Target Passives
        const targetPassiveList: any[] = [];
        if (targetChar && primaryTargetId !== sourceCharId) {
            const passives: Card[] = [];
            targetChar.skills.forEach(s => {
                if (s.triggerType === 'passive') passives.push(s);
            });
            targetChar.inventory.forEach(invId => {
                const item = updatedState.cardPool.find(c => c.id === invId);
                if (item && item.triggerType === 'passive') passives.push(item);
            });

            passives.forEach(pCard => {
                // Pass full card object instead of flattening effects to avoid duplication in Prompt
                targetPassiveList.push({
                    id: pCard.id, // Global Card ID
                    name: pCard.name,
                    description: pCard.description,
                    effects: pCard.effects // Pass complete effects list
                });
            });
        }

        // CREATE SINGLE CHECK ITEM FOR THE CARD
        const cardReqId = `check_${card.id}_${Date.now()}`;
        checkRequests.push({
            id: cardReqId,
            type: 'active',
            // Condition is usually in effects, we put a placeholder or merge them?
            // Actually prompt formatter will list all effects.
            condition: "参见具体效果列表", 
            context: { 
                source: sourceChar.name, 
                target: updatedState.characters[primaryTargetId]?.name || "World",
                actionName: card.name,
                targetReaction: preReactionText || undefined
            },
            name: card.name,
            description: card.description, 
            targetPassives: targetPassiveList,
            cardId: card.id,
            cardName: card.name,
            allEffects: card.effects
        });

        let results: Record<string, any> = {};
        if (isEnvironmentTarget) {
            results = { [cardReqId]: { result: true, reason: "Environmental Effect" } };
        } else {
            if (checkSession() !== startSession) return;
            const currentRound = updatedState.round.roundNumber;
            
            const imageBuilder = new ImageContextBuilder();
            const historyStr = getGlobalMemory(
                updatedState.world.history, 
                currentRound, 
                updatedState.appSettings.maxShortHistoryRounds || 5,
                updatedState.appSettings.maxInputTokens,
                imageBuilder
            );
            
            // Sends array of 1 item
            results = await checkConditionsBatch(
                updatedState.judgeConfig || DEFAULT_AI_CONFIG,
                checkRequests,
                { history: historyStr, world: updatedState.world.attributes },
                updatedState.appSettings,
                updatedState.defaultSettings,
                updatedState.globalContext,
                entitiesContext,
                addDebugLog,
                false,
                updatedState, 
                (msg) => addLog(msg, { type: 'system' }),
                handleTriggerUpdate,
                imageBuilder
            );
        }

        if (checkSession() !== startSession) return;

        // 4. Result Processing
        const cardResult = results[cardReqId];
        const cardHit = cardResult && cardResult.result === true;
        const mainReason = formatReason(cardResult?.reason || "判定未通过");

        // 4.5 Trade Logic check on Card Result
        if (cardHit && cardResult.tradeResult) {
            const trade = cardResult.tradeResult;
            const itemName = trade.itemName;
            const price = Math.round(Number(trade.price || 0));
            const transactionType = trade.transactionType || 'buy';
            let tradeTargetName = trade.sourceCharacterName; 

            let buyerId = '';
            let sellerId = '';
            
            if (transactionType === 'sell') {
                sellerId = sourceCharId;
                buyerId = primaryTargetId; 
                if (!buyerId) {
                    addLog(`> 出售失败: 必须要指定一个买家才能出售物品。`);
                    return;
                }
            } else {
                buyerId = sourceCharId;
                sellerId = primaryTargetId; 
                if (tradeTargetName && tradeTargetName !== sourceChar.name) {
                    const sellerChar = (Object.values(updatedState.characters) as Character[]).find(c => c.name === tradeTargetName);
                    if (sellerChar) sellerId = sellerChar.id;
                }
            }

            const buyerChar = updatedState.characters[buyerId];
            const sellerChar = sellerId ? updatedState.characters[sellerId] : null;

            if (buyerChar) {
                const buyerCP = getCP(buyerChar);
                if (price > 0 && buyerCP < price) {
                    addLog(`> 交易中断: 买方 [${buyerChar.name}] 没有足够的 CP 支付 (${buyerCP}/${price})。`);
                    return;
                }
            }

            let tradeSuccess = false;

            updateState(prev => {
                const next = { ...prev };
                const nextChars = { ...next.characters };
                const nextBuyer = buyerId ? nextChars[buyerId] : null;
                const nextSeller = sellerId ? nextChars[sellerId] : null;
                
                if (price > 0 && nextBuyer) {
                    const cpAttr = getAttr(nextBuyer, 'cp');
                    if (cpAttr) cpAttr.value = Math.round(Number(cpAttr.value) - price);
                }

                if (price > 0 && nextSeller) {
                    const tCpAttr = getAttr(nextSeller, 'cp');
                    if (tCpAttr) tCpAttr.value = Math.round(Number(tCpAttr.value) + price);
                }

                let cardIdToTransfer = '';
                
                if (nextSeller) {
                    const poolCandidates = next.cardPool.filter(c => c.name === itemName);
                    const inventoryId = nextSeller.inventory.find(invId => poolCandidates.some(pc => pc.id === invId));
                    
                    if (inventoryId) {
                        cardIdToTransfer = inventoryId;
                        nextSeller.inventory = removeInstances(nextSeller.inventory, [inventoryId]);
                    }
                }

                if (!cardIdToTransfer) {
                    let targetCard = next.cardPool.find(c => c.name === itemName);
                    if (!targetCard) {
                        targetCard = {
                            id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                            name: itemName,
                            description: trade.description || "交易获得的物品。",
                            itemType: trade.itemType || 'consumable',
                            triggerType: 'active',
                            cost: 5,
                            effects: [
                                {
                                    id: `eff_gen_${Date.now()}`,
                                    name: "基础效果",
                                    targetType: 'specific_char',
                                    targetAttribute: '健康',
                                    value: 0,
                                    conditionDescription: "无",
                                    conditionContextKeys: []
                                }
                            ],
                            visibility: AttributeVisibility.PUBLIC
                        };
                        targetCard = normalizeCard(targetCard);
                        next.cardPool = [...next.cardPool, targetCard];
                    }
                    cardIdToTransfer = targetCard.id;
                }

                if (nextBuyer) {
                    nextBuyer.inventory = [...nextBuyer.inventory, cardIdToTransfer];
                    tradeSuccess = true;
                }

                next.characters = nextChars;
                return next;
            });

            if (tradeSuccess) {
                const sellerName = sellerChar ? sellerChar.name : "未知来源";
                const buyerName = buyerChar ? buyerChar.name : "未知买家";
                const priceSuffix = price > 0 ? `，价格${price}CP` : '';
                addLog(`> ${buyerName}从${sellerName}处成功获得[${itemName}]${priceSuffix}。`);
            }
            return; 
        }

        // 5. Standard Processing
        let executionSummary = "";
        const reactors = new Set<string>();
        const triggeredPassiveDescs = new Set<string>();
        const deadChars: string[] = [];

        // Determine Passive Info
        const passiveIds = cardResult?.passiveId || [];
        const getPassiveNames = () => {
             if (!passiveIds || passiveIds.length === 0) return null;
             const names = passiveIds.map((pid: string) => {
                 const c = updatedState.cardPool.find(x => x.id === pid) ||
                           (targetChar ? targetChar.skills.find(s => s.id === pid) : null) ||
                           (targetChar ? targetChar.inventory.map(invId => updatedState.cardPool.find(x => x.id === invId)).find(c => c && c.id === pid) : null);
                 if (c) triggeredPassiveDescs.add(`${c.name}: ${c.description}`);
                 return c ? c.name : "未知技能";
             }).filter(Boolean);
             return names.length > 0 ? names.join("、") : null;
        };
        const passiveNames = getPassiveNames();
        const passiveLogSuffix = passiveNames ? `（被动触发：${passiveNames}）` : "";

        if (!cardHit) {
            const failureLog = `「${card.name}」 失败${passiveLogSuffix}：${mainReason}`;
            addLog(failureLog, { isReaction: true });
            executionSummary += failureLog + "。";
            if (!card.isVirtualAction) reactors.add(sourceCharId);
        } else {
             // Success
             const successLog = `「${card.name}」 成功${passiveLogSuffix}：${mainReason}`;
             addLog(successLog, { isReaction: true });
             executionSummary += successLog + "。";

             // Active Bonus
             if (!sourceCharId.startsWith('env_') && !isFreeAction) {
                 updateState(prev => {
                     const newChars = { ...prev.characters };
                     const c = newChars[sourceCharId];
                     if (c) {
                         const val = getAttr(c, '活跃');
                         if (val) val.value = Math.min(100, Number(val.value) + 30);
                         else c.attributes['活跃'] = { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 80, visibility: AttributeVisibility.PUBLIC };
                     }
                     return { ...prev, characters: newChars };
                 });
             }

             // Apply Effects Logic
             card.effects.forEach((eff, i) => {
                 // Determine value: Default -> Manual Override -> AI Override
                 let val = eff.value;
                 let attrName = eff.targetAttribute;
                 let tId = eff.targetId;
                 
                 // Resolve dynamic target
                 if (eff.targetType === 'specific_char' || eff.targetType === 'ai_choice') tId = primaryTargetId;
                 else if (eff.targetType === 'self') tId = sourceCharId;
                 else if (eff.targetType === 'hit_target') tId = primaryTargetId;

                 // AI Override from Root `effoverride` array
                 if (cardResult.effoverride && Array.isArray(cardResult.effoverride)) {
                     const aiOv = cardResult.effoverride.find((ov: any) => ov.id === eff.id);
                     if (aiOv) {
                         val = aiOv.value;
                         if (aiOv.targetAttribute) attrName = aiOv.targetAttribute;
                         if (aiOv.targetId) tId = aiOv.targetId;
                     }
                 }
                 
                 // Apply
                 if (tId) {
                     applyEffectChange(tId, attrName, val, card.name);
                     
                     if ((tId === primaryTargetId && tId !== sourceCharId) || (Number(val) != 0)) {
                         reactors.add(tId);
                     }
                 }
             });
             
             // Handle Extra AI Overrides (New effects not in original list)
             if (cardResult.effoverride && Array.isArray(cardResult.effoverride)) {
                 const processedIds = new Set(card.effects.map(e => e.id));
                 cardResult.effoverride.forEach((ov: any) => {
                     if (!ov.id || !processedIds.has(ov.id)) {
                         let targetId = primaryTargetId;
                         if (ov.targetId) {
                             if (updatedState.characters[ov.targetId]) targetId = ov.targetId;
                             else {
                                 const found = Object.values(updatedState.characters).find(c => c.name === ov.targetId);
                                 if (found) targetId = found.id;
                             }
                         }
                         if (targetId) {
                            applyEffectChange(targetId, ov.targetAttribute || '健康', ov.value, card.name);
                            reactors.add(targetId);
                         }
                     }
                 });
             }
        }

        // Helper to apply changes
        function applyEffectChange(targetId: string, attrName: string, val: string | number, sourceName: string) {
             const tChar = stateRef.current.characters[targetId];
             if (!tChar) return;

             let newValue: string | number = val;

             updateState(prev => {
                 const nextChars = { ...prev.characters };
                 const t = nextChars[targetId];
                 if (t) {
                     if (!targetId.startsWith('env_') && targetId !== sourceCharId && !isFreeAction) {
                         const actAttr = getAttr(t, '活跃');
                         if (actAttr) actAttr.value = Math.min(100, Number(actAttr.value) + 10);
                         else t.attributes['活跃'] = { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 60, visibility: AttributeVisibility.PUBLIC };
                     }

                     let attr = getAttr(t, attrName);
                     if (!attr) {
                         // Create New
                         const existingKeys = new Set(Object.keys(t.attributes));
                         const newAttrId = generateAttributeId(existingKeys);
                         let newType = AttributeType.TEXT;
                         let finalVal = val;
                         const numericVal = parseFloat(String(val));
                         if (!isNaN(numericVal)) {
                             newType = AttributeType.NUMBER;
                             finalVal = 50 + numericVal;
                         }
                         t.attributes[newAttrId] = { id: newAttrId, name: attrName, type: newType, value: finalVal, visibility: AttributeVisibility.PUBLIC };
                         addLog(`系统: [${t.name}] 觉醒了新属性 [${attrName}] (初始值: ${val})！`, { type: 'system' });
                         newValue = finalVal;
                     } else {
                         // Update Existing
                         if (attr.type === AttributeType.NUMBER) {
                             const isHealth = attr.name === '健康' || attr.name === 'Health';
                             if (isHealth && Number(attr.value) === -1) {
                                 newValue = -1;
                             } else {
                                 const rawNewVal = Number(attr.value) + Number(val);
                                 const roundedVal = Math.round(rawNewVal);
                                 const isCP = attr.name === '创造点' || attr.id === 'cp';
                                 
                                 if (isCP) attr.value = Math.max(-1, roundedVal);
                                 else if (isHealth) attr.value = Math.max(-1, Math.min(100, roundedVal));
                                 else attr.value = Math.max(-1, Math.min(100, roundedVal));
                                 
                                 newValue = attr.value;
                                 if (isHealth && newValue <= 0 && !targetId.startsWith('env_')) deadChars.push(targetId);
                             }
                         } else {
                             attr.value = String(val);
                             newValue = String(val);
                         }
                     }
                 }
                 return { ...prev, characters: nextChars };
             });

             if (Number(val) !== 0) {
                 const sign = Number(val) > 0 ? '+' : '';
                 const valStr = typeof val === 'string' ? `"${val}"` : `${sign}${val}`;
                 addLog(`> [${sourceName}] 效果: ${tChar.name} ${attrName} ${valStr} (当前: ${newValue})`);
             }
        }

        if (deadChars.length > 0) {
            const uniqueDead = Array.from(new Set(deadChars));
            uniqueDead.forEach(id => {
                const char = stateRef.current.characters[id] as Character | undefined;
                if (char) {
                    const hp = getAttr(char, '健康')?.value;
                    if (Number(hp) === -1) addLog(`${char.name}已彻底死亡。`);
                    else addLog(`${char.name}已失去意识。`);
                }
            });
        }

        if (card.itemType === 'consumable') {
             updateState(prev => ({
                 ...prev,
                 characters: {
                     ...prev.characters,
                     [sourceCharId]: {
                         ...prev.characters[sourceCharId],
                         inventory: removeInstances(prev.characters[sourceCharId].inventory, [card.id])
                     }
                 }
             }));
        }

        // 6. Post-Effect Reaction
        const uniqueReactors = Array.from(reactors);
        
        for (const reactId of uniqueReactors) {
            if (!stateRef.current.characters[reactId]) continue;
            const targetChar = stateRef.current.characters[reactId];

            let targetReaction = "";
            let generatedSecrets: any[] = [];
            let triggerPrompt = "";
            
            const passiveDetails = triggeredPassiveDescs.size > 0 
                ? `\n\n[触发的被动技能详情]:\n${Array.from(triggeredPassiveDescs).join('\n')}`
                : "";

            if (reactId === sourceCharId) {
                triggerPrompt = `你使用了 [${card.name}] (描述: ${card.description})。 结果: ${executionSummary}${passiveDetails}`;
            } else {
                triggerPrompt = `被 ${sourceChar.name} 的 [${card.name}] (描述: ${card.description}) 击中/影响。 结果: ${executionSummary}${passiveDetails}`;
            }

            const isStreaming = stateRef.current.appSettings.enableStreaming !== false;
            let streamLogId = "";

            if (targetChar.isPlayer && !stateRef.current.round.autoReaction && requestPlayerReaction) {
                const manual = await requestPlayerReaction(targetChar.id, `受击/效果反应`, triggerPrompt);
                if (manual === null) continue;
                targetReaction = manual;
            } else {
                if (checkSession() !== startSession) return;
                
                if (isStreaming) {
                     streamLogId = `log_react_post_${reactId}_${Date.now()}`;
                     addLog(`(...)`, { id: streamLogId, actingCharId: reactId, isReaction: true });
                }

                const result = await determineCharacterReaction(
                    targetChar, 
                    triggerPrompt, 
                    stateRef.current.appSettings, 
                    stateRef.current.defaultSettings, 
                    stateRef.current.world.attributes, 
                    stateRef.current.world.history,
                    activeLocId,
                    stateRef.current.appSettings.maxCharacterMemoryRounds ?? 10,
                    addDebugLog,
                    localChars,
                    stateRef.current.cardPool,
                    stateRef.current.globalContext,
                    stateRef.current, 
                    (msg) => addLog(msg, { type: 'system' }),
                    handleTriggerUpdate,
                    isStreaming ? (text) => updateStream(streamLogId, text) : undefined,
                    () => checkSession() !== startSession
                );
                targetReaction = result.speech;
                generatedSecrets = result.generatedSecrets || [];
            }
            
            if (checkSession() === startSession) {
                if (generatedSecrets.length > 0) {
                    updateState(prev => {
                        const newChars = { ...prev.characters };
                        const t = newChars[reactId];
                        if (t) {
                            t.secrets = [...(t.secrets || []), ...generatedSecrets];
                        }
                        return { ...prev, characters: newChars };
                    });
                }

                if (targetReaction) {
                    if (isStreaming && streamLogId && !targetChar.isPlayer) {
                         updateLogEntry(streamLogId, targetReaction);
                         finishStream(streamLogId);
                    } else {
                         addLog(`${targetChar.isPlayer ? `${targetChar.name}: ` : ''}${targetReaction}`, { isReaction: true, actingCharId: reactId });
                    }
                } else {
                    if (isStreaming && streamLogId && !targetChar.isPlayer) {
                        updateLogEntry(streamLogId, `${targetChar.name}有了反应。`);
                        finishStream(streamLogId);
                    } else {
                        addLog(`${targetChar.name}有了反应。`, { type: 'action', actingCharId: reactId });
                    }
                }
            }
        }
    };

    return { executeSkill };
};
