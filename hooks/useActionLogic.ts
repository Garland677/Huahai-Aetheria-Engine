
import { MutableRefObject } from 'react';
import { GameState, Character, Card, AttributeType, AttributeVisibility, MapLocation, DebugLog, Conflict, PrizeItem, Trigger } from '../types';
import { checkConditionsBatch, getGlobalMemory, determineCharacterReaction, determineCharacterAction } from '../services/aiService';
import { DEFAULT_AI_CONFIG } from '../config';
import { PendingAction } from './useEngine';
import { advanceWorldTime, parseTimeDelta } from '../services/timeUtils';

// Helper to safely remove specific instances of items from a list
// This ensures that if a user has 2 "Wine" items, consuming one only removes one.
const removeInstances = (inventory: string[], idsToRemove: string[]): string[] => {
    const newInventory = [...inventory];
    idsToRemove.forEach(id => {
        const idx = newInventory.indexOf(id);
        if (idx > -1) {
            newInventory.splice(idx, 1);
        }
    });
    return newInventory;
};

// Attribute Key Aliasing Helper
const getAttr = (char: Character, key: string) => {
    if (!char || !char.attributes) return undefined;
    if (char.attributes[key]) return char.attributes[key];
    // Normalize keys to handle casing issues if needed, though current keys are usually consistent
    const map: Record<string, string> = {
        'health': '健康', '健康': 'health',
        'cp': '创造点', '创造点': 'cp',
        'status': '状态', '状态': 'status',
        'physique': '体能', '体能': 'physique',
        'pleasure': '快感', '快感': 'pleasure',
        'energy': '能量', '能量': 'energy'
    };
    const alias = map[key];
    if (alias && char.attributes[alias]) return char.attributes[alias];
    
    // Case-insensitive fallback
    const lowerKey = key.toLowerCase();
    const foundKey = Object.keys(char.attributes).find(k => k.toLowerCase() === lowerKey);
    if (foundKey) return char.attributes[foundKey];

    return undefined;
};

const getCP = (char: Character) => {
    const attr = getAttr(char, 'cp'); 
    return Number(attr?.value || 0);
};

interface UseActionLogicProps {
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string, overrides?: Partial<any>) => void;
    setIsProcessingAI: (val: boolean) => void;
    setProcessingLabel: (val: string) => void;
    handleAiFailure: (context: string, e: any) => void;
    setSelectedCharId: (id: string) => void;
    playerInput: string;
    setPlayerInput: (val: string) => void;
    selectedCharId: string | null;
    selectedCardId: string | null;
    selectedTargetId: string | null;
    setSelectedCardId: (val: string | null) => void;
    setSelectedTargetId: (val: string | null) => void;
    pendingActions: PendingAction[];
    setPendingActions: (actions: PendingAction[]) => void;
    addDebugLog: (log: DebugLog) => void;
    // New: Reaction Request Handler
    requestPlayerReaction?: (charId: string, title: string, message: string) => Promise<string | null>;
}

export const useActionLogic = ({
    stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, setSelectedCharId,
    playerInput, setPlayerInput, selectedCharId, selectedCardId, selectedTargetId, setSelectedCardId, setSelectedTargetId,
    pendingActions, setPendingActions,
    addDebugLog,
    requestPlayerReaction
}: UseActionLogicProps) => {

    const formatReason = (rawReason: string) => {
        if (!rawReason) return "未知原因";
        let cleaned = rawReason.replace(/eff_\d+/g, '').replace(/\(Hit Check\)/gi, '').trim();
        cleaned = cleaned.replace(/^(Because|Reason:|原因:|由于)/i, '').trim();
        return cleaned;
    };

    const handleTriggerUpdate = (id: string, updates: Partial<Trigger>) => {
        updateState(prev => ({
            ...prev,
            triggers: {
                ...prev.triggers,
                [id]: { ...prev.triggers[id], ...updates }
            }
        }));
    };

    // Helper to update time and log it
    const updateTimeAndLog = (secondsPassed: number) => {
        const currentState = stateRef.current;
        const timeAttr = currentState.world.attributes['worldTime'];
        if (timeAttr && secondsPassed > 0) {
            const oldTimeStr = String(timeAttr.value);
            // Scale time if needed, though usually character time is perceived time
            const newTimeStr = advanceWorldTime(oldTimeStr, secondsPassed);
            
            updateState(prev => ({
                ...prev,
                world: {
                    ...prev.world,
                    attributes: {
                        ...prev.world.attributes,
                        worldTime: { ...prev.world.attributes['worldTime'], value: newTimeStr }
                    }
                }
            }));

            // Format for display
            const parts = newTimeStr.split(':');
            const statusAttr = currentState.world.attributes['world_status'] || currentState.world.attributes['weather'];
            const statusStr = statusAttr ? String(statusAttr.value) : "未知";
            
            const formattedTime = parts.length >= 5
                ? `${parts[0]}年${parts[1]}月${parts[2]}日${parts[3]}时${parts[4]}分`
                : newTimeStr;
                
            addLog(`当前故事时间：${formattedTime}，世界状态：${statusStr}`, { type: 'system' });
        }
    };

    const executeSkill = async (card: Card, sourceCharId: string, targetId?: string, effectOverrides?: Record<number, string | number>): Promise<void> => {
        const currentState = stateRef.current;
        const sourceChar = currentState.characters[sourceCharId];
        if (!sourceChar) return;

        // Log Usage
        addLog(`${sourceChar.name} 发动了${card.triggerType === 'reaction' ? '反应' : ''}技能「${card.name}」`);

        let primaryTargetId = targetId || "";
        const activeLocId = currentState.map.activeLocationId;
        
        // Determine Target if not explicit
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

        if (primaryTargetId && currentState.characters[primaryTargetId]) {
             addLog(`(目标: ${currentState.characters[primaryTargetId].name})`);
        }

        // Prepare Local Characters for Reaction Context
        const localChars = (Object.values(currentState.characters) as Character[]).filter(c => {
            const p = currentState.map.charPositions[c.id];
            return p && p.locationId === activeLocId;
        });

        // --- OPTIMIZATION: Zero Effects Shortcut ---
        // If a card has no effects (e.g. Interact, or simple items), treat as pure narrative success.
        if (!card.effects || card.effects.length === 0) {
            addLog(`> (行为生效)`, { isReaction: true });
            
            // Handle Consumable Logic if it's a zero-effect item
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

            // Trigger Reaction if targeted
            if (primaryTargetId) {
                const tChar = currentState.characters[primaryTargetId];
                if (tChar) {
                    let reaction = "";
                    const prompt = `${sourceChar.name} 对你使用了 [${card.name}] (描述: ${card.description})。你如何回应？`;
                    
                    // Manual Reaction Logic
                    if (tChar.isPlayer && !stateRef.current.round.autoReaction && requestPlayerReaction) {
                        const manual = await requestPlayerReaction(tChar.id, `反应 (Reaction)`, prompt);
                        reaction = manual || "";
                    } else {
                        // AI Reaction
                        reaction = await determineCharacterReaction(
                            tChar, 
                            prompt,
                            stateRef.current.appSettings, 
                            stateRef.current.defaultSettings, 
                            stateRef.current.world.attributes, 
                            stateRef.current.world.history,
                            activeLocId,
                            stateRef.current.appSettings.maxCharacterMemoryRounds,
                            addDebugLog,
                            localChars,
                            stateRef.current.cardPool,
                            stateRef.current.globalContext,
                            stateRef.current, // Trigger Support
                            (msg) => addLog(msg, { type: 'system' }),
                            handleTriggerUpdate
                        );
                    }
                    if (reaction) addLog(`${tChar.name}: "${reaction}"`, { isReaction: true });
                }
            }
            return; // Exit early
        }

        // --- STEP 1: Pre-Calculation Reaction (For 'Reaction' type cards like Trade) ---
        // E.g. Attempt to Acquire. Target reacts *before* the check succeeds/fails.
        if (card.triggerType === 'reaction' && primaryTargetId) {
             const tChar = currentState.characters[primaryTargetId];
             if (tChar) {
                 let preReaction = "";
                 const triggerPrompt = `${sourceChar.name} 正在对你使用 [${card.name}]。意图: ${card.description}。你如何应对？(如果这是交易，请决定是否接受价格)`;
                 
                 // FIX: Use stateRef.current to ensure latest autoReaction flag is used
                 if (tChar.isPlayer && !stateRef.current.round.autoReaction && requestPlayerReaction) {
                     const manual = await requestPlayerReaction(tChar.id, `被动反应 (Reaction to Action)`, triggerPrompt);
                     preReaction = manual || "";
                 } else {
                     preReaction = await determineCharacterReaction(
                        tChar, 
                        triggerPrompt,
                        stateRef.current.appSettings, 
                        stateRef.current.defaultSettings, 
                        stateRef.current.world.attributes, 
                        stateRef.current.world.history, // Current history includes the usage log above
                        activeLocId,
                        stateRef.current.appSettings.maxCharacterMemoryRounds,
                        addDebugLog,
                        localChars,
                        stateRef.current.cardPool,
                        stateRef.current.globalContext,
                        stateRef.current, // Trigger Support
                        (msg) => addLog(msg, { type: 'system' }),
                        handleTriggerUpdate
                     );
                 }

                 if (preReaction) {
                     addLog(`${tChar.name}: "${preReaction}"`, { isReaction: true });
                     // IMPORTANT: Update stateRef's history manually so the next Logic Check sees this reaction
                     // The 'addLog' function updates stateRef.current inside useGame, so we are good if we re-read stateRef.current.
                 }
             }
        }

        // --- STEP 2: Logic Check (AI Judgment) ---
        
        // Re-read state to ensure history includes the reaction we just logged
        const updatedState = stateRef.current;
        
        const checkRequests: any[] = [];
        const metaList: any[] = [];
        
        // Context collection for logic check
        const entitiesContext: Record<string, any> = {
            [sourceChar.name]: sourceChar.attributes
        };
        
        const activeLoc = activeLocId ? updatedState.map.locations[activeLocId] : null;
        if (activeLoc) {
            entitiesContext['Current_Location'] = {
                name: activeLoc.name,
                description: activeLoc.description,
                ...activeLoc.attributes
            };
        }
        if (primaryTargetId && updatedState.characters[primaryTargetId]) {
            entitiesContext[updatedState.characters[primaryTargetId].name] = updatedState.characters[primaryTargetId].attributes;
        }

        // Special Case: Auto-Success for Local Environment Target
        const isEnvironmentTarget = card.effects && card.effects[0]?.targetType === 'world';

        const effects = card.effects || [];
        for (let i = 0; i < effects.length; i++) {
            const effect = effects[i];
            let actualTargetId = "";

            if (effect.targetType === 'specific_char' || effect.targetType === 'ai_choice') {
                actualTargetId = primaryTargetId; 
            } else if (effect.targetType === 'self') actualTargetId = sourceCharId;
            else if (effect.targetType === 'hit_target') actualTargetId = primaryTargetId;

            if (actualTargetId && updatedState.characters[actualTargetId]) {
                entitiesContext[updatedState.characters[actualTargetId].name] = updatedState.characters[actualTargetId].attributes;
            }

            const overrideVal = effectOverrides?.[i];
            const isOverridden = overrideVal !== undefined && overrideVal !== null;

            checkRequests.push({
                id: `eff_${i}`,
                condition: effect.conditionDescription || "True",
                needsDynamicValue: effect.dynamicValue && !isOverridden,
                context: { source: sourceChar.name, target: updatedState.characters[actualTargetId]?.name || "World" },
                name: card.name
            });
            metaList.push({ effect, actualTargetId, index: i, overrideVal });
        }

        let results: Record<string, any> = {};
        if (isEnvironmentTarget) {
            results = {};
            checkRequests.forEach(req => {
                results[req.id] = { result: true, reason: "Environmental Effect Always Succeeds" };
            });
        } else {
            const currentRound = updatedState.round.roundNumber;
            const historyStr = getGlobalMemory(updatedState.world.history, currentRound, updatedState.appSettings.maxShortHistoryRounds || 5);
            
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
                updatedState, // Trigger Support
                (msg) => addLog(msg, { type: 'system' }),
                handleTriggerUpdate
            );
        }

        // --- STEP 3: Apply Effects ---
        
        // CHECK FOR TRADE RESULT (Enhanced for Buy/Sell)
        const firstReqId = `eff_0`;
        if (results[firstReqId]?.tradeResult) {
            const trade = results[firstReqId].tradeResult;
            const itemName = trade.itemName;
            const price = Number(trade.price || 0);
            const transactionType = trade.transactionType || 'buy'; // Default to buy
            let tradeTargetName = trade.sourceCharacterName; 

            // Define Buyer and Seller based on Transaction Type
            let buyerId = '';
            let sellerId = '';
            
            if (transactionType === 'sell') {
                // Source is Selling -> Source is Seller, Target is Buyer
                sellerId = sourceCharId;
                buyerId = primaryTargetId; 
                // If primary target is missing, abort (selling requires a buyer)
                if (!buyerId) {
                    addLog(`> 出售失败: 必须要指定一个买家才能出售物品。`);
                    return;
                }
            } else {
                // Default: Source is Buying -> Source is Buyer, Target is Seller
                buyerId = sourceCharId;
                sellerId = primaryTargetId; // Can be empty if buying from "environment/system"
                // If specific seller mentioned in AI result, try to resolve ID
                if (tradeTargetName && tradeTargetName !== sourceChar.name) {
                    const sellerChar = Object.values(updatedState.characters).find(c => c.name === tradeTargetName);
                    if (sellerChar) sellerId = sellerChar.id;
                }
            }

            const buyerChar = updatedState.characters[buyerId];
            const sellerChar = sellerId ? updatedState.characters[sellerId] : null;

            // --- CP CHECK LOGIC ---
            if (buyerChar) {
                const buyerCP = getCP(buyerChar);
                if (price > 0 && buyerCP < price) {
                    addLog(`> 交易中断: 买方 [${buyerChar.name}] 没有足够的 CP 支付 (${buyerCP}/${price})。`);
                    return;
                }
            }

            let tradeSuccess = false;

            // Execute Trade
            updateState(prev => {
                const next = { ...prev };
                const nextChars = { ...next.characters };
                const nextBuyer = buyerId ? nextChars[buyerId] : null;
                const nextSeller = sellerId ? nextChars[sellerId] : null;
                
                // 1. Deduct CP from Buyer
                if (price > 0 && nextBuyer) {
                    const cpAttr = getAttr(nextBuyer, 'cp');
                    if (cpAttr) cpAttr.value = Number(cpAttr.value) - price;
                }

                // 2. Add CP to Seller
                if (price > 0 && nextSeller) {
                    const tCpAttr = getAttr(nextSeller, 'cp');
                    if (tCpAttr) tCpAttr.value = Number(tCpAttr.value) + price;
                }

                // 3. Handle Item Transfer
                let cardIdToTransfer = '';
                
                // If Seller exists, check inventory for item
                if (nextSeller) {
                    // Try to find the item in seller's inventory by name
                    // First look in global pool to map Name -> ID
                    const poolCandidates = next.cardPool.filter(c => c.name === itemName);
                    const inventoryId = nextSeller.inventory.find(invId => poolCandidates.some(pc => pc.id === invId));
                    
                    if (inventoryId) {
                        // Seller has the item!
                        cardIdToTransfer = inventoryId;
                        // Remove from Seller
                        nextSeller.inventory = removeInstances(nextSeller.inventory, [inventoryId]);
                    }
                }

                // If no card found on seller (or no seller), create new card
                if (!cardIdToTransfer) {
                    // Check if card exists in pool to reuse definition
                    let targetCard = next.cardPool.find(c => c.name === itemName);
                    if (!targetCard) {
                        targetCard = {
                            id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                            name: itemName,
                            description: trade.description || "交易获得的物品。",
                            itemType: trade.itemType || 'consumable',
                            triggerType: 'active',
                            cost: 5,
                            effects: []
                        };
                        next.cardPool = [...next.cardPool, targetCard];
                    }
                    cardIdToTransfer = targetCard.id;
                }

                // Add to Buyer
                if (nextBuyer) {
                    // Simple add (allow duplicates)
                    nextBuyer.inventory = [...nextBuyer.inventory, cardIdToTransfer];
                    tradeSuccess = true;
                }

                next.characters = nextChars;
                return next;
            });

            // Log OUTSIDE of reducer for consistency
            if (tradeSuccess) {
                const actionLabel = transactionType === 'sell' ? "出售" : "购买";
                const sellerName = sellerChar ? sellerChar.name : "未知来源";
                const buyerName = buyerChar ? buyerChar.name : "未知买家";
                
                addLog(`> ${actionLabel}成功: ${buyerName} 获得了 [${itemName}] (来自: ${sellerName})。`);
                if (price > 0) addLog(`> 支付: ${buyerName} 支付了 ${price} CP 给 ${sellerName}。`);
            }

            return; // Exit for trade
        }

        // CHECK IF HIT FAILED
        const firstEffectRes = results[`eff_0`];
        const hitFailed = !firstEffectRes || !firstEffectRes.result;
        if (hitFailed) {
             const failureReason = formatReason(firstEffectRes?.reason || "判定未通过");
             addLog(`> 「${card.name}」 判定失效/未造成影响: ${failureReason}`, { isReaction: true });
             
             // --- FIX: Source Character (AI) Self-Reaction on Failure ---
             // If the attacker missed, THEY should react (e.g. "Darn!").
             // Only trigger if the source is NOT a player (players react manually)
             if (!sourceChar.isPlayer) {
                 const failReaction = await determineCharacterReaction(
                    sourceChar, 
                    `尝试使用 [${card.name}] 失败了。原因: ${failureReason}。`, 
                    stateRef.current.appSettings, 
                    stateRef.current.defaultSettings, 
                    stateRef.current.world.attributes, 
                    stateRef.current.world.history,
                    activeLocId,
                    stateRef.current.appSettings.maxCharacterMemoryRounds,
                    addDebugLog,
                    localChars,
                    stateRef.current.cardPool,
                    stateRef.current.globalContext,
                    updatedState, // Trigger Support
                    (msg) => addLog(msg, { type: 'system' }),
                    handleTriggerUpdate
                 );
                 if (failReaction) addLog(`${sourceChar.name}: "${failReaction}"`, { isReaction: true });
             }
             
             return; 
        }

        // APPLY ATTRIBUTE CHANGES
        let executionSummary = "";
        let reactionTargetId = "";
        const deadChars: string[] = [];
        const newCharUpdates: Record<string, Character> = {};
        let attrAdded = false;

        // New Attribute Discovery
        metaList.forEach(meta => {
            const res = results[`eff_${meta.index}`];
            if (res && res.newAttribute && meta.actualTargetId) {
                const targetChar = updatedState.characters[meta.actualTargetId];
                const attrName = res.newAttribute.name;
                if (targetChar && !getAttr(targetChar, attrName)) {
                    const attrType = res.newAttribute.type === 'TEXT' ? AttributeType.TEXT : AttributeType.NUMBER;
                    const defaultValue = attrType === AttributeType.NUMBER ? 50 : "None";
                    if (!newCharUpdates[targetChar.id]) newCharUpdates[targetChar.id] = { ...targetChar, attributes: { ...targetChar.attributes } };
                    newCharUpdates[targetChar.id].attributes[attrName] = { id: attrName, name: attrName, type: attrType, value: defaultValue, visibility: AttributeVisibility.PUBLIC };
                    addLog(`> 属性觉醒: ${res.reason || `发现新属性 [${attrName}]`}`);
                    attrAdded = true;
                }
            }
        });
        if (attrAdded) {
             updateState(prev => ({ ...prev, characters: { ...prev.characters, ...newCharUpdates } }));
             return;
        }

        // Standard Value Updates
        for (const meta of metaList) {
             const res = results[`eff_${meta.index}`];
             if (res && res.result) {
                 const targetChar = stateRef.current.characters[meta.actualTargetId];
                 let val = meta.effect.value;
                 if (meta.overrideVal !== undefined && meta.overrideVal !== null) {
                     val = meta.overrideVal;
                 } else if (meta.effect.dynamicValue && res.derivedValue) {
                     val = res.derivedValue;
                 }
                 
                 if (targetChar) {
                     let newValue: string | number = val;
                     updateState(prev => {
                         const nextChars = { ...prev.characters };
                         const t = nextChars[meta.actualTargetId];
                         if (t) {
                             let attr = getAttr(t, meta.effect.targetAttribute);
                             if (!attr) {
                                 t.attributes[meta.effect.targetAttribute] = { id: meta.effect.targetAttribute, name: meta.effect.targetAttribute, type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC };
                                 attr = t.attributes[meta.effect.targetAttribute];
                             }
                             if (attr.type === AttributeType.NUMBER) {
                                 const rawNewVal = Number(attr.value) + Number(val);
                                 attr.value = Math.max(-1, rawNewVal);
                                 newValue = attr.value;
                                 if ((attr.name === '健康' || attr.name === 'Health') && newValue <= 0 && !meta.actualTargetId.startsWith('env_')) {
                                     deadChars.push(meta.actualTargetId);
                                 }
                             } else {
                                 attr.value = String(val);
                                 newValue = String(val);
                             }
                         }
                         return { ...prev, characters: nextChars };
                     });
                     
                     if (meta.index === 0 && Number(val) === 0 && typeof val === 'number') {
                         // Hit check only
                     } else {
                         const sign = Number(val) > 0 ? '+' : '';
                         const valStr = typeof val === 'string' ? `"${val}"` : `${sign}${val}`;
                         const logMsg = `> 生效: ${targetChar.name} ${meta.effect.targetAttribute} ${valStr} (当前: ${newValue})`;
                         addLog(logMsg);
                         executionSummary += logMsg + "。";
                     }

                     if (meta.actualTargetId === primaryTargetId && meta.actualTargetId !== sourceCharId) {
                         reactionTargetId = meta.actualTargetId;
                     }
                 }
             }
        }

        if (deadChars.length > 0) {
            const uniqueDead = Array.from(new Set(deadChars));
            uniqueDead.forEach(id => {
                const deadName = stateRef.current.characters[id]?.name;
                addLog(`系统: [${deadName}] 已死亡或失去意识 (HP <= 0)。`);
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

        // --- STEP 4: Post-Calculation Reaction (For NON-Reaction cards) ---
        // If it was NOT a reaction card, the target reacts NOW to the result.
        if (card.triggerType !== 'reaction' && reactionTargetId && !deadChars.includes(reactionTargetId)) {
             const targetChar = stateRef.current.characters[reactionTargetId];
             // Allow all characters (including players) to react
             if (targetChar) {
                 let targetReaction = "";
                 const triggerPrompt = `被 ${sourceChar.name} 的 [${card.name}] 击中/影响。 结果: ${executionSummary}`;

                 // FIX: Use stateRef.current to ensure latest autoReaction flag is used
                 if (targetChar.isPlayer && !stateRef.current.round.autoReaction && requestPlayerReaction) {
                     const manual = await requestPlayerReaction(targetChar.id, `受击/效果反应 (Reaction to Effect)`, triggerPrompt);
                     targetReaction = manual || "";
                 } else {
                     targetReaction = await determineCharacterReaction(
                        targetChar, 
                        triggerPrompt, 
                        stateRef.current.appSettings, 
                        stateRef.current.defaultSettings, 
                        stateRef.current.world.attributes, 
                        stateRef.current.world.history,
                        activeLocId,
                        stateRef.current.appSettings.maxCharacterMemoryRounds,
                        addDebugLog,
                        localChars,
                        stateRef.current.cardPool,
                        stateRef.current.globalContext,
                        updatedState, // Trigger Support
                        (msg) => addLog(msg, { type: 'system' }),
                        handleTriggerUpdate
                    );
                 }
                 if (targetReaction) addLog(`${targetChar.name}: "${targetReaction}"`, { isReaction: true });
             }
        }

    };

    const performCharacterAction = async () => {
        const activeCharId = stateRef.current.round.activeCharId;
        if (!activeCharId) return;
        const char = stateRef.current.characters[activeCharId];

        // Check if dead (double check before action)
        const hp = getAttr(char, 'health')?.value ?? 0;
        if (Number(hp) <= 0 && !char.id.startsWith('env_')) {
             addLog(`> 系统: ${char.name} 处于失能状态，跳过行动。`);
             updateState(prev => ({
                ...prev,
                round: { ...prev.round, turnIndex: prev.round.turnIndex + 1, phase: 'turn_start' }
            }));
            return;
        }

        if (char.isPlayer) {
            if (selectedCharId !== activeCharId) setSelectedCharId(activeCharId);
            return; 
        }

        setIsProcessingAI(true);
        setProcessingLabel(`${char.name} 正在思考...`);
        setSelectedCharId(activeCharId);

        try {
            let currentLocation: MapLocation | undefined;
            const pos = stateRef.current.map.charPositions[activeCharId];
            if (pos && pos.locationId) currentLocation = stateRef.current.map.locations[pos.locationId];

            const nearbyKnown: MapLocation[] = [];
            const nearbyUnknown: MapLocation[] = [];
            
            if (currentLocation) {
                 (Object.values(stateRef.current.map.locations) as MapLocation[]).forEach(loc => {
                     if (loc.id === currentLocation?.id) return;
                     const dist = Math.sqrt((loc.coordinates.x - currentLocation!.coordinates.x)**2 + (loc.coordinates.y - currentLocation!.coordinates.y)**2);
                     if (dist <= 1000) {
                         if (loc.isKnown) nearbyKnown.push(loc);
                         else nearbyUnknown.push(loc);
                     }
                 });
            }

            let nearbyContext = "";
            if (nearbyKnown.length === 0 && nearbyUnknown.length === 0) {
                nearbyContext = "(附近无其它已知地点)";
            } else {
                nearbyContext = nearbyKnown.map(l => {
                    const regionName = (l.regionId && stateRef.current.map.regions[l.regionId]) 
                        ? stateRef.current.map.regions[l.regionId].name 
                        : "未知区域";
                    return `[已知] ${l.name} (位于: ${regionName})`;
                }).join(", ");
                
                if (nearbyUnknown.length > 0) {
                    nearbyContext += (nearbyKnown.length > 0 ? ", " : "") + "[其它地点] (附近的未知区域)";
                }
            }

            const localOthers: Character[] = [];
            const activeLocId = stateRef.current.map.activeLocationId;
            (Object.values(stateRef.current.characters) as Character[]).forEach(c => {
                const p = stateRef.current.map.charPositions[c.id];
                if (p && p.locationId === activeLocId) localOthers.push(c);
            });

            const action = await determineCharacterAction(
                char, 
                stateRef.current.world.history, 
                stateRef.current.world.attributes, 
                localOthers, 
                stateRef.current.globalContext, // Pass Global Context
                stateRef.current.cardPool,
                stateRef.current.appSettings,
                stateRef.current.defaultSettings,
                stateRef.current.world.worldGuidance,
                currentLocation,
                nearbyContext,
                stateRef.current.map.regions, 
                stateRef.current.prizePools,
                stateRef.current.map.locations,
                addDebugLog,
                stateRef.current, // Trigger Support
                (msg) => addLog(msg, { type: 'system' }),
                handleTriggerUpdate
            );
            
            if (stateRef.current.round.isPaused) return;

            // Separate Narrative and Speech logging
            if (action.narrative) {
                addLog(`<span class="text-slate-400 italic">* ${action.narrative} *</span>`);
            }
            if (action.speech) {
                addLog(`${char.name}: "${action.speech}"`);
            }
            // Fallback if model merged them
            if (!action.narrative && !action.speech && action['text']) {
                 addLog(`${char.name}: ${action['text']}`);
            }

            // --- Time Passage Update (AI Determined) ---
            if (action.timePassed) {
                const seconds = parseTimeDelta(action.timePassed);
                updateTimeAndLog(seconds);
            } else {
                // Default fall back if AI missed it: 1 minute
                updateTimeAndLog(60);
            }

            // --- Process Generated Conflicts ---
            if (action.generatedConflicts && action.generatedConflicts.length > 0) {
                action.generatedConflicts.forEach(c => {
                    const target = stateRef.current.characters[c.targetCharId];
                    if (target) {
                        addLog(`> 新矛盾产生: [${target.name}] ${c.desc} (+${c.apReward} AP)`);
                    }
                });

                updateState(prev => {
                    const newChars = { ...prev.characters };
                    let maxId = 0;
                    (Object.values(prev.characters) as Character[]).forEach(c => {
                        c.conflicts?.forEach(x => {
                            const n = parseInt(x.id);
                            if (!isNaN(n) && n > maxId) maxId = n;
                        });
                    });
                    let nextId = maxId + 1;

                    action.generatedConflicts!.forEach(c => {
                        const target = newChars[c.targetCharId];
                        if (target) {
                            const newConflict = {
                                id: String(nextId++),
                                desc: c.desc,
                                apReward: c.apReward || 5,
                                solved: false
                            };
                            target.conflicts = [...(target.conflicts || []), newConflict];
                        }
                    });
                    return { ...prev, characters: newChars };
                });
            }

            // --- Process Generated Drives (New) ---
            if (action.generatedDrives && action.generatedDrives.length > 0) {
                action.generatedDrives.forEach(d => {
                    const target = stateRef.current.characters[d.targetCharId];
                    if (target) {
                        addLog(`> 环境诱因: [${target.name}] 产生了新的冲动: "${d.drive.condition}" (奖励: ${d.drive.amount})`);
                    }
                });

                updateState(prev => {
                    const newChars = { ...prev.characters };
                    action.generatedDrives!.forEach(d => {
                        const target = newChars[d.targetCharId];
                        if (target) {
                            const newDrive = {
                                id: `drive_gen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                condition: d.drive.condition,
                                amount: d.drive.amount || 10,
                                weight: d.drive.weight || 50
                            };
                            target.drives = [...(target.drives || []), newDrive];
                        }
                    });
                    return { ...prev, characters: newChars };
                });
            }

            if (action.commands && action.commands.length > 0) {
                for (const cmd of action.commands) {
                    if (stateRef.current.round.isPaused) break;
                    const freshState = stateRef.current as GameState; 
                    const freshChar = freshState.characters[activeCharId];
                    const currentCP = freshChar ? getCP(freshChar) : 0;

                    if (cmd.type === 'lottery' && cmd.poolId && freshChar) {
                        const pool = freshState.prizePools[cmd.poolId];
                        const currentLocId = freshState.map.charPositions[activeCharId]?.locationId;

                        // Validate Location Access
                        if (!pool || (pool.locationIds && pool.locationIds.length > 0 && (!currentLocId || !pool.locationIds.includes(currentLocId)))) {
                             addLog(`> 操作失败: ${freshChar.name} 试图操作 [${pool ? pool.name : '未知奖池'}]，但该设施不在此地。`);
                             continue;
                        }

                        if (pool) {
                            if (cmd.action === 'draw') {
                                // Draw Action with Limits
                                const drawAmount = Math.max(pool.minDraws || 1, Math.min(pool.maxDraws || 1, cmd.amount || 1));
                                const drawnItems: PrizeItem[] = [];
                                let remainingItems = [...pool.items];
                                
                                for (let i = 0; i < drawAmount; i++) {
                                    const totalWeight = remainingItems.reduce((sum, item) => sum + (item.weight || 1), 0);
                                    if (totalWeight > 0) {
                                        let r = Math.random() * totalWeight;
                                        let selected: PrizeItem | null = null;
                                        for (const item of remainingItems) {
                                            if (r < (item.weight || 1)) {
                                                selected = item;
                                                break;
                                            }
                                            r -= (item.weight || 1);
                                        }
                                        if (selected) {
                                            drawnItems.push(selected);
                                            // Remove temporarily to avoid double picking if logic requires unique picks?
                                            // Usually lottery is removal, so we remove from pool state later. 
                                            // Here we remove from local array to support unique multiple picks in one go.
                                            remainingItems = remainingItems.filter(itm => itm.id !== selected!.id);
                                        }
                                    } else {
                                        break; // Pool empty
                                    }
                                }

                                if (drawnItems.length > 0) {
                                    const newCardsToAdd: Card[] = [];
                                    const inventoryIdsToAdd: string[] = [];
                                    
                                    drawnItems.forEach(item => {
                                        // Deduplication Check
                                        const existing = freshState.cardPool.find(c => c.name === item.name && c.description === item.description) 
                                                         || newCardsToAdd.find(c => c.name === item.name && c.description === item.description);
                                        
                                        if (existing) {
                                            inventoryIdsToAdd.push(existing.id);
                                        } else {
                                            const newCard: Card = {
                                                id: `prize_card_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                                name: item.name,
                                                description: item.description,
                                                itemType: 'consumable',
                                                triggerType: 'active',
                                                cost: 0,
                                                effects: [
                                                    {
                                                        id: `eff_prize_${Date.now()}`,
                                                        name: "奖池物品",
                                                        targetType: 'self',
                                                        targetAttribute: '健康',
                                                        value: 0,
                                                        conditionDescription: "奖池内物品",
                                                        conditionContextKeys: []
                                                    }
                                                ],
                                                visibility: item.isHidden ? AttributeVisibility.PRIVATE : AttributeVisibility.PUBLIC
                                            };
                                            newCardsToAdd.push(newCard);
                                            inventoryIdsToAdd.push(newCard.id);
                                        }
                                    });

                                    // Update State
                                    updateState(prev => ({
                                        ...prev,
                                        prizePools: {
                                            ...prev.prizePools,
                                            [pool.id]: {
                                                ...pool,
                                                items: remainingItems // Updated list after removal
                                            }
                                        },
                                        cardPool: [...prev.cardPool, ...newCardsToAdd],
                                        characters: {
                                            ...prev.characters,
                                            [activeCharId]: {
                                                ...prev.characters[activeCharId],
                                                inventory: [...prev.characters[activeCharId].inventory, ...inventoryIdsToAdd]
                                            }
                                        }
                                    }));

                                    if (!cmd.isHidden) {
                                        const itemNames = drawnItems.map(i => `[${i.name}]`).join(", ");
                                        addLog(`> 抽奖: ${freshChar.name} 从 [${pool.name}] 中抽取了 ${itemNames}！`);
                                        
                                        // Reaction trigger logic...
                                        const reaction = await determineCharacterReaction(
                                            freshChar,
                                            `我刚刚从 ${pool.name} 里抽到了 ${itemNames}。`,
                                            stateRef.current.appSettings,
                                            stateRef.current.defaultSettings,
                                            stateRef.current.world.attributes,
                                            stateRef.current.world.history,
                                            activeLocId, stateRef.current.appSettings.maxCharacterMemoryRounds, addDebugLog, localOthers, stateRef.current.cardPool,
                                            stateRef.current.globalContext,
                                            stateRef.current, // Trigger Support
                                            (msg) => addLog(msg, { type: 'system' }),
                                            handleTriggerUpdate
                                        );
                                        if(reaction) addLog(`${freshChar.name}: "${reaction}"`, { isReaction: true });
                                        
                                    } else {
                                        addLog(`> 抽奖: ${freshChar.name} 从 [${pool.name}] 中抽取了 ${drawnItems.length} 件物品...`);
                                    }
                                } else {
                                    addLog(`> 抽奖失败: ${pool.name} 是空的。`);
                                }

                            } else if (cmd.action === 'deposit') {
                                // Deposit Logic
                                const cardIdsToDeposit: string[] = [];
                                
                                // Enhanced logic to handle both string array and single string from AI
                                if (cmd.cardIds) {
                                    if (Array.isArray(cmd.cardIds)) {
                                        cardIdsToDeposit.push(...cmd.cardIds);
                                    } else if (typeof cmd.cardIds === 'string') {
                                        cardIdsToDeposit.push(cmd.cardIds);
                                    }
                                }
                                
                                // Fallback to itemName only if cardIds is empty (Legacy support)
                                if (cardIdsToDeposit.length === 0 && cmd.itemName) {
                                    const card = freshState.cardPool.find(c => c.name === cmd.itemName && freshChar.inventory.includes(c.id));
                                    if (card) cardIdsToDeposit.push(card.id);
                                }

                                if (cardIdsToDeposit.length > 0) {
                                    // Ensure cards exist in inventory (Check if inventory has ALL instances)
                                    // But AI might try to deposit 2 wines and we have 2 wines with same ID.
                                    // Logic: count occurrences in inventory vs requested.
                                    // Simplified: Just proceed with what we have.
                                    const availableDepositIds: string[] = [];
                                    const tempInv = [...freshChar.inventory];
                                    
                                    cardIdsToDeposit.forEach(id => {
                                        const idx = tempInv.indexOf(id);
                                        if (idx > -1) {
                                            availableDepositIds.push(id);
                                            tempInv.splice(idx, 1);
                                        }
                                    });
                                    
                                    if (availableDepositIds.length > 0) {
                                        const validCards = availableDepositIds.map(id => freshState.cardPool.find(c => c.id === id)).filter(Boolean) as Card[];
                                        
                                        const newPrizeItems: PrizeItem[] = validCards.map(c => ({
                                            id: `pitem_dep_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                                            name: c.name,
                                            description: c.description,
                                            weight: 1,
                                            isHidden: c.visibility === AttributeVisibility.PRIVATE
                                        }));

                                        const itemNames = validCards.map(c => `[${c.name}]`).join(", ");

                                        updateState(prev => ({
                                            ...prev,
                                            prizePools: {
                                                ...prev.prizePools,
                                                [pool.id]: {
                                                    ...pool,
                                                    items: [...pool.items, ...newPrizeItems]
                                                }
                                            },
                                            characters: {
                                                ...prev.characters,
                                                [activeCharId]: {
                                                    ...prev.characters[activeCharId],
                                                    inventory: removeInstances(prev.characters[activeCharId].inventory, availableDepositIds)
                                                }
                                            }
                                        }));
                                        
                                        // Explicit Logging Constraint: Always show full names regardless of hidden flag
                                        addLog(`> 放入: ${freshChar.name} 将 ${itemNames} 放回了 [${pool.name}]。`);
                                    } else {
                                        addLog(`> 放入失败: ${freshChar.name} 试图放入物品，但未在背包中找到对应物品。`);
                                    }
                                }
                            } else if (cmd.action === 'peek') {
                                const peekAmount = Math.max(1, cmd.amount || 1);
                                if (pool.items.length > 0) {
                                    const peekedNames: string[] = [];
                                    const tempItems = [...pool.items];
                                    
                                    for (let k = 0; k < peekAmount; k++) {
                                        if (tempItems.length === 0) break;
                                        const idx = Math.floor(Math.random() * tempItems.length);
                                        peekedNames.push(tempItems[idx].name);
                                        tempItems.splice(idx, 1);
                                    }
                                    
                                    addLog(`> 查看: ${freshChar.name} 偷偷看了一眼 [${pool.name}]，似乎看到了: ${peekedNames.join(', ')}...`);
                                } else {
                                    addLog(`> 查看: ${freshChar.name} 查看了 [${pool.name}]，里面空空如也。`);
                                }
                            }
                        }
                    } else if (cmd.type === 'redeem_card' && cmd.targetCharId && cmd.oldCardId && cmd.newCard && freshChar) {
                        // Environment Character Redemption Logic
                        const targetChar = freshState.characters[cmd.targetCharId];
                        if (targetChar && targetChar.inventory.includes(cmd.oldCardId!)) {
                            const realCard: Card = {
                                ...cmd.newCard,
                                id: `card_redeem_${Date.now()}`,
                                // Ensure effects have IDs
                                effects: (cmd.newCard.effects || []).map((e, idx) => ({...e, id: `eff_rd_${Date.now()}_${idx}`}))
                            };

                            updateState(prev => ({
                                ...prev,
                                cardPool: [...prev.cardPool, realCard],
                                characters: {
                                    ...prev.characters,
                                    [cmd.targetCharId!]: {
                                        ...prev.characters[cmd.targetCharId!],
                                        // Remove one instance of old card
                                        inventory: [...removeInstances(prev.characters[cmd.targetCharId!].inventory, [cmd.oldCardId!]), realCard.id]
                                    }
                                }
                            }));
                            addLog(`> [系统] 奖励兑现: ${targetChar.name} 的奖励已兑换为 [${realCard.name}]。`);
                        }
                    } else if (cmd.type === 'buy_card' && cmd.buyCardId && freshChar) {
                         // Deprecated - AI should not generate this anymore, but keep for compatibility/cleanup
                    } else if (cmd.type === 'use_skill' && cmd.skillId && freshChar) {
                        const skill = freshChar.skills.find(s => s.id === cmd.skillId) || freshState.cardPool.find(s => s.id === cmd.skillId && freshChar.inventory.includes(s.id));
                        
                        // STRICT VALIDATION: Cannot use passive cards
                        if (skill) {
                            if (skill.triggerType !== 'active' && skill.triggerType !== 'reaction') {
                                if (addDebugLog) {
                                    addDebugLog({
                                        id: `warn_${Date.now()}`,
                                        timestamp: Date.now(),
                                        characterName: "System",
                                        prompt: "Skill Validation Failed",
                                        response: `AI attempted to use passive skill [${skill.name}] as active action. Blocked.`
                                    });
                                }
                            } else {
                                // Pass any Effect Overrides if provided by AI
                                await executeSkill(skill, activeCharId, cmd.targetId, cmd.effectOverrides);
                            }
                        }
                    } else if (cmd.type === 'create_card' && cmd.createdCard && freshChar) {
                        const cost = stateRef.current.defaultSettings.gameplay.defaultCreationCost;
                        if (currentCP >= cost) {
                            const cpAttr = getAttr(freshChar, 'cp');
                            if (cpAttr) {
                                const newName = cmd.createdCard.name;
                                const newDesc = cmd.createdCard.description || "AI Generated Skill";
                                
                                // Check if duplicated
                                const existing = freshState.cardPool.find(c => c.name === newName && c.description === newDesc);
                                
                                const finalCard = existing || { 
                                    ...cmd.createdCard, 
                                    id: `card_gen_${Date.now()}`,
                                    description: newDesc,
                                    effects: cmd.createdCard.effects || [] 
                                };
                                
                                updateState(prev => {
                                    const newPool = existing ? prev.cardPool : [...prev.cardPool, finalCard];
                                    return {
                                        ...prev,
                                        cardPool: newPool,
                                        characters: {
                                            ...prev.characters,
                                            [activeCharId]: {
                                                ...prev.characters[activeCharId],
                                                attributes: {
                                                    ...prev.characters[activeCharId].attributes,
                                                    [cpAttr.id]: { ...cpAttr, value: currentCP - cost }
                                                },
                                                inventory: [...prev.characters[activeCharId].inventory, finalCard.id] 
                                            }
                                        }
                                    };
                                });
                                
                                // Improved Logging for Created Cards
                                const effectSummary = (finalCard.effects || []).map(e => 
                                    `${e.targetAttribute} ${e.value} (${e.targetType})`
                                ).join(', ');
                                addLog(`> 创造: ${freshChar.name} 领悟了技能 [${finalCard.name}] (-${cost} CP) 并加入了背包。${existing ? '(复用现有技能)' : ''}
                                   描述: ${finalCard.description}
                                   效果: ${effectSummary || "无"}`);
                            }
                        }
                    } else if (cmd.type === 'move_to' && cmd.destinationName && freshChar) {
                        const targetName = cmd.destinationName.trim();
                        
                        // 1. Try to match known or unknown locations loosely
                        let dest = Object.values(freshState.map.locations).find(l => l.name === targetName);
                        if (!dest) {
                            const lowerTarget = targetName.toLowerCase();
                            dest = Object.values(freshState.map.locations).find(l => l.name.toLowerCase() === lowerTarget);
                        }
                        if (!dest) {
                            dest = Object.values(freshState.map.locations).find(l => l.name.includes(targetName) || targetName.includes(l.name));
                        }

                        // 2. If exact/fuzzy match failed, check if AI means "Other Location" (Unknown)
                        if (!dest) {
                            const currentPos = freshState.map.charPositions[activeCharId];
                            if (currentPos) {
                                const candidates: MapLocation[] = [];
                                Object.values(freshState.map.locations).forEach(l => {
                                    if (l.id === currentPos.locationId) return;
                                    const dist = Math.sqrt((l.coordinates.x - currentPos.x)**2 + (l.coordinates.y - currentPos.y)**2);
                                    // Logic: If AI says "Other", pick a random unknown spot within 1000m
                                    if (dist <= 1000 && !l.isKnown) {
                                        candidates.push(l);
                                    }
                                });
                                
                                if (candidates.length > 0) {
                                    dest = candidates[Math.floor(Math.random() * candidates.length)];
                                }
                            }
                        }
                        
                        if (dest) {
                            updateState(prev => {
                                const newChars = { ...prev.characters };
                                const movingChar = { ...newChars[activeCharId] };
                                
                                let maxId = 0;
                                (Object.values(prev.characters) as Character[]).forEach(c => {
                                    c.conflicts?.forEach(x => {
                                        const n = parseInt(x.id);
                                        if (!isNaN(n) && n > maxId) maxId = n;
                                    });
                                });
                                const nextId = maxId + 1;

                                movingChar.conflicts = [
                                    ...(movingChar.conflicts || []),
                                    {
                                        id: String(nextId),
                                        desc: "刚到此地，对当地情况不熟悉",
                                        apReward: 2,
                                        solved: false
                                    }
                                ];
                                newChars[activeCharId] = movingChar;

                                return {
                                    ...prev,
                                    map: {
                                        ...prev.map,
                                        charPositions: {
                                            ...prev.map.charPositions,
                                            [activeCharId]: {
                                                x: dest.coordinates.x,
                                                y: dest.coordinates.y,
                                                locationId: dest.id // Ensure valid location ID
                                            }
                                        }
                                    },
                                    characters: newChars
                                };
                            });
                            
                            const isUnknown = !dest.isKnown;
                            addLog(`> 移动: ${freshChar.name} 前往了 ${isUnknown ? "未知地点" : `[${dest.name}]`}`);
                        } else {
                            addLog(`> 移动失败: ${freshChar.name} 想要前往 [${targetName}]，但附近没有符合条件的地点。`);
                        }
                    }
                }
            }

            updateState(prev => ({
                ...prev,
                round: { ...prev.round, turnIndex: prev.round.turnIndex + 1, phase: 'turn_start' }
            }));

        } catch (e: any) {
            handleAiFailure(`${char.name} Action`, e);
        } finally {
            setIsProcessingAI(false);
        }
    };

    const submitPlayerTurn = async (manualDurationSeconds: number = 300) => {
        if (!selectedCharId) return;
        const char = stateRef.current.characters[selectedCharId];
        if (!char) return;

        // Narrative/Speech log
        if (playerInput.trim()) {
            addLog(`${char.name}: ${playerInput}`);
            setPlayerInput("");
        } else if (pendingActions.length === 0) {
             addLog(`${char.name} (玩家) 跳过了行动。`);
        }

        // Apply manual time passage for player
        updateTimeAndLog(manualDurationSeconds);

        if (pendingActions.length > 0) {
            setIsProcessingAI(true);
            
            // Sort Pending Actions: move_to should be last
            const sortedActions = [...pendingActions].sort((a, b) => {
                if (a.type === 'move_to' && b.type !== 'move_to') return 1;
                if (a.type !== 'move_to' && b.type === 'move_to') return -1;
                return 0;
            });

            // Process queue sequentially
            for (let i = 0; i < sortedActions.length; i++) {
                const action = sortedActions[i];
                
                if (action.type === 'move_to' && action.destinationId) {
                    setProcessingLabel(`Moving to ${action.destinationName}...`);
                    const dest = stateRef.current.map.locations[action.destinationId];
                    
                    if (dest) {
                        updateState(prev => {
                            const newChars = { ...prev.characters };
                            const movingChar = { ...newChars[selectedCharId] };
                            
                            // Add conflict logic same as AI
                            let maxId = 0;
                            (Object.values(prev.characters) as Character[]).forEach(c => {
                                c.conflicts?.forEach(x => {
                                    const n = parseInt(x.id);
                                    if (!isNaN(n) && n > maxId) maxId = n;
                                });
                            });
                            const nextId = maxId + 1;

                            movingChar.conflicts = [
                                ...(movingChar.conflicts || []),
                                {
                                    id: String(nextId),
                                    desc: "刚到此地，对当地情况不熟悉",
                                    apReward: 2,
                                    solved: false
                                }
                            ];
                            newChars[selectedCharId] = movingChar;

                            return {
                                ...prev,
                                map: {
                                    ...prev.map,
                                    charPositions: {
                                        ...prev.map.charPositions,
                                        [selectedCharId]: {
                                            x: dest.coordinates.x,
                                            y: dest.coordinates.y,
                                            locationId: dest.id
                                        }
                                    }
                                    // NOTE: activeLocationId is NOT updated for player moves, maintaining "Play Area"
                                },
                                characters: newChars
                            };
                        });
                        addLog(`> 移动: ${char.name} 前往了 [${dest.name}] (视角保持当前区域)`);
                    }
                } else if (action.type === 'use_skill' && action.cardId) {
                    setProcessingLabel(`Executing ${action.cardName} (${i+1}/${sortedActions.length})...`);
                    
                    // Resolve card object again to ensure validity
                    const card = char.skills.find(s => s.id === action.cardId) || stateRef.current.cardPool.find(c => c.id === action.cardId && char.inventory.includes(c.id));

                    if (card) {
                        try {
                            await executeSkill(card, selectedCharId, action.targetId);
                            // Check pause state (error happened)
                            if (stateRef.current.round.isPaused) break;
                        } catch (e: any) {
                            handleAiFailure(`Action ${action.cardName}`, e);
                            break;
                        }
                    }
                } else if (action.type === 'lottery' && action.poolId) {
                    setProcessingLabel(`Lottery Interaction...`);
                    
                    const cmd = action as any; // Cast to allow flexible props
                    const freshState = stateRef.current;
                    const freshChar = freshState.characters[selectedCharId];
                    const pool = freshState.prizePools[cmd.poolId];
                    
                    if (pool && freshChar) {
                        if (cmd.action === 'draw') {
                             const drawAmount = Math.max(pool.minDraws || 1, Math.min(pool.maxDraws || 1, cmd.amount || 1));
                             const drawnItems: PrizeItem[] = [];
                             let remainingItems = [...pool.items];
                             
                             for (let k = 0; k < drawAmount; k++) {
                                 const totalWeight = remainingItems.reduce((sum, item) => sum + (item.weight || 1), 0);
                                 if (totalWeight > 0) {
                                     let r = Math.random() * totalWeight;
                                     let selected: PrizeItem | null = null;
                                     for (const item of remainingItems) {
                                         if (r < (item.weight || 1)) {
                                             selected = item;
                                             break;
                                         }
                                         r -= (item.weight || 1);
                                     }
                                     if (selected) {
                                         drawnItems.push(selected);
                                         remainingItems = remainingItems.filter(itm => itm.id !== selected!.id);
                                     }
                                 } else break;
                             }

                             if (drawnItems.length > 0) {
                                 const newCardsToAdd: Card[] = [];
                                 const newIds: string[] = [];
                                 
                                 drawnItems.forEach(item => {
                                     // Deduplication Logic
                                     const existing = freshState.cardPool.find(c => c.name === item.name && c.description === item.description) 
                                                      || newCardsToAdd.find(c => c.name === item.name && c.description === item.description);
                                     
                                     if (existing) {
                                         newIds.push(existing.id);
                                     } else {
                                         const newCard: Card = {
                                             id: `prize_card_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                             name: item.name, description: item.description,
                                             itemType: 'consumable', triggerType: 'active', cost: 0,
                                             effects: [], visibility: item.isHidden ? AttributeVisibility.PRIVATE : AttributeVisibility.PUBLIC
                                         };
                                         newCardsToAdd.push(newCard);
                                         newIds.push(newCard.id);
                                     }
                                 });

                                 updateState(prev => ({
                                     ...prev,
                                     prizePools: { ...prev.prizePools, [pool.id]: { ...pool, items: remainingItems } },
                                     cardPool: [...prev.cardPool, ...newCardsToAdd],
                                     characters: { ...prev.characters, [selectedCharId]: { ...prev.characters[selectedCharId], inventory: [...prev.characters[selectedCharId].inventory, ...newIds] } }
                                 }));
                                 
                                 const itemNames = drawnItems.map(i => `[${i.name}]`).join(", ");
                                 addLog(`> 抽奖: ${freshChar.name} 从 [${pool.name}] 中抽取了 ${itemNames}！`);
                             } else {
                                 addLog(`> 抽奖失败: ${pool.name} 是空的。`);
                             }
                        } else if (cmd.action === 'deposit') {
                             const cardIds = cmd.cardIds || [];
                             if (cardIds.length > 0) {
                                 // Check availability
                                 const availableDepositIds: string[] = [];
                                 const tempInv = [...freshChar.inventory];
                                 
                                 cardIds.forEach((id: string) => {
                                     const idx = tempInv.indexOf(id);
                                     if (idx > -1) {
                                         availableDepositIds.push(id);
                                         tempInv.splice(idx, 1);
                                     }
                                 });

                                 if (availableDepositIds.length > 0) {
                                     const validCards = availableDepositIds.map(id => freshState.cardPool.find(c => c.id === id)).filter(Boolean) as Card[];
                                     const newItems = validCards.map(c => ({
                                         id: `pitem_dep_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                                         name: c.name, description: c.description, weight: 1,
                                         isHidden: c.visibility === AttributeVisibility.PRIVATE
                                     }));
                                     const itemNames = validCards.map(c => `[${c.name}]`).join(", ");
                                     
                                     updateState(prev => ({
                                         ...prev,
                                         prizePools: { ...prev.prizePools, [pool.id]: { ...pool, items: [...pool.items, ...newItems] } },
                                         characters: { ...prev.characters, [selectedCharId]: { ...prev.characters[selectedCharId], inventory: removeInstances(prev.characters[selectedCharId].inventory, availableDepositIds) } }
                                     }));
                                     addLog(`> 放入: ${freshChar.name} 将 ${itemNames} 放回了 [${pool.name}]。`);
                                 }
                             }
                        } else if (cmd.action === 'peek') {
                             const peekAmount = Math.max(1, cmd.amount || 1);
                             if (pool.items.length > 0) {
                                 const peekedNames: string[] = [];
                                 const tempItems = [...pool.items];
                                 
                                 for (let k = 0; k < peekAmount; k++) {
                                     if (tempItems.length === 0) break;
                                     const idx = Math.floor(Math.random() * tempItems.length);
                                     peekedNames.push(tempItems[idx].name);
                                     tempItems.splice(idx, 1);
                                 }
                                 
                                 addLog(`> 查看: ${freshChar.name} 偷偷看了一眼 [${pool.name}]，似乎看到了: ${peekedNames.join(', ')}...`);
                             } else {
                                 addLog(`> 查看: ${freshChar.name} 查看了 [${pool.name}]，里面空空如也。`);
                             }
                        }
                    }
                }
            }
            
            setPendingActions([]); // Clear queue
            setIsProcessingAI(false);
        }

        // Only advance turn if not paused by error
        if (!stateRef.current.round.isPaused) {
            setSelectedCardId(null);
            setSelectedTargetId(null);
            updateState(prev => ({
                ...prev,
                round: { ...prev.round, turnIndex: prev.round.turnIndex + 1, phase: 'turn_start' }
            }));
        }
    };

    return {
        performCharacterAction,
        submitPlayerTurn
    };
};