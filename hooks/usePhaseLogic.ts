
import { MutableRefObject } from 'react';
import { GameState, GamePhase, DebugLog, AttributeType, AttributeVisibility, Character, LogEntry, Trigger } from '../types';
import { analyzeSettlement } from '../services/aiService';
import { DEFAULT_AI_CONFIG } from '../config';
// Removed advanceWorldTime import as it moves to ActionLogic

interface UsePhaseLogicProps {
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string, overrides?: Partial<LogEntry>) => void;
    setIsProcessingAI: (val: boolean) => void;
    setProcessingLabel: (val: string) => void;
    handleAiFailure: (context: string, e: any) => void;
    setPhase: (phase: GamePhase) => void;
    addDebugLog: (log: DebugLog) => void;
}

// Helper to get numeric attribute value safely
const getAttrVal = (char: Character, key: string): number => {
    if (!char || !char.attributes) return 0;
    // Direct match
    if (char.attributes[key]) return Number(char.attributes[key].value);
    
    // Alias check
    const map: Record<string, string> = {
        'health': '健康', '健康': 'health',
        'physique': '体能', '体能': 'physique'
    };
    const alias = map[key];
    if (alias && char.attributes[alias]) return Number(char.attributes[alias].value);
    
    return 0;
};

export const usePhaseLogic = ({
    stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, setPhase, addDebugLog
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

    const phaseOrderDetermination = async () => {
        const currentState = stateRef.current;
        
        // Manual Order Check
        if (currentState.round.useManualTurnOrder) {
            // Check if we are in auto-advance mode and have a valid previous order
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
                    // Initialize manual list with current default if empty or previous
                    currentOrder: prev.round.defaultOrder.length > 0 ? prev.round.defaultOrder : Object.keys(prev.characters)
                }
            }));
            return;
        }

        // --- Programmatic Turn Order Logic (No AI) ---
        // 1. Filter characters at current location
        // 2. Filter out dead (Health <= 0)
        // 3. Sort non-environment by Physique desc
        // 4. Append Environment chars at end
        
        const locationId = currentState.map.activeLocationId;
        const allChars = Object.values(currentState.characters) as Character[];
        
        // 1. Filter by Location
        const locChars = allChars.filter(c => {
            const pos = currentState.map.charPositions[c.id];
            return pos && pos.locationId === locationId;
        });

        // 2. Filter Alive (Health > 0)
        // Note: Environment characters usually have high health, so they persist unless manually set to 0.
        const aliveChars = locChars.filter(c => {
            const hp = getAttrVal(c, '健康'); // Handles 'health' alias internally
            return hp > 0;
        });

        // 3. Split & Sort
        const envChars = aliveChars.filter(c => c.id.startsWith('env_'));
        const normalChars = aliveChars.filter(c => !c.id.startsWith('env_'));

        // Sort normal chars by Physique (体能) descending
        normalChars.sort((a, b) => {
            const physA = getAttrVal(a, '体能');
            const physB = getAttrVal(b, '体能');
            return physB - physA; // Descending
        });

        // 4. Combine
        const finalOrder = [...normalChars.map(c => c.id), ...envChars.map(c => c.id)];

        // If no one is valid (everyone dead?), fallback to just environment or empty (which ends round)
        if (finalOrder.length === 0) {
             addLog(`系统: 当前地点无有效行动单位 (全员失能或无人)。`);
        } else {
             const names = finalOrder.map(id => currentState.characters[id]?.name || id).join(', ');
             addLog(`系统: 本轮行动顺序 (体能排序): [${names}]`);
        }

        // Apply State Update
        updateState(prev => {
            return {
                ...prev,
                round: { 
                    ...prev.round, 
                    currentOrder: finalOrder, 
                    turnIndex: 0, 
                    phase: 'turn_start',
                    defaultOrder: finalOrder
                }
            };
        });

        // --- INJECT TIME & STATUS LOG ---
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
        // Check if char exists
        if (!stateRef.current.characters[activeCharId]) {
            // Skip if character missing
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
        const currentState = stateRef.current;
        
        if (currentState.round.skipSettlement) {
            phaseRoundEnd();
            return;
        }

        setIsProcessingAI(true);
        setProcessingLabel("Resolving World State...");
        addLog("--- 轮次结算阶段 ---");

        try {
            // 1. Conflict & Drive Resolution
            const activeConflicts: any[] = [];
            const activeDrives: any[] = [];
            
            const participants = currentState.round.currentOrder
                .filter(id => !id.startsWith('env_'))
                .map(id => currentState.characters[id])
                .filter(c => c !== undefined) as Character[];
            
            participants.forEach((c: Character) => {
                (c.conflicts || []).forEach(conf => {
                    if (!conf.solved) activeConflicts.push({ id: conf.id, charName: c.name, desc: conf.desc });
                });
                (c.drives || []).forEach(drv => {
                    activeDrives.push({ drive: drv, charName: c.name });
                });
            });

            if (activeConflicts.length > 0 || activeDrives.length > 0) {
                const settlementResult = await analyzeSettlement(
                    currentState.judgeConfig || DEFAULT_AI_CONFIG,
                    currentState.world.history,
                    activeConflicts,
                    activeDrives,
                    currentState.appSettings,
                    currentState.defaultSettings,
                    currentState.world.attributes,
                    currentState.globalContext, // Pass Global Context
                    addDebugLog,
                    currentState, // Trigger Support
                    (msg) => addLog(msg),
                    handleTriggerUpdate
                );

                if (settlementResult) {
                    updateState(prev => {
                        const nextChars = { ...prev.characters };
                        const solvedIds = settlementResult.solvedConflictIds || [];
                        const fulfilledDriveIds = settlementResult.fulfilledDriveIds || [];
                        let totalApReward = 0;
                        let updatesLog: string[] = [];

                        Object.keys(nextChars).forEach(charId => {
                            const char = nextChars[charId];
                            const isEnv = char.id.startsWith('env_');
                            const isParticipating = prev.round.currentOrder.includes(charId);

                            // Resolve Conflicts
                            if (char.conflicts) {
                                char.conflicts = char.conflicts.map(c => {
                                    if (solvedIds.includes(c.id) && !c.solved) {
                                        updatesLog.push(`[${char.name}] 解决了矛盾: "${c.desc}" (+${c.apReward} CP/AP)`);
                                        const cpAttr = char.attributes['cp'] || char.attributes['创造点'];
                                        if (cpAttr) {
                                            cpAttr.value = Number(cpAttr.value) + c.apReward;
                                        }
                                        totalApReward += c.apReward;
                                        return { ...c, solved: true, solvedTimestamp: Date.now() };
                                    }
                                    return c;
                                });
                            }

                            // Fulfil Drives
                            if (char.drives) {
                                const fulfilled = char.drives.filter(t => fulfilledDriveIds.includes(t.id));
                                if (fulfilled.length > 0) {
                                    let totalPleasure = 0;
                                    fulfilled.forEach(t => {
                                        totalPleasure += t.amount;
                                        t.weight = (t.weight || 50) + 20;
                                    });
                                    const pleasureAttr = char.attributes['快感'] || char.attributes['pleasure'];
                                    if (pleasureAttr) {
                                        const currentP = Number(pleasureAttr.value);
                                        pleasureAttr.value = Math.min(100, currentP + totalPleasure); 
                                    } else {
                                        char.attributes['快感'] = {
                                            id: '快感', name: '快感', type: AttributeType.NUMBER, value: 50 + totalPleasure, visibility: AttributeVisibility.PUBLIC
                                        };
                                    }
                                    updatesLog.push(`[${char.name}] 满足驱力: +${totalPleasure} 快感 (相关驱力权重增加)`);
                                }
                            }

                            // Decay Logic
                            if (!isEnv && isParticipating) {
                                const pleasureAttr = char.attributes['快感'] || char.attributes['pleasure'];
                                if (pleasureAttr) {
                                    pleasureAttr.value = Math.max(0, Number(pleasureAttr.value) - 20);
                                }
                                if (char.drives) {
                                    char.drives.forEach(d => {
                                        d.weight = (d.weight || 50) - 10;
                                    });
                                    char.drives = char.drives.filter(d => (d.weight || 0) > 0);
                                }
                            }
                        });

                        return {
                            ...prev,
                            characters: nextChars,
                            round: { ...prev.round, actionPoints: prev.round.actionPoints + totalApReward }
                        };
                    });
                }
            }

            // 2. Time Passage (MOVED TO ACTION LOGIC, removed from settlement)
            // No logic here. Time updates per action.

            // 3. Weather/Status Change
            if (Math.random() < (currentState.defaultSettings.weatherChangeProbability || 0.1)) {
                const weatherConfig = currentState.defaultSettings.weatherConfig;
                if (weatherConfig.length > 0) {
                    const totalW = weatherConfig.reduce((a, b) => a + b.weight, 0);
                    let r = Math.random() * totalW;
                    let newStatus = weatherConfig[0].name;
                    for (const w of weatherConfig) {
                        if (r < w.weight) { newStatus = w.name; break; }
                        r -= w.weight;
                    }
                    updateState(prev => ({
                        ...prev,
                        world: {
                            ...prev.world,
                            attributes: {
                                ...prev.world.attributes,
                                'world_status': { // Changed from 'weather'
                                    ...(prev.world.attributes['world_status'] || { id: 'world_status', name: '状态', type: AttributeType.TEXT, value: '', visibility: AttributeVisibility.PUBLIC }),
                                    value: newStatus
                                }
                            }
                        }
                    }));
                    addLog(`系统: 世界状态变更为 [${newStatus}]`);
                }
            }

            // End Phase
            phaseRoundEnd();

        } catch (e: any) {
            handleAiFailure("Settlement", e);
        } finally {
            setIsProcessingAI(false);
        }
    };

    const phaseRoundEnd = () => {
        updateState(prev => {
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
                type: 'system'
            };

            return {
                ...prev,
                world: {
                    ...prev.world,
                    history: [...prev.world.history, roundStartLog]
                },
                round: {
                    ...prev.round,
                    roundNumber: nextRoundNumber,
                    turnIndex: 0,
                    phase: 'init',
                    currentOrder: [],
                    activeCharId: undefined,
                    isPaused: !shouldContinue, 
                    autoAdvanceCount: nextAutoCount,
                    actionPoints: prev.round.actionPoints + apRecovery 
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
