


import { MutableRefObject } from 'react';
import { GameState, GamePhase, DebugLog, AttributeType, AttributeVisibility, Character, LogEntry, Trigger, Card, Conflict, Drive, StoryTag, Effect, TriggerPhase } from '../types';
import { analyzeSettlement, generateLife, checkConditionsBatch } from '../services/aiService';
import { calculateHiddenRoundStructure } from '../services/haSystem';
import { DEFAULT_AI_CONFIG } from '../config';
import { formatLifeTrajectoryNow } from '../services/contextUtils';
import { ImageContextBuilder } from '../services/ai/ImageContextBuilder';
import { getGlobalMemory } from '../services/ai/memoryUtils';
import { getAttr } from '../services/attributeUtils';
import { generateAttributeId } from '../services/idUtils';
import { evaluateTriggers, executeEffects } from '../services/triggerService';

interface UsePhaseLogicProps {
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string, overrides?: Partial<LogEntry>) => void;
    setIsProcessingAI: (val: boolean) => void;
    setProcessingLabel: (val: string) => void;
    handleAiFailure: (context: string, e: any) => void;
    setPhase: (phase: GamePhase) => void;
    addDebugLog: (log: DebugLog) => void;
    checkSession: () => number;
}

const getAttrVal = (char: Character, key: string): number => {
    if (!char || !char.attributes) return 0;
    if (char.attributes[key]) return Number(char.attributes[key].value);
    const map: Record<string, string> = {
        'health': '健康', '健康': 'health',
        'physique': '体能', '体能': 'physique',
        'active': '活跃', '活跃': 'active'
    };
    const alias = map[key];
    if (alias && char.attributes[alias]) return Number(char.attributes[alias].value);
    if (key === 'active' || key === '活跃') return 50; 
    return 0;
};



const formatReason = (rawReason: string) => {
    if (!rawReason) return "条件符合";
    let cleaned = rawReason.replace(/eff_\d+/g, '').replace(/\(Hit Check\)/gi, '').trim();
    cleaned = cleaned.replace(/^(Because|Reason:|原因:|由于)/i, '').trim();
    return cleaned || "条件符合";
};

export const usePhaseLogic = ({
    stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, setPhase, addDebugLog, checkSession
}: UsePhaseLogicProps) => {

    const handleTriggerUpdate = (id: string, updates: Partial<Trigger>) => {
        updateState(prev => ({
            ...prev,
            triggers: {
                ...prev.triggers,
                [id]: { ...prev.triggers[id], ...updates }
            }
        }));
    };

    const processSettlementCards = async (
        currentState: GameState, 
        startSession: number
    ) => {
        const activeLocId = currentState.map.activeLocationId;
        if (!activeLocId) return;

        const presentChars = Object.values(currentState.characters).filter(c => {
            const pos = currentState.map.charPositions[c.id];
            const hp = getAttrVal(c, '健康');
            return pos && pos.locationId === activeLocId && hp > -1;
        });

        if (presentChars.length === 0) return;

        interface CheckItem {
            id: string;
            type: 'active';
            condition: string;
            context: any;
            name: string;
            description: string;
            sourceId: string;
            originalTargetId?: string;
            cardId: string;
            allEffects: Effect[]; // Use allEffects for consistency
            triggerType: string;
        }

        const checkItems: CheckItem[] = [];
        const entitiesContext: Record<string, any> = {};

        const getFullCharContext = (c: Character) => {
             const inventoryCards = c.inventory.map(id => currentState.cardPool.find(card => card.id === id)).filter(Boolean) as Card[];
             return {
                 attributes: c.attributes,
                 skills: c.skills.map(s => ({ name: s.name, description: s.description, type: s.triggerType, visibility: s.visibility })),
                 inventory: inventoryCards.map(i => ({ name: i.name, description: i.description, type: i.itemType, visibility: i.visibility })),
                 description: c.description
             };
        };

        presentChars.forEach(c => {
            entitiesContext[c.name] = getFullCharContext(c);
        });

        presentChars.forEach(char => {
            const allCards = [
                ...char.skills,
                ...char.inventory.map(id => currentState.cardPool.find(c => c.id === id)).filter(Boolean) as Card[]
            ];

            allCards.forEach(card => {
                if (card.triggerType === 'settlement' || card.triggerType === 'hidden_settlement') {
                    
                    const effects = card.effects || [];
                    if (effects.length === 0) return;

                    let targetContext = "Unknown";
                    let originalTargetId = char.id; 
                    
                    const needsSmartTarget = effects.some(e => e.targetType === 'specific_char' || e.targetType === 'ai_choice');
                    
                    if (needsSmartTarget) {
                        targetContext = "AI Choice (Smart Targeting based on description)";
                    } else if (effects.some(e => e.targetType === 'self')) {
                        targetContext = char.name;
                    }

                    checkItems.push({
                        id: `settle_${char.id}_${card.id}`,
                        type: 'active',
                        condition: "参见具体效果列表", 
                        context: {
                            source: char.name,
                            target: targetContext,
                            actionName: card.name
                        },
                        name: card.name,
                        description: card.description,
                        sourceId: char.id,
                        originalTargetId: originalTargetId,
                        cardId: card.id,
                        allEffects: effects,
                        triggerType: card.triggerType
                    });
                }
            });
        });

        if (checkItems.length === 0) return;

        const config = currentState.judgeConfig || DEFAULT_AI_CONFIG;
        const imageBuilder = new ImageContextBuilder();
        const historyStr = getGlobalMemory(currentState.world.history, currentState.round.roundNumber, 5, 64000);

        // SEQUENTIAL PROCESSING
        // Due to single-object JSON response format, we must process cards individually
        for (const item of checkItems) {
            if (checkSession() !== startSession) return;

            try {
                // Send single item in array
                const result = await checkConditionsBatch(
                    config,
                    [item], // Single Item Batch
                    { history: historyStr, world: currentState.world.attributes },
                    currentState.appSettings,
                    currentState.defaultSettings,
                    currentState.globalContext,
                    entitiesContext,
                    addDebugLog,
                    false,
                    currentState,
                    undefined,
                    undefined,
                    imageBuilder
                );

                if (checkSession() !== startSession) return;

                // Result comes back as map { [itemId]: ResultObject }
                const res = result[item.id];
                
                if (res && res.result) {
                    // Success logic
                    const reason = formatReason(res.reason);
                    
                    const passiveIds = res?.passiveId || [];
                    let passiveSuffix = "";
                    if (Array.isArray(passiveIds) && passiveIds.length > 0) {
                         const pNames = passiveIds.map((pid: string) => {
                             const card = currentState.cardPool.find(c => c.id === pid) ||
                                          Object.values(currentState.characters).flatMap(c => [...c.skills, ...c.inventory.map(i=>currentState.cardPool.find(p=>p.id===i))]).find(c => c && c.id === pid);
                             return card ? card.name : "未知技能";
                         }).filter(Boolean);
                         if (pNames.length > 0) passiveSuffix = `（被动触发：${pNames.join("、")}）`;
                    }

                    updateState(prev => {
                        const nextChars = { ...prev.characters };
                        let stateChanged = false;
                        let effectSummary = "";

                        // Process Effects
                        // Check overrides
                        const overrides = Array.isArray(res.effoverride) ? res.effoverride : [];
                        
                        item.allEffects.forEach(eff => {
                            let targetId = item.originalTargetId || item.sourceId;
                            // Resolve target if dynamic override exists (rare for settlement but possible)
                            let val = eff.value;
                            let targetAttr = eff.targetAttribute;

                            // Check override by ID
                            const ov = overrides.find((o: any) => o.id === eff.id);
                            if (ov) {
                                val = ov.value;
                                if (ov.targetAttribute) targetAttr = ov.targetAttribute;
                                if (ov.targetId) {
                                     // Resolve name to ID
                                     const found = Object.values(nextChars).find(c => c.name === ov.targetId || c.id === ov.targetId);
                                     if (found) targetId = found.id;
                                }
                            }

                            // Apply
                            const targetChar = nextChars[targetId];
                            if (targetChar) {
                                 let attr = getAttr(targetChar, targetAttr);
                                 if (!attr) {
                                     // Create
                                     const existingKeys = new Set(Object.keys(targetChar.attributes));
                                     const newAttrId = generateAttributeId(existingKeys);
                                     let newType = AttributeType.TEXT;
                                     let finalVal = val;
                                     const numericVal = parseFloat(String(val));
                                     if (!isNaN(numericVal)) { newType = AttributeType.NUMBER; finalVal = 50 + numericVal; }
                                     targetChar.attributes[newAttrId] = { id: newAttrId, name: targetAttr, type: newType, value: finalVal, visibility: AttributeVisibility.PUBLIC };
                                     stateChanged = true;
                                     effectSummary += ` [${targetChar.name}] 觉醒 ${targetAttr}: ${finalVal}`;
                                 } else if (Number(val) !== 0) {
                                     if (attr.type === AttributeType.NUMBER) {
                                         if (Number(attr.value) !== -1) {
                                             const newVal = Math.max(-1, Math.min(100, Number(attr.value) + Number(val)));
                                             attr.value = newVal;
                                             stateChanged = true;
                                             const sign = Number(val) > 0 ? '+' : '';
                                             effectSummary += ` [${targetChar.name}] ${targetAttr}${sign}${val} (当前: ${newVal})`;
                                         }
                                     } else {
                                         attr.value = String(val);
                                         stateChanged = true;
                                         effectSummary += ` [${targetChar.name}] ${targetAttr} = ${val}`;
                                     }
                                 }
                            }
                        });

                        // Handle Extra Overrides
                        overrides.forEach((ov: any) => {
                            if (!ov.id || !item.allEffects.some(e => e.id === ov.id)) {
                                 // New effect
                                 let tId = item.originalTargetId || item.sourceId;
                                 if (ov.targetId) {
                                     const found = Object.values(nextChars).find(c => c.name === ov.targetId || c.id === ov.targetId);
                                     if (found) tId = found.id;
                                 }
                                 const targetChar = nextChars[tId];
                                 if (targetChar) {
                                     // (Simplified application logic same as above)
                                     let attr = getAttr(targetChar, ov.targetAttribute || '健康');
                                     if (attr && attr.type === AttributeType.NUMBER) {
                                         attr.value = Math.max(-1, Math.min(100, Number(attr.value) + Number(ov.value)));
                                         stateChanged = true;
                                         effectSummary += ` [${targetChar.name}] ${attr.name}+${ov.value}`;
                                     }
                                 }
                            }
                        });

                        if (stateChanged) {
                            // Log
                            if (item.triggerType === 'hidden_settlement') {
                                addLog(`系统: [暗流] 发生了隐秘的影响。`, { type: 'system' });
                            } else {
                                addLog(`「${item.name}」 成功${passiveSuffix}：${reason}${effectSummary}`, { type: 'action' });
                            }
                            return { ...prev, characters: nextChars };
                        }
                        return prev;
                    });
                } else if (item.triggerType !== 'hidden_settlement') {
                     // Log Failure (Optional, maybe too spammy for settlement?)
                     // addLog(`「${item.name}」 失败: ${res?.reason || "条件未满足"}`, { type: 'system' });
                }

            } catch (e) {
                console.error("Single Settlement Card Error", e);
            }
        }
    };

    const phaseOrderDetermination = async () => {
        const startSession = checkSession();
        const currentState = stateRef.current;
        
        if (currentState.round.useManualTurnOrder && !currentState.round.isHiddenRound) {
            if ((currentState.round.autoAdvanceCount || 0) > 0 && currentState.round.defaultOrder.length > 0) {
                 updateState(prev => ({
                    ...prev,
                    round: { 
                        ...prev.round, 
                        currentOrder: prev.round.defaultOrder, 
                        turnIndex: 0, 
                        phase: 'turn_start', 
                        isWaitingForManualOrder: false
                    }
                }));
                addLog(`系统: 自动推进中，沿用手动设定的行动顺序: [${currentState.round.defaultOrder.map(id => stateRef.current.characters[id]?.name || id).join(', ')}]`);
                return;
            }

            updateState(prev => ({
                ...prev,
                round: { 
                    ...prev.round, 
                    isWaitingForManualOrder: true,
                    currentOrder: prev.round.defaultOrder.length > 0 ? prev.round.defaultOrder : Object.keys(prev.characters)
                }
            }));
            return;
        }

        const locationId = currentState.map.activeLocationId;
        const allChars = Object.values(currentState.characters) as Character[];
        
        let locChars = allChars.filter(c => {
            const pos = currentState.map.charPositions[c.id];
            return pos && pos.locationId === locationId;
        });

        if (currentState.round.isHiddenRound) {
            addLog("系统: --- 隐藏轮次 (Hidden Round) ---");
            
            // PRE-CALCULATE Participants for Log Visibility
            // In the first hidden round, currentOrder might be empty in state, so we grab from queue.
            const queue = currentState.round.hiddenRoundQueue || [];
            const currentParticipants = queue.length > 0 ? queue[0] : [];

            // Execute Hidden Round Triggers (Phase: hidden_round_X)
            const counter = currentState.round.hiddenRoundCounter || 1;
            const phaseKey = `hidden_round_${counter}` as TriggerPhase;
            
            // Only execute if it's a valid phase key (1-5)
            if (counter >= 1 && counter <= 5) {
                const triggerRes = evaluateTriggers(currentState, phaseKey, handleTriggerUpdate);
                if (triggerRes.logs.length > 0) {
                    triggerRes.logs.forEach(l => addLog(l.content, { 
                        type: l.type,
                        // FIX: Inject correct participants into snapshot so memoryUtils can see them
                        snapshot: { ...currentState.round, currentOrder: currentParticipants }
                    }));
                }
                if (triggerRes.effects.length > 0) {
                    executeEffects(currentState, triggerRes.effects, updateState, addLog);
                }
            }
        }

        const aliveChars = locChars.filter(c => {
            const hp = getAttrVal(c, '健康'); 
            return hp > 0;
        });

        const envChars = aliveChars.filter(c => c.id.startsWith('env_'));
        const normalChars = aliveChars.filter(c => !c.id.startsWith('env_'));

        let finalOrder: string[] = [];

        if (!currentState.round.isHiddenRound) {
            const playerChars = normalChars.filter(c => c.isPlayer === true);
            const npcChars = normalChars.filter(c => !c.isPlayer);
            
            const maxNPCs = currentState.defaultSettings.gameplay.maxNPCsPerRound || 4;
            let selectedNPCs: Character[] = [];

            if (npcChars.length > 0) {
                const pool = [...npcChars];
                const candidates: Character[] = [];
                for (let i = 0; i < maxNPCs; i++) {
                    if (pool.length === 0) break;
                    const totalWeight = pool.reduce((sum, c) => sum + Math.max(1, getAttrVal(c, '活跃') + 2), 0);
                    let r = Math.random() * totalWeight;
                    for (let j = 0; j < pool.length; j++) {
                        const w = Math.max(1, getAttrVal(pool[j], '活跃') + 2);
                        if (r < w) {
                            candidates.push(pool[j]);
                            pool.splice(j, 1);
                            break;
                        }
                        r -= w;
                    }
                }
                if (candidates.length > 0) {
                    candidates.sort((a, b) => getAttrVal(b, '活跃') - getAttrVal(a, '活跃'));
                    selectedNPCs.push(candidates[0]);
                    for (let i = 1; i < candidates.length; i++) {
                        const active = getAttrVal(candidates[i], '活跃');
                        const chance = (active + 2) / 100;
                        if (Math.random() < chance) {
                            selectedNPCs.push(candidates[i]);
                        }
                    }
                }
            }

            const participants = [...playerChars, ...selectedNPCs];
            participants.sort((a, b) => {
                const physA = getAttrVal(a, '体能');
                const physB = getAttrVal(b, '体能');
                return physB - physA;
            });

            const nonEnvCount = participants.length;
            const envChance = Math.min(1.0, nonEnvCount * 0.2);
            finalOrder = participants.map(c => c.id);
            
            if (envChars.length > 0 && Math.random() < envChance) {
                finalOrder.push(envChars[0].id);
            }
            
        } else {
            // Hidden Round Logic: Use Queue
            const queue = currentState.round.hiddenRoundQueue || [];
            if (queue.length > 0) {
                finalOrder = queue[0];
            } else {
                finalOrder = [];
            }
        }

        if (finalOrder.length === 0) {
             addLog(`系统: 当前地点无有效活跃单位。流程已自动暂停。`);
        } else {
             const names = finalOrder.map(id => currentState.characters[id]?.name || id).join(', ');
             const label = currentState.round.isHiddenRound ? "隐藏轮次行动顺序" : "本轮行动顺序";
             const pcCount = finalOrder.filter(id => currentState.characters[id]?.isPlayer).length;
             const npcCount = finalOrder.filter(id => !currentState.characters[id]?.isPlayer && !id.startsWith('env_')).length;
             addLog(`系统: ${label} (PC:${pcCount}, NPC:${npcCount}): [${names}]`);
        }

        if (checkSession() !== startSession) return;

        updateState(prev => {
            return {
                ...prev,
                round: { 
                    ...prev.round, 
                    currentOrder: finalOrder, 
                    hiddenRoundQueue: prev.round.isHiddenRound && prev.round.hiddenRoundQueue ? prev.round.hiddenRoundQueue.slice(1) : prev.round.hiddenRoundQueue,
                    turnIndex: 0, 
                    phase: 'turn_start', 
                    defaultOrder: finalOrder, 
                    isPaused: finalOrder.length === 0 
                }
            };
        });

        const nextWorldAttrs = currentState.world.attributes; 
        const timeAttr = nextWorldAttrs['worldTime'];
        const statusAttr = nextWorldAttrs['world_status'] || nextWorldAttrs['weather'];
        const timeStr = timeAttr ? String(timeAttr.value) : "未知时间";
        const statusStr = statusAttr ? String(statusAttr.value) : "未知";

        const parts = timeStr.split(':');
        const formattedTime = parts.length >= 5
            ? `${parts[0]}年${parts[1]}月${parts[2]}日${parts[3]}时${parts[4]}分`
            : timeStr;

        addLog(`当前故事时间：${formattedTime}，世界状态：${statusStr}`, { type: 'system' });
    };

    const phaseTurnStart = () => {
        const { currentOrder, turnIndex } = stateRef.current.round;
        if (turnIndex >= currentOrder.length) {
            setPhase('settlement');
            return;
        }
        const activeCharId = currentOrder[turnIndex];
        if (!stateRef.current.characters[activeCharId]) {
            updateState(prev => ({
                ...prev,
                round: { ...prev.round, turnIndex: prev.round.turnIndex + 1 }
            }));
            return;
        }
        updateState(prev => ({
            ...prev,
            round: { ...prev.round, activeCharId, phase: 'char_acting' }
        }));
    };

    const phaseSettlement = async () => {
        const startSession = checkSession();
        const snapshotState: GameState = JSON.parse(JSON.stringify(stateRef.current)); 
        
        if (stateRef.current.map.pendingActiveLocationId) {
            const newLocId = stateRef.current.map.pendingActiveLocationId;
            const newLocName = stateRef.current.map.locations[newLocId]?.name || "未知地点";

            updateState(prev => ({
                ...prev,
                map: {
                    ...prev.map,
                    activeLocationId: newLocId,
                    pendingActiveLocationId: undefined
                },
                round: {
                    ...prev.round,
                    useManualTurnOrder: false,
                    defaultOrder: [],
                    isWaitingForManualOrder: false
                }
            }));
            
            addLog(`系统: 视角已切换至 [${newLocName}]。`, { type: 'system' });
        }
        
        if (snapshotState.round.skipSettlement || snapshotState.round.isHiddenRound) {
            if (snapshotState.round.isHiddenRound) {
                const queue = snapshotState.round.hiddenRoundQueue || [];
                if (queue.length > 0) {
                    // Enter next hidden sequence
                    const nextOrder = queue[0];
                    const remaining = queue.slice(1);
                    const nextCounter = (snapshotState.round.hiddenRoundCounter || 1) + 1;
                    
                    addLog(`系统: 进入下一阶段隐藏轮次...`, { type: 'system' });
                    updateState(prev => ({
                        ...prev,
                        round: {
                            ...prev.round,
                            currentOrder: nextOrder,
                            hiddenRoundQueue: remaining,
                            hiddenRoundCounter: nextCounter, // Increment counter
                            turnIndex: 0,
                            phase: 'turn_start',
                            // Ensure we don't pause between hidden rounds if auto-advance is on (or even if off? Requirement 2: "Ensure hidden rounds finish before pause")
                            // If autoAdvanceCount is 0, we still want to continue through hidden rounds.
                            isPaused: false 
                        }
                    }));
                    return;
                }
                addLog("系统: 隐藏轮次结束，跳过结算阶段。", { type: 'system' });
                updateState(s => ({ ...s, round: { ...s.round, isHiddenRound: false, hiddenRoundQueue: undefined, hiddenRoundCounter: undefined } }));
            }
            phaseRoundEnd();
            return;
        }

        addLog("--- 轮次结算中，游戏继续 ---", { type: 'system' });

        const remainingAuto = snapshotState.round.autoAdvanceCount || 0;
        // Only decrement if NOT entering hidden round. 
        // We determine triggerHiddenRound later, so we might need to adjust logic order or use a temp variable.
        // Actually, we can check for hidden round trigger conditions early.
        
        const locationId = snapshotState.map.activeLocationId;
        let triggerHiddenRound = false;
        let nextHiddenQueue: string[][] = [];
        
        if (locationId) {
            const locChars = Object.values(snapshotState.characters).filter(c => {
                const pos = snapshotState.map.charPositions[c.id];
                return pos && pos.locationId === locationId;
            });
            
            const localCharMap = locChars.reduce((acc, c) => ({...acc, [c.id]: c}), {} as Record<string, Character>);
            const hrConfigs = calculateHiddenRoundStructure(localCharMap, snapshotState.cardPool);
            
            if (hrConfigs.length > 0) {
                triggerHiddenRound = true;
                nextHiddenQueue = hrConfigs.sort((a, b) => a.roundOrder - b.roundOrder).map(c => c.characterIds);
            }
        }

        // If entering hidden round, DO NOT decrement autoAdvanceCount yet.
        // It will be decremented when the entire hidden sequence ends (in phaseRoundEnd).
        const nextAutoCount = (remainingAuto > 0 && !triggerHiddenRound) ? remainingAuto - 1 : remainingAuto;
        const shouldContinue = nextAutoCount > 0;
        const apRecovery = 5; 
        const nextRoundNumber = snapshotState.round.roundNumber + 1;

        const ts = Date.now();
        const newLogs: LogEntry[] = [];

        newLogs.push({
            id: `log_round_${nextRoundNumber}_start_${ts}`,
            round: nextRoundNumber,
            turnIndex: 0,
            content: `--- 第 ${nextRoundNumber} 轮 开始 ---`,
            timestamp: ts,
            type: 'system',
            snapshot: { 
                ...snapshotState.round,
                roundNumber: nextRoundNumber,
                turnIndex: 0,
                phase: 'init',
                currentOrder: [],
                activeCharId: undefined,
                isPaused: triggerHiddenRound ? false : !shouldContinue,
                autoAdvanceCount: nextAutoCount,
                actionPoints: snapshotState.round.actionPoints + apRecovery,
                isHiddenRound: triggerHiddenRound,
                hiddenRoundQueue: triggerHiddenRound ? nextHiddenQueue : undefined,
                hiddenRoundCounter: triggerHiddenRound ? 1 : undefined
            }
        });

        updateState(prev => {
            let worldAttrsUpdate = { ...prev.world.attributes };
            if (Math.random() < (prev.defaultSettings.weatherChangeProbability || 0.1)) {
                const weatherConfig = prev.defaultSettings.weatherConfig;
                if (weatherConfig.length > 0) {
                    const totalW = weatherConfig.reduce((a, b) => a + b.weight, 0);
                    let r = Math.random() * totalW;
                    let newStatus = weatherConfig[0].name;
                    for (const w of weatherConfig) {
                        if (r < w.weight) { newStatus = w.name; break; }
                        r -= w.weight;
                    }
                    worldAttrsUpdate = {
                        ...worldAttrsUpdate,
                        'world_status': { 
                            ...(worldAttrsUpdate['world_status'] || { id: 'world_status', name: '状态', type: AttributeType.TEXT, value: '', visibility: AttributeVisibility.PUBLIC }),
                            value: newStatus
                        }
                    };
                }
            }
            return {
                ...prev,
                world: {
                    ...prev.world,
                    attributes: worldAttrsUpdate,
                    history: [...prev.world.history, ...newLogs]
                },
                round: {
                    ...prev.round,
                    roundNumber: nextRoundNumber,
                    turnIndex: 0,
                    phase: 'init',
                    currentOrder: [],
                    activeCharId: undefined,
                    isPaused: triggerHiddenRound ? false : !shouldContinue,
                    autoAdvanceCount: nextAutoCount,
                    actionPoints: prev.round.actionPoints + apRecovery,
                    isHiddenRound: triggerHiddenRound,
                    hiddenRoundQueue: triggerHiddenRound ? nextHiddenQueue : undefined,
                    hiddenRoundCounter: triggerHiddenRound ? 1 : undefined // Initialize counter
                }
            };
        });

        (async () => {
            try {
                // 1. Process Settlement Cards Sequentially (Because of new Single-Response AI format)
                await processSettlementCards(stateRef.current, startSession);

                // 2. Settlement Analysis
                if (checkSession() !== startSession) return;

                const activeConflicts: any[] = [];
                const activeDrives: any[] = [];
                
                const participantsIds: string[] = (snapshotState.round.currentOrder as string[]).filter((id: string) => !id.startsWith('env_'));
                const participants: Character[] = participantsIds
                    .map((id: string) => snapshotState.characters[id])
                    .filter((c: Character | undefined): c is Character => c !== undefined);
                
                const missingLifeIds = participants
                    .filter(c => !c.lifeTrajectory || !c.lifeTrajectory.current)
                    .map(c => c.id);

                participants.forEach((c: Character) => {
                    (c.conflicts || []).forEach(conf => {
                        if (!conf.solved) activeConflicts.push({ id: conf.id, charName: c.name, desc: conf.desc });
                    });
                    (c.drives || []).forEach(drv => {
                        activeDrives.push({ drive: drv, charName: c.name });
                    });
                });

                const lifeTrajectoryContext = formatLifeTrajectoryNow(participants);

                let settlementResult = null;
                if (activeConflicts.length > 0 || activeDrives.length > 0 || lifeTrajectoryContext.includes("当前人生章节")) {
                    settlementResult = await analyzeSettlement(
                        snapshotState.judgeConfig || DEFAULT_AI_CONFIG,
                        snapshotState.world.history,
                        activeConflicts,
                        activeDrives,
                        lifeTrajectoryContext,
                        snapshotState.appSettings,
                        snapshotState.defaultSettings,
                        snapshotState.world.attributes,
                        snapshotState.globalContext, 
                        addDebugLog,
                        snapshotState, 
                        (msg, type) => addLog(msg, { type: type || 'narrative' }),
                        handleTriggerUpdate
                    );
                }

                if (checkSession() !== startSession) return;

                let solvedIds: string[] = [];
                let fulfilledDriveIds: string[] = [];
                let completedLifeCharIds: string[] = [];
                const lifeReasonMap = new Map<string, string>();

                if (settlementResult) {
                    solvedIds = settlementResult.solvedConflictIds || [];
                    fulfilledDriveIds = settlementResult.fulfilledDriveIds || [];
                    
                    if (settlementResult.fulfilledTriggers) {
                         updateState(prev => ({
                             ...prev,
                             world: {
                                 ...prev.world,
                                 activeLanguageConditions: settlementResult.fulfilledTriggers
                             }
                         }));
                    }
                    
                    const rawLifeResults = settlementResult.completedLifeTrajectoryCharIds || [];
                    rawLifeResults.forEach((item: any) => {
                        if (typeof item === 'string') {
                            completedLifeCharIds.push(item);
                            lifeReasonMap.set(item, "思想与现实产生了一定偏差。");
                        } else if (typeof item === 'object') {
                            Object.entries(item).forEach(([key, val]) => {
                                completedLifeCharIds.push(key);
                                lifeReasonMap.set(key, String(val));
                            });
                        }
                    });
                }

                updateState((prev: GameState) => {
                    const nextChars = { ...prev.characters };
                    Object.keys(nextChars).forEach(charId => {
                        const char: Character = nextChars[charId];
                        const isEnv = char.id.startsWith('env_');
                        const isParticipating = participantsIds.includes(charId);

                        const hpVal = getAttrVal(char, '健康');
                        if (hpVal === -1) {
                            return; 
                        }

                        if (char.conflicts) {
                            char.conflicts = char.conflicts.map((c: Conflict) => {
                                if (solvedIds.includes(c.id) && !c.solved) {
                                    const cpAttr = char.attributes['cp'] || char.attributes['创造点'];
                                    if (cpAttr) {
                                        cpAttr.value = Math.round(Number(cpAttr.value) + c.apReward);
                                    }
                                    return { ...c, solved: true, solvedTimestamp: Date.now() };
                                }
                                return c;
                            });
                        }

                        if (char.drives) {
                            const fulfilled = char.drives.filter((t: Drive) => fulfilledDriveIds.includes(t.id));
                            if (fulfilled.length > 0) {
                                let totalPleasure = 0;
                                fulfilled.forEach(t => {
                                    totalPleasure += t.amount;
                                    t.weight = (t.weight || 50) + 20;
                                });
                                const pleasureAttr = char.attributes['快感'] || char.attributes['pleasure'];
                                if (pleasureAttr) {
                                    const currentP = Number(pleasureAttr.value);
                                    pleasureAttr.value = Math.round(Math.min(100, currentP + totalPleasure));
                                }
                            }
                        }

                        if (!isEnv && isParticipating) {
                            // Settings
                            const decayRate = snapshotState.defaultSettings.gameplay.pleasureDecayRate ?? 0.9;
                            const recoveryRate = snapshotState.defaultSettings.gameplay.physiqueRecoveryRate ?? 0.2;

                            const pleasureAttr = char.attributes['快感'] || char.attributes['pleasure'];
                            if (pleasureAttr) {
                                const currentP = Number(pleasureAttr.value);
                                pleasureAttr.value = Math.round(Math.max(0, currentP * decayRate));
                            }
                            const physiqueAttr = char.attributes['体能'] || char.attributes['physique'];
                            if (physiqueAttr) {
                                const currentPhy = Number(physiqueAttr.value);
                                const missing = 100 - currentPhy;
                                const recovery = missing * recoveryRate;
                                physiqueAttr.value = Math.round(Math.min(100, currentPhy + recovery));
                            }
                            const activeAttr = char.attributes['活跃'] || char.attributes['active'];
                            if (activeAttr) {
                                const currentAct = Number(activeAttr.value);
                                activeAttr.value = Math.round(Math.max(-1, currentAct * 0.8));
                            } else {
                                char.attributes['活跃'] = { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 40, visibility: AttributeVisibility.PUBLIC };
                            }
                            if (char.drives) {
                                char.drives.forEach(d => {
                                    d.weight = Math.round((d.weight || 50) - 10);
                                });
                                char.drives = char.drives.filter(d => (d.weight || 0) > 0);
                            }
                        }

                        if (char.drives) {
                            char.drives.forEach(d => {
                                if (d.weight > 100) d.weight = 100;
                            });
                        }
                    });
                    return { ...prev, characters: nextChars };
                });

                if (solvedIds.length > 0) addLog(`系统: (第${snapshotState.round.roundNumber}轮结算) ${solvedIds.length} 个矛盾已解决。`);
                if (fulfilledDriveIds.length > 0) addLog(`系统: (第${snapshotState.round.roundNumber}轮结算) ${fulfilledDriveIds.length} 个欲望已满足。`);

                if (checkSession() !== startSession) return;

                const lifeUpdateIds = Array.from(new Set([...completedLifeCharIds, ...missingLifeIds]));
                
                if (lifeUpdateIds.length > 0) {
                    lifeUpdateIds.forEach(async (charId) => {
                        const char = snapshotState.characters[charId];
                        if (!char) return;
                        
                        if (char.isProfessional || char.isPlayer) return;

                        const isMissing = missingLifeIds.includes(charId);
                        const reason = lifeReasonMap.get(charId) || (isMissing ? "人生轨迹缺失，需要补充。" : "人生章节已完成，需要新方向。");
                        
                        addLog(`系统: [${char.name}] 人生轨迹更新启动 (${isMissing ? '缺失' : '思想崩溃'})...`);
                        
                        try {
                            const newFuture = await generateLife(
                                char, 
                                snapshotState.world.history,
                                snapshotState.world.attributes,
                                snapshotState.appSettings,
                                snapshotState.defaultSettings,
                                snapshotState.globalContext,
                                snapshotState,
                                reason, 
                                addDebugLog,
                                (msg) => addLog(msg, { type: 'system' }),
                                handleTriggerUpdate
                            );

                            if (checkSession() !== startSession) return;

                            if (newFuture) {
                                updateState((prev) => {
                                    const newChars = { ...prev.characters };
                                    const targetChar = newChars[charId];
                                    
                                    if (targetChar && targetChar.lifeTrajectory) {
                                        const oldLife = targetChar.lifeTrajectory;
                                        targetChar.lifeTrajectory = {
                                            past: oldLife.current || oldLife.past || "",
                                            current: oldLife.future || "",
                                            future: newFuture
                                        };
                                    } else if (targetChar) {
                                        targetChar.lifeTrajectory = {
                                            past: "",
                                            current: "",
                                            future: newFuture
                                        };
                                    }

                                    return { ...prev, characters: newChars };
                                });
                                
                                addLog(`系统: [${char.name}] 的人生轨迹已更新。`);
                            } else {
                                addLog(`系统: [${char.name}] 人生轨迹生成失败。`);
                            }

                        } catch (e: any) {
                            console.error("Life Gen Error for " + char.name, e);
                            if (checkSession() === startSession) {
                                addLog(`系统: [${char.name}] 人生轨迹更新失败: ${e.message}`);
                            }
                        }
                    });
                }

            } catch (e: any) {
                console.error("Background Settlement Failed", e);
                if (checkSession() === startSession) {
                    addDebugLog({
                        id: `err_settle_${Date.now()}`,
                        timestamp: Date.now(),
                        characterName: "System",
                        prompt: "Background Settlement",
                        response: `Failed: ${e.message}`
                    });
                }
            }
        })();
    };

    const phaseRoundEnd = () => {
        updateState(prev => {
            let nextMapState = prev.map;
            let nextLogs = [...prev.world.history];
            let locationSwitched = false;
            
            if (prev.map.pendingActiveLocationId) {
                const newLocId = prev.map.pendingActiveLocationId;
                const newLocName = prev.map.locations[newLocId]?.name || "未知地点";
                
                nextMapState = {
                    ...prev.map,
                    activeLocationId: newLocId,
                    pendingActiveLocationId: undefined
                };
                
                locationSwitched = true;
                
                nextLogs.push({
                     id: `log_loc_switch_${Date.now()}`,
                     round: prev.round.roundNumber,
                     turnIndex: 0,
                     content: `系统: 视角已切换至 [${newLocName}]。`,
                     timestamp: Date.now(),
                     type: 'system'
                });
            }

            const remainingAuto = prev.round.autoAdvanceCount || 0;
            const nextAutoCount = remainingAuto > 0 ? remainingAuto - 1 : 0;
            const shouldContinue = nextAutoCount > 0;
            const apRecovery = 5; 
            const nextRoundNumber = prev.round.roundNumber + 1;

            const roundStartLog: LogEntry = {
                id: `log_round_${nextRoundNumber}_start_${Date.now()}`,
                round: nextRoundNumber,
                turnIndex: 0,
                content: `--- 第 ${nextRoundNumber} 轮 开始 ---`,
                timestamp: Date.now(),
                type: 'system',
                snapshot: {
                    ...prev.round,
                    roundNumber: nextRoundNumber,
                    turnIndex: 0,
                    phase: 'init',
                    currentOrder: [],
                    activeCharId: undefined,
                    isPaused: !shouldContinue, 
                    autoAdvanceCount: nextAutoCount,
                    actionPoints: prev.round.actionPoints + apRecovery,
                    isHiddenRound: false,
                    useManualTurnOrder: locationSwitched ? false : prev.round.useManualTurnOrder,
                    defaultOrder: locationSwitched ? [] : prev.round.defaultOrder,
                    isWaitingForManualOrder: locationSwitched ? false : prev.round.isWaitingForManualOrder
                }
            };
            
            nextLogs.push(roundStartLog);

            return {
                ...prev,
                world: {
                    ...prev.world,
                    history: nextLogs
                },
                map: nextMapState,
                round: {
                    ...prev.round,
                    roundNumber: nextRoundNumber,
                    turnIndex: 0,
                    phase: 'init',
                    currentOrder: [],
                    activeCharId: undefined,
                    isPaused: !shouldContinue, 
                    autoAdvanceCount: nextAutoCount,
                    actionPoints: prev.round.actionPoints + apRecovery,
                    isHiddenRound: false,
                    useManualTurnOrder: locationSwitched ? false : prev.round.useManualTurnOrder,
                    defaultOrder: locationSwitched ? [] : prev.round.defaultOrder,
                    isWaitingForManualOrder: locationSwitched ? false : prev.round.isWaitingForManualOrder
                }
            };
        });
    };

    return {
        phaseOrderDetermination,
        phaseTurnStart,
        phaseSettlement,
        phaseRoundEnd
    };
};