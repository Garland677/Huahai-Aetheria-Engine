
import { useState, useRef, useEffect } from 'react';
import { GameState, LogEntry } from '../types';
import { createInitialGameState } from '../services/gameFactory';
import { advanceWorldTime } from '../services/timeUtils';
import { useGameUI } from './game/useGameUI';
import { useGameHistory } from './game/useGameHistory';
import { useGamePersistence, AUTOSAVE_KEY } from './game/useGamePersistence';
import { App } from '@capacitor/app';
import { storage } from '../services/storageService';

export const useGame = () => {
  // 1. Start with Default State immediately
  const [state, setState] = useState<GameState>(createInitialGameState());
  const [isStateLoaded, setIsStateLoaded] = useState(false); // New Loading Flag

  // 2. Async Load Effect
  useEffect(() => {
      const loadState = async () => {
          try {
              // Clear legacy localStorage if it exists to free space
              if (localStorage.getItem(AUTOSAVE_KEY)) {
                  console.log("Migrating/Clearing legacy localStorage save...");
                  localStorage.removeItem(AUTOSAVE_KEY);
              }

              // Load from IndexedDB
              const saved = await storage.getItem<GameState>(AUTOSAVE_KEY);
              
              if (saved && saved.world && saved.map && saved.characters) {
                  // Validate & Migration Logic (Same as before but on the object directly)
                  // Snapshot current parsed state for the resume log
                  const resumeSnapshot = saved.round ? JSON.parse(JSON.stringify(saved.round)) : undefined;
                  
                  const resumeLog: LogEntry = {
                      id: `log_resume_${Date.now()}`,
                      round: saved.round?.roundNumber || 1,
                      turnIndex: saved.round?.turnIndex || 0,
                      content: "系统: 检测到自动存档，已恢复上次的游戏进度。",
                      timestamp: Date.now(),
                      type: 'system',
                      snapshot: resumeSnapshot
                  };
                  if (!saved.world.history) saved.world.history = [];
                  saved.world.history.push(resumeLog);
                  
                  // Migrations...
                  if (!saved.prizePools) saved.prizePools = createInitialGameState().prizePools;
                  if (!saved.triggers) saved.triggers = {};
                  if (!saved.charGenConfig) saved.charGenConfig = saved.judgeConfig || createInitialGameState().charGenConfig;
                  if (!saved.charBehaviorConfig) saved.charBehaviorConfig = saved.judgeConfig || createInitialGameState().charBehaviorConfig;
                  if (saved.prizePools) {
                      Object.values(saved.prizePools).forEach((pool: any) => {
                          if (!pool.locationIds) pool.locationIds = [];
                      });
                  }
                  if (!saved.appSettings.maxHistoryRounds) saved.appSettings.maxHistoryRounds = 20;
                  if (!saved.appSettings.maxCharacterMemoryRounds) saved.appSettings.maxCharacterMemoryRounds = 20;
                  if (!saved.appSettings.maxShortHistoryRounds) saved.appSettings.maxShortHistoryRounds = 5;
                  if (!saved.appSettings.globalVariables) saved.appSettings.globalVariables = [];
                  if (saved.appSettings.storyLogLightMode === undefined) saved.appSettings.storyLogLightMode = false;
                  if (saved.appSettings.showHiddenRoundContent === undefined) saved.appSettings.showHiddenRoundContent = false;
                  if (saved.round.autoReaction === undefined) saved.round.autoReaction = false; 
                  if (saved.round.isWorldTimeFlowPaused === undefined) saved.round.isWorldTimeFlowPaused = false;
                  
                  // Migration for Split Memory Dropout
                  if ((saved.appSettings as any).memoryDropoutProbability !== undefined) {
                      if (saved.appSettings.reactionMemoryDropoutProbability === undefined) {
                          saved.appSettings.reactionMemoryDropoutProbability = (saved.appSettings as any).memoryDropoutProbability;
                      }
                      delete (saved.appSettings as any).memoryDropoutProbability;
                  }
                  if (saved.appSettings.actionMemoryDropoutProbability === undefined) {
                      saved.appSettings.actionMemoryDropoutProbability = 0.34;
                  }
                  if (saved.appSettings.reactionMemoryDropoutProbability === undefined) {
                      saved.appSettings.reactionMemoryDropoutProbability = 0.34;
                  }

                  // Apply Loaded State
                  setState(saved);
              }
          } catch (e) {
              console.warn("Failed to load autosave from IndexedDB:", e);
              // On error, we stay with default state, which is fine
          } finally {
              setIsStateLoaded(true); // Mark as loaded regardless of success/fail
          }
      };
      
      loadState();
  }, []);

  const stateRef = useRef<GameState>(state);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
      stateRef.current = state;
  }, [state]);

  const updateState = (updater: (current: GameState) => GameState) => {
      const next = updater(stateRef.current);
      stateRef.current = next;
      setState(next);
  };

  // --- Initialize Sub-Hooks ---
  const ui = useGameUI();
  const history = useGameHistory(stateRef, updateState, ui.forceClearReactionRequest);
  
  const persistence = useGamePersistence(
      state, 
      stateRef, 
      updateState, 
      history.addLog, 
      ui.saveLoadModal, 
      ui.setSaveLoadModal, 
      ui.setPasswordChallenge, 
      ui.forceClearReactionRequest
  );

  // --- World Time Loop (Optimized for Background Battery Saving) ---
  useEffect(() => {
      // Use a ref to track background state so the interval closure always sees current value
      const isBackgroundRef = { current: false };

      // 1. Web Page Visibility
      const handleVisibilityChange = () => {
          isBackgroundRef.current = document.hidden;
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // 2. Native App State (Capacitor)
      let nativeListener: any = null;
      App.addListener('appStateChange', (state) => {
          isBackgroundRef.current = !state.isActive;
      }).then(handle => {
          nativeListener = handle;
      });

      // Updated: 15 seconds interval to reduce CPU load and heat
      const interval = setInterval(() => {
          // Optimization: If manually paused OR app is in background, skip calculation & render
          if (stateRef.current.round.isWorldTimeFlowPaused || isBackgroundRef.current) return;

          const timeAttr = stateRef.current.world.attributes['worldTime'];
          if (timeAttr) {
              const currentStr = timeAttr.value as string;
              const scale = stateRef.current.defaultSettings.gameplay.worldTimeScale || 1;
              // Advance by 15 seconds per tick (15 * scale) to match interval
              const newTimeStr = advanceWorldTime(currentStr, 15 * scale);
              
              if (newTimeStr !== currentStr) {
                  updateState(prev => ({
                      ...prev,
                      world: {
                          ...prev.world,
                          attributes: {
                              ...prev.world.attributes,
                              worldTime: { ...prev.world.attributes.worldTime, value: newTimeStr }
                          }
                      }
                  }));
              }
          }
      }, 15000);

      return () => {
          clearInterval(interval);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          if (nativeListener) nativeListener.remove();
      };
  }, []);

  return {
    state,
    stateRef,
    updateState,
    fileInputRef,
    isStateLoaded, // Export this flag
    // UI
    openWindow: ui.openWindow,
    closeWindow: ui.closeWindow,
    windows: ui.windows,
    saveLoadModal: ui.saveLoadModal,
    setSaveLoadModal: ui.setSaveLoadModal,
    passwordChallenge: ui.passwordChallenge,
    respondToPasswordChallenge: ui.respondToPasswordChallenge,
    reactionRequest: ui.reactionRequest,
    respondToReactionRequest: ui.respondToReactionRequest,
    requestPlayerReaction: ui.requestPlayerReaction,
    cancelReactionRequest: ui.forceClearReactionRequest,
    // History
    addLog: history.addLog,
    addDebugLog: history.addDebugLog,
    rollbackToLog: history.rollbackToLog,
    regenerateFromLog: history.regenerateFromLog,
    // Persistence
    onSaveClick: persistence.onSaveClick,
    onLoadClick: persistence.onLoadClick,
    executeSave: persistence.executeSave,
    executeLoad: persistence.executeLoad,
    parseAndValidateSave: persistence.parseAndValidateSave,
    resetGame: persistence.resetGame,
    importCharacters: persistence.importCharacters,
  };
};
