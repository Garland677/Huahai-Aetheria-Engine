
import React, { useState, useRef, useEffect } from 'react';
import { GameState, Character, Card, Provider, AppSettings, AIConfig, GlobalContextConfig, DebugLog, WindowState, LogEntry, PrizePool, InitialWorldConfig, Trigger } from '../types';
import { initialWorldAttributes } from '../constants';
import { DEFAULT_API_CONFIG } from '../config';
import { generateInitialMap } from '../services/mapUtils';
import { INITIAL_DEFAULT_SETTINGS } from '../services/DefaultSettings';
import { encryptData, decryptData } from '../services/cryptoService';
import { getCharacterMemory } from '../services/aiService';
import { advanceWorldTime } from '../services/timeUtils';

const AUTOSAVE_KEY = 'aetheria_autosave_v1';

// Helper for time fetching with multiple robust fallbacks
// Uses HEAD requests to stable CDNs/APIs to get 'Date' header which is CORS-friendly and robust.
const fetchNetworkTime = async (): Promise<number> => {
    const appendTimestamp = (url: string) => {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}_t=${Date.now()}`;
    };

    const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 6000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            // CRITICAL FIX: Do NOT use { cache: 'no-store' }. 
            // Adding 'Cache-Control' header often triggers CORS preflight failure on simple endpoints.
            // We use URL parameter busting (appendTimestamp) instead.
            const res = await fetch(appendTimestamp(url), { ...options, signal: controller.signal });
            clearTimeout(id);
            return res;
        } catch (e) {
            clearTimeout(id);
            throw e;
        }
    };

    // Strategy List
    // We prioritize stable infrastructure (GitHub, CDNs) over niche Time APIs.
    const strategies = [
        // Strategy 1: GitHub API (HEAD) - Extremely reliable, CORS enabled.
        async () => {
            const res = await fetchWithTimeout('https://api.github.com', { method: 'HEAD' });
            const dateStr = res.headers.get('date');
            if (!dateStr) throw new Error('GitHub: No Date header');
            return new Date(dateStr).getTime();
        },
        // Strategy 2: jsDelivr CDN (HEAD) - Global, very fast, CORS friendly.
        async () => {
            const res = await fetchWithTimeout('https://cdn.jsdelivr.net/npm/react/package.json', { method: 'HEAD' });
            const dateStr = res.headers.get('date');
            if (!dateStr) throw new Error('jsDelivr: No Date header');
            return new Date(dateStr).getTime();
        },
        // Strategy 3: Taobao API (JSON) - Excellent for China region.
        async () => {
            const res = await fetchWithTimeout('https://api.m.taobao.com/rest/api3.do?api=mtop.common.getTimestamp');
            if (!res.ok) throw new Error(`Taobao HTTP ${res.status}`);
            const json = await res.json();
            const t = json?.data?.t;
            if (!t) throw new Error('Taobao: Invalid data');
            return parseInt(t, 10);
        },
        // Strategy 4: Unpkg CDN (HEAD) - Global Cloudflare-backed CDN.
        async () => {
            const res = await fetchWithTimeout('https://unpkg.com/', { method: 'HEAD' });
            const dateStr = res.headers.get('date');
            if (!dateStr) throw new Error('Unpkg: No Date header');
            return new Date(dateStr).getTime();
        }
    ];

    // Execute race (Manual Promise.any implementation for max compatibility)
    return new Promise((resolve, reject) => {
        let failureCount = 0;
        const errors: string[] = [];
        let resolved = false;

        strategies.forEach(strategy => {
            strategy()
                .then(time => {
                    if (resolved) return;
                    // Basic sanity check: Time must be > Jan 1 2024 (1704067200000) to be valid
                    if (time > 1704067200000) {
                        resolved = true;
                        resolve(time);
                    } else {
                        throw new Error(`Sanity check failed: ${time}`);
                    }
                })
                .catch(e => {
                    if (resolved) return;
                    failureCount++;
                    errors.push(e.message || String(e));
                    if (failureCount === strategies.length) {
                        reject(new Error(`验证服务器连接失败: 无可用的时间源。\n(Errors: ${errors.join('; ')})\n请检查网络连接。如使用代理，请尝试切换节点。`));
                    }
                });
        });
    });
};

// Factory to create a fresh game state with new map
const createInitialGameState = (initialWorldConfig?: InitialWorldConfig): GameState => {
  const { map, characters } = generateInitialMap(initialWorldConfig || INITIAL_DEFAULT_SETTINGS.initialWorldConfig);
  
  // Create initial log entry
  const initialLog: LogEntry = {
      id: `log_init_${Date.now()}`,
      round: 1,
      turnIndex: 0,
      content: "系统: 模拟已启动。你位于「起始营地」。请创建角色以开启故事。",
      timestamp: Date.now(),
      type: 'system'
  };

  const startLog: LogEntry = {
      id: `log_start_${Date.now()}`,
      round: 1,
      turnIndex: 0,
      content: "--- 第 1 轮 开始 ---",
      timestamp: Date.now() + 1,
      type: 'system'
  };

  // Determine default location ID if possible (it's usually loc_start_0_0)
  const startLocId = map.activeLocationId || 'loc_start_0_0';

  const defaultPrizePool: PrizePool = {
      id: 'pool_01',
      name: '神秘补给箱',
      description: '散落在世界各地的旧世界补给箱，里面可能含有有用的物资，也可能只有垃圾。',
      locationIds: [startLocId], // Initially at start location
      items: [
          { id: 'item_01', name: '过期罐头', description: '虽然过期了，但也许还能吃...', weight: 50 },
          { id: 'item_02', name: '生锈的匕首', description: '一把勉强能用的防身武器。', weight: 30 },
          { id: 'item_03', name: '急救包', description: '珍贵的医疗物资。', weight: 15 },
          { id: 'item_04', name: '旧世界芯片', description: '似乎记载着某种科技数据。', weight: 5 }
      ]
  };

  return {
    world: {
      attributes: initialWorldAttributes,
      history: [startLog, initialLog],
      worldGuidance: "近未来背景，人口大幅缩减。城市科技高度发达，但充斥着欲望与犯罪。部分人自愿离开城市，在衰败的村镇或野外生活。但也存在特例，区域内的地点故事应该与其它地点有所不同，保持新鲜感。这是一个中文世界，如果没有特殊的需求，角色名称应该为中国人名。"
    },
    map,
    round: {
      roundNumber: 1,
      turnIndex: 0,
      phase: 'init',
      defaultOrder: [],
      currentOrder: [],
      isReverse: false,
      isPaused: true,
      autoAdvance: false,
      autoAdvanceCount: 0, // Initialized
      actionPoints: 50,
      lastErrorMessage: undefined,
      useManualTurnOrder: false, // Explicit default
      isWaitingForManualOrder: false,
      skipSettlement: false,
      autoReaction: true, // Default to auto
      isWorldTimeFlowPaused: false // Default time flows
    },
    characters,
    cardPool: [],
    prizePools: {
        [defaultPrizePool.id]: defaultPrizePool
    },
    triggers: {}, // Initialize Trigger Pool
    judgeConfig: {
      provider: Provider.XAI,
      model: 'grok-4-1-fast-reasoning',
      temperature: 1
    },
    globalContext: {
        messages: []
    },
    appSettings: {
        apiKeys: DEFAULT_API_CONFIG,
        maxContextSize: 32000,
        reactionContextTurns: 5,
        devOptionsUnlocked: false,
        devPassword: "",
        encryptSaveFiles: false,
        maxHistoryRounds: 20, // Default global history limit
        maxShortHistoryRounds: 5, // Default short history limit for logic
        maxCharacterMemoryRounds: 20, // Default character memory limit
        saveExpirationDate: "", // New
        globalVariables: [], // New
        storyLogLightMode: false, // Default Dark
        lockedFeatures: {
            cardPoolEditor: false,
            characterEditor: false,
            locationEditor: false,
            actionPoints: false,
            locationReset: false,
            worldState: false,
            directorInstructions: false,
            prizePoolEditor: false,
            triggerEditor: false // New
        }
    },
    defaultSettings: INITIAL_DEFAULT_SETTINGS,
    devMode: false,
    debugLogs: []
  };
};

export const useGame = () => {
  // Initialize state: Try loading Autosave first, else create fresh
  const [state, setState] = useState<GameState>(() => {
      try {
          const saved = localStorage.getItem(AUTOSAVE_KEY);
          if (saved) {
              const parsed = JSON.parse(saved);
              // Basic integrity check
              if (parsed && parsed.world && parsed.map && parsed.characters) {
                  // Append a resume log so the user knows what happened
                  const resumeLog: LogEntry = {
                      id: `log_resume_${Date.now()}`,
                      round: parsed.round?.roundNumber || 1,
                      turnIndex: parsed.round?.turnIndex || 0,
                      content: "系统: 检测到自动存档，已恢复上次的游戏进度。",
                      timestamp: Date.now(),
                      type: 'system'
                  };
                  // Ensure history exists
                  if (!parsed.world.history) parsed.world.history = [];
                  parsed.world.history.push(resumeLog);
                  
                  // Ensure prizePools structure exists (migration)
                  if (!parsed.prizePools) {
                      const def = createInitialGameState().prizePools;
                      parsed.prizePools = def;
                  }
                  // Ensure triggers structure exists (migration)
                  if (!parsed.triggers) {
                      parsed.triggers = {};
                  }
                  
                  // Ensure locationIds exists on prize pools (migration)
                  if (parsed.prizePools) {
                      Object.values(parsed.prizePools).forEach((pool: any) => {
                          if (!pool.locationIds) pool.locationIds = [];
                      });
                  }
                  
                  // Ensure new settings exist (migration)
                  if (!parsed.appSettings.maxHistoryRounds) parsed.appSettings.maxHistoryRounds = 20;
                  if (!parsed.appSettings.maxCharacterMemoryRounds) parsed.appSettings.maxCharacterMemoryRounds = 20;
                  if (!parsed.appSettings.maxShortHistoryRounds) parsed.appSettings.maxShortHistoryRounds = 5;
                  if (!parsed.appSettings.globalVariables) parsed.appSettings.globalVariables = [];
                  if (parsed.appSettings.storyLogLightMode === undefined) parsed.appSettings.storyLogLightMode = false;
                  
                  // Ensure autoReaction exists (migration)
                  if (parsed.round.autoReaction === undefined) parsed.round.autoReaction = true;
                  if (parsed.round.isWorldTimeFlowPaused === undefined) parsed.round.isWorldTimeFlowPaused = false;

                  return parsed;
              }
          }
      } catch (e) {
          console.warn("Failed to load autosave:", e);
      }
      return createInitialGameState();
  });

  const stateRef = useRef<GameState>(state);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [windows, setWindows] = useState<WindowState[]>([]);
  
  // Save/Load Modal State
  const [saveLoadModal, setSaveLoadModal] = useState<{
      type: 'save' | 'load';
      dataToLoad?: any; 
      fileToLoad?: File; 
      isOpen: boolean;
      error?: string; 
  }>({ type: 'save', isOpen: false });

  // Password Verification Modal State (For overriding expiration/network errors)
  const [passwordChallenge, setPasswordChallenge] = useState<{
      isOpen: boolean;
      message: string;
      resolve: (pwd: string | null) => void;
  } | null>(null);

  // New: Manual Reaction Request State
  const [reactionRequest, setReactionRequest] = useState<{
      isOpen: boolean;
      message: string;
      title: string;
      charId: string;
      resolve: (response: string | null) => void;
  } | null>(null);

  // Sync ref
  useEffect(() => {
      stateRef.current = state;
  }, [state]);

  // --- AUTOSAVE EFFECT ---
  useEffect(() => {
      // Debounce save to avoid performance hit on rapid typing/updates
      const timer = setTimeout(() => {
          try {
              // We verify round number to avoid saving an empty/corrupted init state if something went wrong
              if (state.round && state.round.roundNumber >= 1) {
                  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
              }
          } catch (e) {
              console.error("Autosave failed (likely quota exceeded):", e);
          }
      }, 1000); // 1 second debounce

      return () => clearTimeout(timer);
  }, [state]);

  // --- AUTOMATIC WORLD TIME FLOW EFFECT ---
  useEffect(() => {
      const interval = setInterval(() => {
          // Check if time flow is paused
          if (stateRef.current.round.isWorldTimeFlowPaused) return;

          // Get current time attribute
          const timeAttr = stateRef.current.world.attributes['worldTime'];
          if (timeAttr) {
              const currentStr = timeAttr.value as string;
              
              // Apply Time Scale
              const scale = stateRef.current.defaultSettings.gameplay.worldTimeScale || 1;
              
              // Advance by 1 second * scale
              const newTimeStr = advanceWorldTime(currentStr, 1 * scale);
              
              // Only update if changed (optimization)
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
      }, 1000);

      return () => clearInterval(interval);
  }, []);

  const updateState = (updater: (current: GameState) => GameState) => {
      const next = updater(stateRef.current);
      stateRef.current = next;
      setState(next);
  };

  // Enhanced addLog with Context Capture
  const addLog = (text: string, overrides?: Partial<LogEntry>) => {
    const s = stateRef.current;
    
    const isGlobalPhase = ['init', 'order', 'round_end'].includes(s.round.phase);
    
    let locationId: string | undefined = undefined;
    let presentCharIds: string[] | undefined = undefined;
    let type: LogEntry['type'] = 'narrative';

    if (text.startsWith('系统:') || text.startsWith('[系统]')) {
        type = 'system';
    } else if (text.startsWith('---')) {
        type = 'system';
    } else if (text.includes('使用了') || text.includes('花费') || text.includes('移动')) {
        type = 'action';
    }

    if (!isGlobalPhase || type === 'action') {
        locationId = s.map.activeLocationId;
        
        if (locationId) {
            presentCharIds = Object.keys(s.characters).filter(id => {
                const pos = s.map.charPositions[id];
                return pos && pos.locationId === locationId;
            });
        }
    }

    const newEntry: LogEntry = {
        id: `log_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        round: s.round.roundNumber,
        turnIndex: s.round.turnIndex,
        locationId,
        presentCharIds,
        content: text,
        timestamp: Date.now(),
        type,
        isReaction: false,
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

  // Window Management
  const openWindow = (type: WindowState['type'], data?: any) => {
    setWindows(prev => [...prev, { type, data, id: Date.now() }]);
  };

  const closeWindow = (id: number) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  };

  const respondToPasswordChallenge = (pwd: string | null) => {
      if (passwordChallenge && passwordChallenge.resolve) {
          passwordChallenge.resolve(pwd);
          setPasswordChallenge(null);
      }
  };

  const requestPlayerReaction = (charId: string, title: string, message: string): Promise<string | null> => {
      return new Promise((resolve) => {
          setReactionRequest({
              isOpen: true,
              title,
              message,
              charId,
              resolve: (response) => {
                  setReactionRequest(null);
                  resolve(response);
              }
          });
      });
  };

  const respondToReactionRequest = (response: string | null) => {
      if (reactionRequest && reactionRequest.resolve) {
          reactionRequest.resolve(response);
      }
  };

  // Reset Game Logic - Full Factory Reset
  const resetGame = () => {
      // Security Fix: Do not preserve existing keys.
      // Reset means full wipe to prevent leakage of sensitive data when dev password is reset.
      
      // 1. Clear Autosave
      localStorage.removeItem(AUTOSAVE_KEY);

      // 2. Regenerate State from Scratch using SYSTEM DEFAULTS
      // We pass undefined to force usage of INITIAL_DEFAULT_SETTINGS in createInitialGameState
      const freshState = createInitialGameState();
      
      const newState: GameState = {
          ...freshState,
          world: {
             ...freshState.world,
             history: [{
                 id: `log_reset_${Date.now()}`,
                 round: 1, 
                 turnIndex: 0, 
                 content: "系统: 游戏已完全重置 (Factory Reset)。所有设定（包括 API Key）已恢复默认。", 
                 timestamp: Date.now(), 
                 type: 'system' 
             }]
          }
      };

      // Force instant save to overwrite any pending debounced autosaves from the previous session state
      try {
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(newState));
      } catch (e) {
          console.error("Force autosave failed during reset:", e);
      }

      updateState(() => newState);
      addLog("系统: 初始化完成。");
  };

  // Import Characters Logic
  const importCharacters = (charsToImport: Character[], sourceHistory: LogEntry[] = [], keepMemory: boolean = false, memoryRounds: number = 20) => {
      updateState(prev => {
          const newChars = { ...prev.characters };
          const newPositions = { ...prev.map.charPositions };
          const activeLocId = prev.map.activeLocationId || 'loc_start_0_0';
          const targetLoc = prev.map.locations[activeLocId];
          
          let importedCount = 0;

          charsToImport.forEach(char => {
              // Clone to avoid ref issues
              const newChar = JSON.parse(JSON.stringify(char));
              
              // Ensure unique ID if collision exists
              if (newChars[newChar.id]) {
                  newChar.id = `${newChar.id}_imp_${Date.now()}`;
              }
              
              // Reset conflict state
              if (newChar.conflicts) {
                  newChar.conflicts.forEach((c: any) => c.solved = false);
              }

              // Handle Memory Retention
              if (keepMemory && sourceHistory.length > 0) {
                  // We use the original ID for memory lookup because sourceHistory uses original ID
                  const originalId = char.id; 
                  const memory = getCharacterMemory(sourceHistory, originalId, undefined, memoryRounds);
                  if (memory) {
                      const memoryBlock = `\n\n[该角色的前世记忆：${memoryRounds}轮]\n${memory}`;
                      newChar.description = (newChar.description || "") + memoryBlock;
                  }
              }

              // Add to characters
              newChars[newChar.id] = newChar;
              
              // Place at current location
              newPositions[newChar.id] = {
                  x: targetLoc ? targetLoc.coordinates.x : 0,
                  y: targetLoc ? targetLoc.coordinates.y : 0,
                  locationId: activeLocId
              };
              
              importedCount++;
          });

          // Add to turn order if not present
          let newOrder = prev.round.currentOrder;
          
          // Re-scan newChars to find newly added IDs that aren't in order
          Object.keys(newChars).forEach(id => {
              if (!prev.characters[id] && !newOrder.includes(id)) {
                  newOrder = [...newOrder, id];
              }
          });

          return {
              ...prev,
              characters: newChars,
              map: { ...prev.map, charPositions: newPositions },
              round: { ...prev.round, currentOrder: newOrder }
          };
      });
      
      if (keepMemory) {
          charsToImport.forEach(c => {
              addLog(`系统: 角色 [${c.name}] 被神秘力量传送到了这个世界。`);
          });
      } else {
          addLog(`系统: 已导入 ${charsToImport.length} 名角色到当前地点。`);
      }
      
      setSaveLoadModal({ ...saveLoadModal, isOpen: false });
  };

  // --- State Reconciliation for Branching ---
  const reconcileStateFromHistory = (history: LogEntry[]): Partial<GameState> => {
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
          isWorldTimeFlowPaused: false // Default
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
      
      // Preserve manual setting from current state (users preference)
      // We spread `stateRef.current.round` below, so `useManualTurnOrder` is kept.

      const orderLog = roundLogs.find(l => l.content.startsWith("系统: 本轮顺序") || l.content.startsWith("系统: 手动设定轮次顺序"));
      if (orderLog) {
          const match = orderLog.content.match(/\[(.*?)\]/);
          if (match) {
              const names = match[1].split(',').map(s => s.trim());
              const recoveredOrder: string[] = [];
              const charMap = Object.values(stateRef.current.characters) as Character[];
              
              names.forEach(name => {
                  // FIX: Prefer isPlayer character if names duplicate to ensure player control isn't lost to an NPC clone
                  const chars = charMap.filter(c => c.name === name || c.id === name);
                  let char = chars.find(c => c.isPlayer);
                  if (!char) char = chars[0]; // Fallback to first match
                  
                  if (char) recoveredOrder.push(char.id);
              });
              
              if (recoveredOrder.length > 0) {
                  currentOrder = recoveredOrder;
              } else {
                  // Fallback to default if recovery failed completely
                  currentOrder = stateRef.current.round.defaultOrder;
              }
          }
          phase = 'turn_start';
      } else {
          // Start of round before order determined
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
      
      // Filter logs to exclude reactions when determining turn index
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
      const currentHistory = stateRef.current.world.history;
      const newHistory = currentHistory.slice(0, logIndex + 1);
      const updates = reconcileStateFromHistory(newHistory);
      
      updateState(prev => ({
          ...prev,
          ...updates,
      }));
  };

  // File I/O Logic
  const onSaveClick = () => {
      setSaveLoadModal({ type: 'save', isOpen: true });
  };

  const executeSave = async (
      includeProgress: boolean, 
      includeSettings: boolean, 
      includeApiKeys: boolean, 
      customFilename?: string,
      expirationDateOverride?: string
  ) => {
      const s = stateRef.current;
      const exportData: any = {};
      exportData.timestamp = Date.now();
      
      if (includeProgress) {
          exportData.world = s.world;
          exportData.round = s.round;
          exportData.characters = s.characters;
          exportData.cardPool = s.cardPool;
          exportData.prizePools = s.prizePools; // Export Prize Pools
          exportData.triggers = s.triggers; // Export Triggers
          exportData.debugLogs = s.debugLogs;
      }

      if (includeSettings) {
          const settingsToSave = { ...s.appSettings, devOptionsUnlocked: false };
          // Apply expiration date override from modal if provided
          if (expirationDateOverride !== undefined) {
              settingsToSave.saveExpirationDate = expirationDateOverride;
          }

          exportData.appSettings = settingsToSave;
          exportData.judgeConfig = s.judgeConfig;
          exportData.globalContext = s.globalContext;
          exportData.defaultSettings = s.defaultSettings;
          exportData.devMode = s.devMode;

          if (!includeApiKeys) {
              exportData.appSettings.apiKeys = { [Provider.XAI]: '', [Provider.GEMINI]: '', [Provider.VOLCANO]: '', [Provider.OPENROUTER]: '' };
              if (exportData.judgeConfig) exportData.judgeConfig.apiKey = '';
          }
      } else if (includeApiKeys) {
          // Only exporting keys
          exportData.appSettings = {
              apiKeys: s.appSettings.apiKeys
          };
      }

      if (includeProgress) {
          exportData.map = s.map;
      }

      let filename = customFilename;
      if (!filename) {
          const date = new Date();
          const timeStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const activeLoc = s.map.activeLocationId ? s.map.locations[s.map.activeLocationId] : null;
          const regionName = activeLoc?.regionId && s.map.regions[activeLoc.regionId] ? s.map.regions[activeLoc.regionId].name : "UnknownRegion";
          const locName = activeLoc ? activeLoc.name : "UnknownLoc";
          filename = `${timeStr}_${regionName}_${locName}`;
      }
      
      filename = filename.replace(/\.json$/, '');
      let dataStr = JSON.stringify(exportData, null, 2);
      
      if (s.appSettings.encryptSaveFiles) {
          try {
              dataStr = await encryptData(dataStr, filename);
          } catch (e: any) {
              console.error("Encryption Failed:", e);
              alert(`加密失败: ${e.message}`);
              return;
          }
      }

      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog(`系统: 游戏保存成功 (${filename}.json)`);
      setSaveLoadModal({ ...saveLoadModal, isOpen: false });
  };

  const onLoadClick = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setSaveLoadModal({ type: 'load', isOpen: true, fileToLoad: file, error: undefined });
      if(fileInputRef.current) fileInputRef.current.value = '';
  };

  // Unified Function to Read, Decrypt and Validate Expiration of a Save File
  const parseAndValidateSave = async (file: File): Promise<any> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (ev) => {
              try {
                  const rawContent = ev.target?.result as string;
                  let json: any;

                  try {
                      json = JSON.parse(rawContent);
                  } catch (e) {
                      try {
                          const filenameNoExt = file.name.replace(/\.json$/i, '');
                          const decryptedStr = await decryptData(rawContent, filenameNoExt);
                          json = JSON.parse(decryptedStr);
                          addLog("系统: 存档解密验证成功。");
                      } catch (decryptErr: any) {
                          throw new Error(`存档加载失败: 文件损坏或解密失败。\n注意：加密存档的文件名必须与保存时完全一致。\nDetails: ${decryptErr.message}`);
                      }
                  }

                  // --- Security & Expiration Logic ---
                  const promptUser = (msg: string) => {
                      return new Promise<string | null>((resolvePrompt) => {
                          setPasswordChallenge({
                              isOpen: true,
                              message: msg,
                              resolve: (val) => resolvePrompt(val)
                          });
                      });
                  };

                  if (json.appSettings && json.appSettings.saveExpirationDate) {
                      const expDateStr = json.appSettings.saveExpirationDate;
                      const expTime = new Date(expDateStr).getTime();
                      const savedPwd = json.appSettings.devPassword || "";
                      
                      if (!isNaN(expTime)) {
                          addLog("系统: 正在验证存档时效性 (Verification)...");
                          try {
                              const networkTime = await fetchNetworkTime();
                              if (networkTime > expTime) {
                                  const msg = `此存档已于 [${new Date(expTime).toLocaleString()}] 过期。\nThis save file has expired.`;
                                  const pwd = await promptUser(`${msg}\n\n请输入开发者密码以继续加载 (Enter Developer Password to Override):`);
                                  
                                  if (pwd !== savedPwd) {
                                      throw new Error("存档已过期且密码验证失败 (Expired & Invalid Password).");
                                  } else {
                                      addLog("系统: 开发者密码验证通过，强制加载过期存档。");
                                  }
                              } else {
                                  addLog("系统: 存档时效性验证通过。");
                              }
                          } catch (e: any) {
                              if (e.message.includes("Expired & Invalid Password")) {
                                  throw e;
                              }

                              const pwd = await promptUser(`${e.message}\n\n无法验证时间。如果您是开发者，请输入密码以跳过验证:`);
                              if (pwd !== savedPwd) {
                                  throw new Error(`安全验证阻止了加载:\n${e.message}`);
                              } else {
                                  addLog("系统: 开发者密码验证通过，跳过网络时间检查。");
                              }
                          }
                      }
                  }
                  // ---------------------------------------
                  resolve(json);

              } catch (e: any) {
                  reject(e);
              }
          };
          reader.readAsText(file);
      });
  };

  const executeLoad = async (includeProgress: boolean, includeSettings: boolean, includeApiKeys: boolean) => {
      const file = saveLoadModal.fileToLoad;
      if (!file) return;

      setSaveLoadModal(prev => ({ ...prev, error: undefined }));

      try {
          const json = await parseAndValidateSave(file);

          if (includeSettings && json.appSettings) {
              const mergedLockedFeatures = {
                  ...createInitialGameState().appSettings.lockedFeatures,
                  ...(json.appSettings.lockedFeatures || {})
              };

              const apiKeysToUse = includeApiKeys ? json.appSettings.apiKeys : stateRef.current.appSettings.apiKeys;
              const judgeKeyToUse = includeApiKeys ? (json.judgeConfig?.apiKey || '') : (stateRef.current.judgeConfig?.apiKey || '');

              // Migration for new settings
              const mergedSettings = {
                  ...createInitialGameState().appSettings,
                  ...json.appSettings,
                  apiKeys: apiKeysToUse,
                  lockedFeatures: mergedLockedFeatures,
                  globalVariables: json.appSettings.globalVariables || []
              };

              updateState(prev => {
                  const newState = { ...prev };
                  if (includeSettings) {
                      newState.appSettings = mergedSettings;
                      if (json.judgeConfig) newState.judgeConfig = json.judgeConfig;
                      if (json.globalContext) newState.globalContext = json.globalContext;
                      if (json.defaultSettings) newState.defaultSettings = json.defaultSettings;
                      if (json.devMode !== undefined) newState.devMode = json.devMode;
                  } else if (includeApiKeys) {
                      // Just keys
                      newState.appSettings = { ...prev.appSettings, apiKeys: apiKeysToUse };
                  }

                  if (includeProgress) {
                      if (json.world) newState.world = json.world;
                      if (json.map) newState.map = json.map;
                      if (json.round) newState.round = json.round;
                      if (json.characters) newState.characters = json.characters;
                      if (json.cardPool) newState.cardPool = json.cardPool;
                      if (json.prizePools) newState.prizePools = json.prizePools;
                      if (json.triggers) newState.triggers = json.triggers;
                      if (json.debugLogs) newState.debugLogs = json.debugLogs;
                  }
                  
                  // Add load log
                  const logId = `log_load_${Date.now()}`;
                  const loadLog: LogEntry = {
                      id: logId,
                      round: newState.round.roundNumber,
                      turnIndex: newState.round.turnIndex,
                      content: `系统: 游戏数据已加载 (${file.name})`,
                      timestamp: Date.now(),
                      type: 'system'
                  };
                  if(!newState.world.history) newState.world.history = [];
                  newState.world.history.push(loadLog);

                  return newState;
              });

              setSaveLoadModal({ ...saveLoadModal, isOpen: false });
              addLog("系统: 加载成功。");

          } else {
              // Fallback if settings not included but progress is, or partial load logic
              updateState(prev => {
                  const newState = { ...prev };
                  if (includeProgress) {
                      if (json.world) newState.world = json.world;
                      if (json.map) newState.map = json.map;
                      if (json.round) newState.round = json.round;
                      if (json.characters) newState.characters = json.characters;
                      if (json.cardPool) newState.cardPool = json.cardPool;
                      if (json.prizePools) newState.prizePools = json.prizePools;
                      if (json.triggers) newState.triggers = json.triggers;
                      if (json.debugLogs) newState.debugLogs = json.debugLogs;
                  }
                  
                  const logId = `log_load_${Date.now()}`;
                  const loadLog: LogEntry = {
                      id: logId,
                      round: newState.round.roundNumber,
                      turnIndex: newState.round.turnIndex,
                      content: `系统: 游戏数据已加载 (${file.name})`,
                      timestamp: Date.now(),
                      type: 'system'
                  };
                  if(!newState.world.history) newState.world.history = [];
                  newState.world.history.push(loadLog);

                  return newState;
              });
              setSaveLoadModal({ ...saveLoadModal, isOpen: false });
              addLog("系统: 加载成功 (仅进度)。");
          }

      } catch (e: any) {
          console.error("Load failed:", e);
          setSaveLoadModal(prev => ({ ...prev, error: `加载失败: ${e.message}` }));
      }
  };

  return {
    state,
    stateRef,
    updateState,
    addLog,
    addDebugLog,
    openWindow,
    closeWindow,
    windows,
    onSaveClick,
    onLoadClick,
    fileInputRef,
    saveLoadModal,
    setSaveLoadModal,
    executeSave,
    executeLoad,
    parseAndValidateSave,
    resetGame,
    importCharacters,
    rollbackToLog,
    passwordChallenge,
    respondToPasswordChallenge,
    reactionRequest,
    respondToReactionRequest,
    requestPlayerReaction
  };
};
