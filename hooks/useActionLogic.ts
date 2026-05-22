
import { MutableRefObject } from 'react';
import { GameState, Character, Card, AttributeType, AttributeVisibility, MapLocation, MapRegion, DebugLog, Conflict, PrizeItem, Trigger, GameImage, StoryTag, TriggerEffect } from '../types';
import { determineCharacterAction, generateUnveil, normalizeCard, generateStorySuggest } from '../services/aiService';
import { DEFAULT_AI_CONFIG } from '../config';
import { PendingAction } from './useEngine';
import { advanceWorldTime, parseTimeDelta } from '../services/timeUtils';
import { getAttr, getCP, removeInstances } from '../services/attributeUtils';
import { useLotterySystem } from './actions/useLotterySystem';
import { useWorldActions } from './actions/useWorldActions';
import { useSkillSystem } from './actions/useSkillSystem';
import { generateConflictId, generateDriveId } from '../services/idUtils';
import { executeEffects } from '../services/triggerService';
import { updateStream, finishStream } from '../services/streamService';

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
    requestPlayerReaction?: (charId: string, title: string, message: string) => Promise<string | null>;
    checkSession: () => number;
}

export const useActionLogic = ({
    stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, setSelectedCharId,
    playerInput, setPlayerInput, selectedCharId, selectedCardId, selectedTargetId, setSelectedCardId, setSelectedTargetId,
    pendingActions, setPendingActions,
    addDebugLog,
    requestPlayerReaction,
    checkSession
}: UseActionLogicProps) => {

    const handleTriggerUpdate = (id: string, updates: Partial<Trigger>) => {
        updateState(prev => ({
            ...prev,
            triggers: {
                ...prev.triggers,
                [id]: { ...prev.triggers[id], ...updates }
            }
        }));
    };
    
    // Helper to execute effects returned from AI
    const handleTriggerEffects = (effects: TriggerEffect[]) => {
        if (effects.length > 0) {
            executeEffects(stateRef.current, effects, updateState, addLog);
        }
    };

    // Instantiate Sub-Hooks
    const { processLotteryAction } = useLotterySystem({
        stateRef, updateState, addLog, addDebugLog, checkSession, handleTriggerUpdate
    });

    const { processMove, processCardCreation, processRedeem } = useWorldActions({
        stateRef, updateState, addLog
    });

    const { executeSkill } = useSkillSystem({
        stateRef, updateState, addLog, addDebugLog, checkSession, requestPlayerReaction, handleTriggerUpdate
    });

    const updateTimeAndLog = (secondsPassed: number) => {
        const currentState = stateRef.current;
        const timeAttr = currentState.world.attributes['worldTime'];
        if (timeAttr && secondsPassed > 0) {
            const oldTimeStr = String(timeAttr.value);
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

            const parts = newTimeStr.split(':');
            const statusAttr = currentState.world.attributes['world_status'] || currentState.world.attributes['weather'];
            const statusStr = statusAttr ? String(statusAttr.value) : "未知";
            
            const formattedTime = parts.length >= 5
                ? `${parts[0]}年${parts[1]}月${parts[2]}日${parts[3]}时${parts[4]}分`
                : newTimeStr;
                
            addLog(`当前故事时间：${formattedTime}，世界状态：${statusStr}`, { type: 'system' });
        }
    };

    // Helper: Update a specific log entry in place
    const updateLogEntry = (logId: string, content: string) => {
        updateState(prev => ({
            ...prev,
            world: {
                ...prev.world,
                history: prev.world.history.map(l => l.id === logId ? { ...l, content } : l)
            }
        }));
    };

    const performUnveil = async (selectedLogs: string[], targetCharIds: string[], playerIntent?: string) => {
        const startSession = checkSession();
        addLog("系统: 正在揭开角色回忆...", { type: 'system' });

        const currentState = stateRef.current;
        const targets: Character[] = targetCharIds.map(id => currentState.characters[id]).filter(Boolean);
        
        if (targets.length === 0 || selectedLogs.length === 0) return;

        const targetContext = targets.map(c => 
            `ID:${c.id} Name:${c.name} Desc:${c.description.substring(0, 200)} Appearance:${c.appearance}`
        ).join('\n---\n');

        const logsText = selectedLogs.join('\n');
        const config = currentState.charGenConfig || currentState.judgeConfig || DEFAULT_AI_CONFIG;

        try {
            const result = await generateUnveil(
                config,
                currentState.world.history,
                logsText,
                targetContext,
                currentState.appSettings,
                currentState.defaultSettings,
                currentState.globalContext,
                addDebugLog,
                playerIntent
            );

            if (checkSession() !== startSession) return;

            if (result && result.results && result.results.length > 0) {
                const unveiledNames: string[] = [];

                updateState(prev => {
                    const nextChars = { ...prev.characters };
                    result.results.forEach(res => {
                        const char = nextChars[res.charId];
                        if (char) {
                            const newDesc = char.description + "\n\n" + res.unveilText;
                            nextChars[res.charId] = { ...char, description: newDesc };
                            unveiledNames.push(char.name);
                        }
                    });
                    return { ...prev, characters: nextChars };
                });

                if (unveiledNames.length > 0) {
                    addLog(`系统: 角色回忆已揭露：${unveiledNames.join(', ')}`, { type: 'system' });
                }
            } else {
                addLog("系统: 揭露失败，未能获取有效信息。", { type: 'system' });
            }

        } catch (e: any) {
            console.error("Unveil Failed", e);
            if (checkSession() === startSession) {
                addLog(`系统: 揭露过程发生错误 (${e.message})`, { type: 'system' });
            }
        }
    };

    const performInstantAction = async (charId: string, targetId: string, speech: string, actionDesc: string, images?: GameImage[], isItemOperation?: boolean, timePassed: number = 0) => {
        const startSession = checkSession();
        const char = stateRef.current.characters[charId];
        if (!char) return;

        // 1. Log Speech directly with Images
        if (speech.trim() || (images && images.length > 0)) {
            addLog(`${char.isPlayer ? `${char.name}: ` : ''}${speech}`, { actingCharId: char.id, images: images });
        }
        
        if (timePassed > 0) {
            updateTimeAndLog(timePassed);
        }

        // Logic: Fallback to 'Interact' skill if action description is empty
        // This allows pure conversation or reaction triggers without "Virtual Action"
        if (!actionDesc.trim() && !isItemOperation) {
             const interactCardId = 'card_interact_default';
             const existingSkill = char.skills.find(s => s.id === interactCardId) || 
                                   stateRef.current.cardPool.find(c => c.id === interactCardId);
                                   
             if (existingSkill) {
                 try {
                     await executeSkill(existingSkill, charId, targetId, false, true);
                 } catch (e: any) {
                     handleAiFailure("Instant Action (Interact)", e);
                 }
                 return;
             }
        }

        try {
            // 2. Construct Dynamic Virtual Card
            const tempCard: Card = {
                id: `virt_act_${Date.now()}`,
                name: isItemOperation ? '物品操作' : '动作',
                description: (actionDesc.trim() 
                    ? `使用者的行为：${actionDesc}` 
                    : "使用者的互动行为。") + (isItemOperation ? " / 尝试进行交易、获取或给予。" : ""),
                itemType: 'skill',
                triggerType: isItemOperation ? 'reaction' : 'active',
                cost: 0,
                isVirtualAction: true, // Mark as virtual so skill system knows it's a manual action
                effects: [
                    {
                        id: `eff_virt_${Date.now()}`,
                        name: isItemOperation ? "物品操作判定" : "动作判定",
                        targetType: 'specific_char',
                        targetAttribute: '健康', // Dummy attribute, mostly for reaction trigger
                        targetId: targetId,
                        value: 0,
                        conditionDescription: (actionDesc.trim() 
                            ? "场景中没有确切的条件阻止使用者进行该行为时，判定成功" 
                            : "无") + (isItemOperation ? " / 尝试进行交易、获取或给予。" : ""), 
                        conditionContextKeys: []
                    }
                ],
                visibility: AttributeVisibility.PUBLIC
            };

            // 3. Execute immediately
            await executeSkill(tempCard, charId, targetId, false, true);

        } catch (e: any) {
            handleAiFailure("Instant Action", e);
        }
    };

    const submitPlayerTurn = async (timePassed: number = 0, images?: GameImage[], overrideSpeech?: string, forcePruneTurnOrder: boolean = false) => {
        const startSession = checkSession();
        setIsProcessingAI(true);
        setProcessingLabel("执行中...");

        try {
            const state = stateRef.current;
            const activeCharId = state.round.activeCharId;
            if (!activeCharId) return; 
            const char = state.characters[activeCharId];
            if (!char || !char.isPlayer) return;

            // 1. Text Input & Images
            const speechToLog = typeof overrideSpeech !== 'undefined' ? overrideSpeech : playerInput;
            if (speechToLog === "[SKIP_LOG]") {
                setPlayerInput("");
            } else if (speechToLog.trim() || (images && images.length > 0)) {
                // Remove quotes around player input
                addLog(`${char.name}: ${speechToLog}`, { actingCharId: activeCharId, images: images });
                setPlayerInput("");
            } else if (pendingActions.length === 0) {
                addLog(`系统: ${char.name}跳过回合`, { type: 'system', actingCharId: activeCharId });
            }

            // 2. Process Pending Actions
            // Iterate with index to determine Burning Life (Index >= 2)
            for (let i = 0; i < pendingActions.length; i++) {
                if (checkSession() !== startSession) break;
                const action = pendingActions[i];
                const isBurningLife = i >= 2;

                if (action.type === 'use_skill' && action.cardId) {
                    let card = char.skills.find(c => c.id === action.cardId);
                    if (!card) {
                        card = state.cardPool.find(c => c.id === action.cardId);
                    }
                    if (card) {
                        await executeSkill(card, char.id, action.targetId, isBurningLife);
                    }
                } else if (action.type === 'move_to' && action.destinationId) {
                    processMove(char.id, action.destinationId, action.destinationName);
                } else if (action.type === 'lottery' && action.poolId && action.action) {
                    await processLotteryAction(
                        char.id, 
                        action.poolId, 
                        action.action, 
                        action.amount, 
                        action.cardIds, 
                        undefined, 
                        action.isHidden
                    );
                }
            }

            if (checkSession() === startSession) {
                setPendingActions([]);
                updateTimeAndLog(timePassed > 0 ? timePassed : 60);
                setSelectedCardId(null);
                setSelectedTargetId(null);
                updateState(prev => {
                    let nextOrder = [...prev.round.currentOrder];
                    let nextTurnIndex = prev.round.turnIndex + 1;

                    if (forcePruneTurnOrder) {
                        // Timeout: Skip subsequent non-environment characters by advancing turnIndex
                        while (nextTurnIndex < nextOrder.length) {
                            if (nextOrder[nextTurnIndex].startsWith('env_')) {
                                break;
                            }
                            nextTurnIndex++;
                        }
                    }

                    return {
                        ...prev,
                        round: { ...prev.round, currentOrder: nextOrder, turnIndex: nextTurnIndex, phase: 'turn_start' }
                    }
                });
            }
        } catch (e: any) {
            handleAiFailure("Player Turn", e);
        } finally {
            if (checkSession() === startSession) {
                setIsProcessingAI(false);
                setProcessingLabel("");
            }
        }
    };

    /**
     * Core AI Execution Logic
     * Separated to allow background execution for Environment Characters
     */
    const executeAiTurnLogic = async (char: Character, startSession: number) => {
        // Prepare current location context
        let currentLocation: MapLocation | undefined;
        const pos = stateRef.current.map.charPositions[char.id];
        if (pos && pos.locationId) currentLocation = stateRef.current.map.locations[pos.locationId];

        if (checkSession() !== startSession) return;
        
        // STREAMING PREPARATION
        const isStreaming = stateRef.current.appSettings.enableStreaming !== false;
        let streamLogId = "";
        if (isStreaming) {
            streamLogId = `log_stream_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            // Insert placeholder log
            addLog(`(...)`, { id: streamLogId, actingCharId: char.id });
        }

        const action = await determineCharacterAction(
            char, 
            stateRef.current.world.history, 
            stateRef.current.world.attributes, 
            stateRef.current.globalContext, 
            stateRef.current.cardPool, 
            stateRef.current.appSettings, 
            stateRef.current.defaultSettings, 
            stateRef.current.world.worldGuidance,
            currentLocation,
            stateRef.current.map.regions, 
            stateRef.current.prizePools,
            stateRef.current.map.locations,
            addDebugLog,
            stateRef.current, 
            (msg) => addLog(msg, { type: 'system' }),
            handleTriggerUpdate,
            // Streaming Callback - Removed name prefix
            isStreaming ? (text) => updateStream(streamLogId, text) : undefined,
            // Abort Check
            () => checkSession() !== startSession,
            // Effects Callback (NEW)
            handleTriggerEffects
        );
        
        if (checkSession() !== startSession) return;
        
        // --- 1. Update Character Move Plan (If new plan is generated) ---
        // If movePlan is present in AI response (even if empty string to clear), update it
        if (action.movePlan !== undefined) {
             updateState(prev => {
                 const newChars = { ...prev.characters };
                 if (newChars[char.id]) {
                     newChars[char.id] = { ...newChars[char.id], movePlan: action.movePlan };
                 }
                 return { ...prev, characters: newChars };
             });
        }
        
        if (!isStreaming) {
            if (action.narrative) addLog(`<span class="italic">* ${action.narrative} *</span>`, { actingCharId: char.id });
            if (action.speech) addLog(`${action.speech}`, { actingCharId: char.id });
            if (!action.narrative && !action.speech && action['text']) addLog(`${action['text']}`, { actingCharId: char.id });
        } else {
            // Finalize the streamed log with parsed content to ensure it's clean
            let finalContent = "";
            if (action.narrative) finalContent += `<span class="italic">* ${action.narrative} *</span>`;
            if (action.speech) finalContent += (finalContent ? "<br/>" : "") + `${action.speech}`;
            // If parsing failed (empty action), keep whatever was streamed
            if (finalContent) {
                updateLogEntry(streamLogId, finalContent);
            }
            finishStream(streamLogId);
        }

        if (action.timePassed) {
            const seconds = parseTimeDelta(action.timePassed);
            updateTimeAndLog(seconds);
        } else {
            updateTimeAndLog(60);
        }

        // Handle Conflicts and Drives generation (Env char logic)
        if (action.generatedConflicts && action.generatedConflicts.length > 0) {
            addLog(`系统: ${action.generatedConflicts.length} 个新矛盾已产生。`, { type: 'system' });
            
            updateState(prev => {
                const newChars = { ...prev.characters };
                const usedConflictIds = new Set<string>();
                Object.values(prev.characters).forEach(c => c.conflicts?.forEach(x => usedConflictIds.add(x.id)));

                action.generatedConflicts!.forEach(c => {
                    const target = newChars[c.targetCharId];
                    if (target) {
                        const newId = generateConflictId(usedConflictIds);
                        usedConflictIds.add(newId);
                        target.conflicts = [...(target.conflicts || []), { id: newId, desc: c.desc, apReward: c.apReward || 5, solved: false }];
                    }
                });
                return { ...prev, characters: newChars };
            });
        }

        if (action.generatedDrives && action.generatedDrives.length > 0) {
            addLog(`系统: ${action.generatedDrives.length} 个新欲望已产生。`, { type: 'system' });

            updateState(prev => {
                const newChars = { ...prev.characters };
                const usedDriveIds = new Set<string>();
                Object.values(prev.characters).forEach(c => c.drives?.forEach(d => usedDriveIds.add(d.id)));

                action.generatedDrives!.forEach(d => {
                    const target = newChars[d.targetCharId];
                    if (target) {
                        const newId = generateDriveId(usedDriveIds);
                        usedDriveIds.add(newId);
                        const newDrive = { ...d.drive, id: newId };
                        target.drives = [...(target.drives || []), newDrive];
                    }
                });
                return { ...prev, characters: newChars };
            });
        }

        if (action.commands && action.commands.length > 0) {
            let skillActionCount = 0;
            
            for (const cmd of action.commands) {
                if (checkSession() !== startSession) break;
                if (stateRef.current.round.isPaused) break; 
                
                const freshState = stateRef.current;
                const freshChar = freshState.characters[char.id];

                const isBurningLife = (cmd.type === 'use_skill') && (skillActionCount >= 2);
                
                if (cmd.type === 'lottery' && cmd.poolId && freshChar) {
                    await processLotteryAction(freshChar.id, cmd.poolId, cmd.action || 'peek', cmd.amount, cmd.cardIds, cmd.itemName, cmd.isHidden);
                } else if (cmd.type === 'redeem_card' && cmd.targetCharId && cmd.oldCardId && cmd.newCard && freshChar) {
                    processRedeem(freshChar.id, cmd.targetCharId, cmd.oldCardId, cmd.newCard);
                } else if (cmd.type === 'use_skill' && cmd.skillId && freshChar) {
                    const skill = freshChar.skills.find(s => s.id === cmd.skillId) || freshState.cardPool.find(s => s.id === cmd.skillId && freshChar.inventory.includes(s.id));
                    if (skill) {
                        if (skill.triggerType === 'active' || skill.triggerType === 'reaction') {
                            await executeSkill(skill, char.id, cmd.targetId, isBurningLife);
                            skillActionCount++;
                        } else if (addDebugLog) {
                            addDebugLog({ id: `warn_${Date.now()}`, timestamp: Date.now(), characterName: "System", prompt: "Skill Validation Failed", response: `AI attempted to use passive skill [${skill.name}] as active action. Blocked.` });
                        }
                    }
                } else if (cmd.type === 'create_card' && cmd.createdCard && freshChar) {
                    processCardCreation(freshChar.id, cmd.createdCard);
                } else if (cmd.type === 'move_to' && cmd.destinationName && freshChar) {
                    const targetName = cmd.destinationName.trim();
                    const allLocs = Object.values(freshState.map.locations) as MapLocation[];
                    let dest = allLocs.find(l => l.name === targetName);
                    if (!dest) dest = allLocs.find(l => l.name.toLowerCase() === targetName.toLowerCase());
                    if (!dest) dest = allLocs.find(l => l.name.includes(targetName) || targetName.includes(l.name));
                    
                    if (!dest) {
                        const currentPos = freshState.map.charPositions[char.id];
                        if (currentPos) {
                            const candidates: MapLocation[] = [];
                            allLocs.forEach(l => {
                                if (l.id === currentPos.locationId) return;
                                const dist = Math.sqrt((l.coordinates.x - currentPos.x)**2 + (l.coordinates.y - currentPos.y)**2);
                                if (dist <= 1000 && !l.isKnown) candidates.push(l);
                            });
                            if (candidates.length > 0) dest = candidates[Math.floor(Math.random() * candidates.length)];
                        }
                    }

                    if (dest) {
                        processMove(freshChar.id, dest.id, dest.name);
                    } else {
                        addLog(`> 移动失败: ${freshChar.name} 想要前往 [${targetName}]，但附近没有符合条件的地点。`);
                    }
                }
            }
        }
    };

    const performCharacterAction = async () => {
        const startSession = checkSession();
        const activeCharId = stateRef.current.round.activeCharId;
        if (!activeCharId) return;
        const char = stateRef.current.characters[activeCharId];

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
            // if (selectedCharId !== activeCharId) setSelectedCharId(activeCharId); // Removed auto-select
            return; 
        }

        // --- NEW: Environment Character Background Processing ---
        if (char.id.startsWith('env_')) {
            // 1. Immediately advance turn (UI does not wait)
            if (!stateRef.current.round.isPaused) {
                updateState(prev => ({
                    ...prev,
                    round: { ...prev.round, turnIndex: prev.round.turnIndex + 1, phase: 'turn_start' }
                }));
            }

            // 2. Add System Log
            addLog(`系统: [${char.name}] 中人物的心理正在发生变化...`, { type: 'system' });

            // 3. Run AI Logic Asynchronously (Fire and Forget)
            executeAiTurnLogic(char, startSession).catch(e => {
                console.error("Env AI Background Error", e);
            });

            // 4. PARALLEL: Trigger Story Suggestion here (Optimized: Only when env acts)
            generateStorySuggest(
                stateRef.current, 
                addDebugLog, 
                (msg) => addLog(msg, { type: 'system' }),
                handleTriggerUpdate
            ).then(result => {
                if (!result) return;
                // Basic session check, though suggestions are less critical to sync
                if (checkSession() !== startSession) return;
                
                // --- A. Process Story Tags & Suggestions ---
                updateState(prev => {
                    const newWorld = { ...prev.world, lastFunSuggest: result.funsuggest };
                    
                    // Merge Tags logic (same as LeftPanel)
                    const existingTags = prev.world.storyTags || [];
                    const existingTexts = new Set(existingTags.map(t => t.text));
                    const newTags: StoryTag[] = [];
                    
                    result.tagsuggest.forEach(text => {
                        if (!existingTexts.has(text) && text.trim()) {
                            newTags.push({
                                id: `tag_auto_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                                text: text.trim(),
                                status: 'neutral',
                                timestamp: Date.now()
                            });
                            existingTexts.add(text);
                        }
                    });
                    
                    // Enforce Limit
                    let allTags = [...existingTags, ...newTags];
                    const neutrals = allTags.filter(t => t.status === 'neutral');
                    const nonNeutrals = allTags.filter(t => t.status !== 'neutral');
                    neutrals.sort((a, b) => a.timestamp - b.timestamp);
                    const keptNeutrals = neutrals.slice(Math.max(0, neutrals.length - 20));
                    
                    newWorld.storyTags = [...nonNeutrals, ...keptNeutrals];
                    return { ...prev, world: newWorld };
                });

                // --- B. Process Coming Character Movement ---
                // "comingchar" from StorySuggest is an array of IDs.
                // We move these characters to the location where the environment character is acting.
                // Environment char ID is `env_LOCID`, so target location is derived from that.
                if (result.comingchar && Array.isArray(result.comingchar) && result.comingchar.length > 0) {
                     const targetLocId = char.id.replace('env_', '');
                     const targetLocName = stateRef.current.map.locations[targetLocId]?.name || "未知地点";

                     result.comingchar.forEach((comingId: string) => {
                         const comingChar = stateRef.current.characters[comingId];
                         if (comingChar && comingChar.movePlan) { // Only move if plan exists (double check)
                             // Use standard processMove logic (physique check, active update, conflict, logging, plan clearing)
                             // Note: processMove logs as action, which is what we want.
                             processMove(comingId, targetLocId, targetLocName);
                             // No manual state update needed here as processMove handles it
                         }
                     });
                }

                addLog("系统: 剧情顾问已根据环境变化更新了建议。", { type: 'system' });
            }).catch(e => {
                console.warn("Auto Story Suggest Failed (Env Step)", e);
            });
            
            return;
        }
        // -----------------------------------------------------

        setIsProcessingAI(true);
        setProcessingLabel(`${char.name} 正在思考...`);
        // setSelectedCharId(activeCharId); // Removed auto-select for AI characters too

        try {
            await executeAiTurnLogic(char, startSession);
            
            setPendingActions([]); 
            setIsProcessingAI(false);
        } catch (e: any) {
            handleAiFailure("Character Action", e);
        }

        if (checkSession() !== startSession) return;

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
        submitPlayerTurn,
        performUnveil,
        performInstantAction,
        processMove // Exported for use in UI
    };
};
