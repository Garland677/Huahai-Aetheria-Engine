
import { MutableRefObject } from 'react';
import { GameState, LogEntry, DebugLog, Character, RoundState } from '../../types';

export const useGameHistory = (
    stateRef: MutableRefObject<GameState>,
    updateState: (updater: (current: GameState) => GameState) => void,
    forceClearReactionRequest: () => void
) => {

  // Enhanced addLog with Snapshotting
  const addLog = (text: string, overrides?: Partial<LogEntry>) => {
    const s = stateRef.current;
    
    const isGlobalPhase = ['init', 'order', 'round_end'].includes(s.round.phase);
    
    let locationId: string | undefined = overrides?.locationId;
    let presentCharIds: string[] | undefined = overrides?.presentCharIds;
    let type: LogEntry['type'] = overrides?.type || 'narrative';

    if (text.startsWith('系统:') || text.startsWith('[系统]')) {
        type = 'system';
    } else if (text.startsWith('---')) {
        type = 'system';
    } else if (text.includes('使用了') || text.includes('花费') || text.includes('移动')) {
        type = 'action';
    }
    
    // Allow override type to persist if passed
    if (overrides?.type) type = overrides.type;

    if (locationId === undefined && (!isGlobalPhase || type === 'action')) {
        locationId = s.map.activeLocationId;
    }
        
    if (locationId && presentCharIds === undefined) {
        presentCharIds = Object.keys(s.characters).filter(id => {
            const pos = s.map.charPositions[id];
            return pos && pos.locationId === locationId;
        });
    }

    // Capture precise round state for restoration
    // We cast to any to allow injecting extra metadata like worldTime not strictly in RoundState type
    const snapshot: any = JSON.parse(JSON.stringify(s.round));
    
    // NEW: Inject World Time into snapshot for time delta calculations (Fix for {{LAST_PRESENT_TIME}})
    if (s.world.attributes.worldTime) {
        snapshot.worldTime = s.world.attributes.worldTime.value;
    }

    const newEntry: LogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        round: s.round.roundNumber,
        turnIndex: s.round.turnIndex,
        locationId,
        presentCharIds,
        content: text,
        timestamp: Date.now(),
        type,
        isReaction: false,
        snapshot, // ATTACH SNAPSHOT
        ...overrides 
    };

    updateState(prev => ({
      ...prev,
      world: {
        ...prev.world,
        history: [...prev.world.history, newEntry]
      }
    }));
  };

  const addDebugLog = (log: DebugLog) => {
      if (!stateRef.current.devMode) return;
      updateState(prev => ({
          ...prev,
          debugLogs: [...prev.debugLogs, log]
      }));
  };

  // --- RECONCILE STATE FROM HISTORY (SNAPSHOT BASED) ---
  const reconcileStateFromHistory = (history: LogEntry[]): Partial<GameState> => {
      // 1. Try to find the last valid snapshot in history
      for (let i = history.length - 1; i >= 0; i--) {
          const entry = history[i];
          if (entry.snapshot) {
              // Found a snapshot! Restore exact state.
              // Force paused state on restoration to prevent immediate execution loop
              return {
                  world: { ...stateRef.current.world, history },
                  round: { ...entry.snapshot, isPaused: true }
              };
          }
      }

      // 2. Fallback: Legacy Regex Logic (If no snapshots found - e.g. old save)
      console.warn("No snapshots found in history. Falling back to legacy regex reconciliation.");
      
      const defaultRoundState = {
          roundNumber: 1,
          turnIndex: 0,
          phase: 'init' as const,
          currentOrder: [],
          activeCharId: undefined,
          isPaused: true,
          useManualTurnOrder: false,
          isWaitingForManualOrder: false,
          skipSettlement: false,
          isWorldTimeFlowPaused: false
      };

      let roundStartIndex = -1;
      for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].content.match(/--- 第 (\d+) 轮 开始 ---/)) {
              roundStartIndex = i;
              break;
          }
      }

      if (roundStartIndex === -1) {
          return {
              world: { ...stateRef.current.world, history },
              round: { ...stateRef.current.round, ...defaultRoundState }
          };
      }

      const roundStartLog = history[roundStartIndex];
      const roundNumMatch = roundStartLog.content.match(/--- 第 (\d+) 轮 开始 ---/);
      const roundNumber = roundNumMatch ? parseInt(roundNumMatch[1]) : 1;

      const roundLogs = history.slice(roundStartIndex);
      let currentOrder: string[] = stateRef.current.round.defaultOrder;
      let phase: any = 'order';
      
      const orderLog = roundLogs.find(l => l.content.startsWith("系统: 本轮顺序") || l.content.startsWith("系统: 手动设定轮次顺序"));
      if (orderLog) {
          const match = orderLog.content.match(/\[(.*?)\]/);
          if (match) {
              const names = match[1].split(',').map(s => s.trim());
              const recoveredOrder: string[] = [];
              const charMap = Object.values(stateRef.current.characters) as Character[];
              
              names.forEach(name => {
                  const chars = charMap.filter(c => c.name === name || c.id === name);
                  let char = chars.find(c => c.isPlayer);
                  if (!char) char = chars[0]; 
                  if (char) recoveredOrder.push(char.id);
              });
              
              if (recoveredOrder.length > 0) {
                  currentOrder = recoveredOrder;
              } else {
                  currentOrder = stateRef.current.round.defaultOrder;
              }
          }
          phase = 'turn_start';
      } else {
          return {
              world: { ...stateRef.current.world, history },
              round: {
                  ...stateRef.current.round,
                  roundNumber,
                  turnIndex: 0,
                  phase: 'order',
                  isPaused: true
              }
          };
      }

      const settlementLog = roundLogs.find(l => l.content.includes("--- 轮次结算阶段"));
      const roundEndLog = roundLogs.find(l => l.content.includes("--- 第") && l.content.includes("轮 结束 ---"));

      if (roundEndLog) {
          return {
              world: { ...stateRef.current.world, history },
              round: {
                  ...stateRef.current.round,
                  roundNumber: roundNumber, 
                  turnIndex: 0,
                  phase: 'round_end',
                  isPaused: true
              }
          };
      }

      if (settlementLog) {
          return {
              world: { ...stateRef.current.world, history },
              round: {
                  ...stateRef.current.round,
                  roundNumber,
                  turnIndex: currentOrder.length - 1, 
                  phase: 'round_end', 
                  currentOrder,
                  isPaused: true
              }
          };
      }

      const orderLogIndex = roundLogs.indexOf(orderLog!);
      const effectiveLogs = roundLogs.slice(orderLogIndex + 1).filter(l => !l.isReaction);
      
      if (effectiveLogs.length === 0) {
          return {
              world: { ...stateRef.current.world, history },
              round: {
                  ...stateRef.current.round,
                  roundNumber,
                  turnIndex: 0,
                  phase: 'turn_start',
                  currentOrder,
                  activeCharId: currentOrder[0],
                  isPaused: true
              }
          };
      }

      const lastActionLog = effectiveLogs[effectiveLogs.length - 1];
      let recoveredIndex = lastActionLog.turnIndex;
      let nextTurnIndex = recoveredIndex + 1;

      let nextPhase: any = 'turn_start';
      if (nextTurnIndex >= currentOrder.length) {
          nextPhase = 'settlement';
      }

      return {
          world: { ...stateRef.current.world, history },
          round: {
              ...stateRef.current.round,
              roundNumber,
              turnIndex: nextTurnIndex,
              phase: nextPhase,
              currentOrder,
              activeCharId: nextPhase === 'turn_start' ? currentOrder[nextTurnIndex] : undefined,
              isPaused: true
          }
      };
  };

  const rollbackToLog = (logIndex: number) => {
      forceClearReactionRequest(); // Clear blocked UI on rollback
      const currentHistory = stateRef.current.world.history;
      const newHistory = currentHistory.slice(0, logIndex + 1);
      const updates = reconcileStateFromHistory(newHistory);
      
      updateState(prev => ({
          ...prev,
          ...updates,
      }));
  };

  // Special Regenerate: Rollback history but enforce current turn state
  const regenerateFromLog = (logIndex: number) => {
      forceClearReactionRequest();
      
      const currentHistory = stateRef.current.world.history;
      const targetLog = currentHistory[logIndex];
      
      // Safety check
      if (!targetLog) return;

      // --- New Logic for Environment Character Backtracking ---
      let cutIndex = logIndex;
      let forcedActiveCharId = undefined;
      let forcedPhase = undefined;

      // Check if this is an Environment Character Log
      const isEnvChar = targetLog.actingCharId && targetLog.actingCharId.startsWith('env_');
      
      if (isEnvChar) {
          // Scan backwards to find associated system logs (Conflicts, Drives, Settlements, Start Marker)
          // to include them in the removal.
          for (let i = logIndex - 1; i >= 0; i--) {
              const prevLog = currentHistory[i];
              
              // Stop if we change round/turn context
              if (prevLog.round !== targetLog.round || prevLog.turnIndex !== targetLog.turnIndex) {
                  break;
              }

              // Check for specific system log signatures
              // 1. Env Start Marker
              const isEnvStart = prevLog.content.includes("中人物的心理正在发生变化");
              // 2. Consequential Logs (though usually appear AFTER, checking just in case of weird order)
              const isConflict = prevLog.content.includes("新矛盾已产生");
              const isDrive = prevLog.content.includes("新欲望已产生");
              const isSettlement = prevLog.content.includes("轮次结算");

              if (prevLog.type === 'system' && (isEnvStart || isConflict || isDrive || isSettlement)) {
                  cutIndex = i; // Move cut point back
              } else {
                  // If we hit a non-system log or unrelated log (like another char's reaction), stop
                  break; 
              }
          }

          // Force state for re-execution
          forcedActiveCharId = targetLog.actingCharId;
          forcedPhase = 'char_acting';
      }

      // Slice history: Remove logs starting from cutIndex
      const newHistory = currentHistory.slice(0, cutIndex);
      
      // Get base state from reconciliation (mostly for world/map context safety)
      const baseUpdates = reconcileStateFromHistory(newHistory);
      
      // Determine active char based on the target log's turn index
      const restoredOrder = baseUpdates.round?.currentOrder || stateRef.current.round.currentOrder;
      const restoredActiveCharId = restoredOrder[targetLog.turnIndex] || undefined;

      // Check if we are regenerating from a "System" log that signifies order/round start
      const isOrderOperation = targetLog.content.includes("系统: 本轮行动顺序") || 
                               targetLog.content.includes("系统: 手动设定轮次顺序") ||
                               targetLog.content.includes("--- 第"); // Round start marker

      let finalPhase = forcedPhase || (isOrderOperation ? 'order' : 'char_acting');
      // If phase is order, we haven't decided active char yet
      let finalActiveCharId = forcedActiveCharId || (isOrderOperation ? undefined : restoredActiveCharId);

      // CRITICAL FIX: If we are supposed to be acting, but don't have a valid Character ID 
      // (e.g. Environment character index drift, or order array mismatch),
      // we MUST fall back to 'turn_start' to let the engine resolve the next valid actor.
      // This prevents the game from getting stuck in 'char_acting' with no active character.
      if (finalPhase === 'char_acting' && !finalActiveCharId) {
          finalPhase = 'turn_start';
      }

      const forcedRoundState: RoundState = {
          ...(baseUpdates.round || stateRef.current.round),
          roundNumber: targetLog.round,
          turnIndex: targetLog.turnIndex,
          phase: finalPhase as any, 
          activeCharId: finalActiveCharId,
          isPaused: true, // Pause to let user review/click play
          lastErrorMessage: undefined,
          isWaitingForManualOrder: false
      };

      updateState(prev => ({
          ...prev,
          ...baseUpdates,
          world: { ...prev.world, history: newHistory },
          round: forcedRoundState
      }));
  };

  return {
      addLog,
      addDebugLog,
      rollbackToLog,
      regenerateFromLog
  };
};
