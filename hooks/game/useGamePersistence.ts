

import React, { useEffect, useRef } from 'react';
import { GameState, Character, LogEntry, Provider, Card, AttributeType, AttributeVisibility } from '../../types';
import { createInitialGameState } from '../../services/gameFactory';
import { fetchNetworkTime } from '../../services/networkUtils';
import { encryptData, decryptData } from '../../services/cryptoService';
import { extractCharacterHistory } from '../../services/ai/memoryUtils';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { App } from '@capacitor/app';
import { generateCharacterId, generateCardId } from '../../services/idUtils';
import { storage } from '../../services/storageService';
import { imageStorage } from '../../services/imageStorage';

export const AUTOSAVE_KEY = 'aetheria_autosave_v1';

export const useGamePersistence = (
    state: GameState,
    stateRef: React.MutableRefObject<GameState>,
    updateState: (updater: (current: GameState) => GameState) => void,
    addLog: (text: string, overrides?: Partial<LogEntry>) => void,
    saveLoadModal: any,
    setSaveLoadModal: any,
    setPasswordChallenge: any,
    forceClearReactionRequest: () => void
) => {

  // --- CORE SAVE LOGIC (Async via IndexedDB) ---
  const persistState = async () => {
      try {
          const s = stateRef.current;
          // Valid check: Ensure round exists and game has actually started (Round >= 1)
          if (s && s.round && s.round.roundNumber >= 1) {
              
              // DEHYDRATE: Convert Runtime Blob URLs -> Persisted IDs
              // For AutoSave, we only save references to keep it light and use local DB
              const dehydratedState = imageStorage.dehydrateState(s);
              
              await storage.setItem(AUTOSAVE_KEY, dehydratedState);
              // console.log(`[AutoSave] Saved to IndexedDB at ${new Date().toLocaleTimeString()}`);
          }
      } catch (e) {
          console.error("Autosave failed:", e);
      }
  };

  // --- LOADING LOGIC ---
  useEffect(() => {
      const loadState = async () => {
          try {
              // Clear legacy localStorage if it exists to free space
              if (localStorage.getItem(AUTOSAVE_KEY)) {
                  console.log("Migrating/Clearing legacy localStorage save...");
                  localStorage.removeItem(AUTOSAVE_KEY);
              }

              // Load from IndexedDB
              const savedRaw = await storage.getItem<GameState>(AUTOSAVE_KEY);
              
              if (savedRaw) {
                  // HYDRATE: Convert Persisted IDs / Legacy Base64 -> Runtime Blob URLs
                  // This also migrates legacy data on the fly
                  const saved = await imageStorage.hydrateState(savedRaw);

                  if (saved && saved.world && saved.map && saved.characters) {
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
                      if (!saved.triggerGroups) saved.triggerGroups = {}; // Migration
                      
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
                      if (saved.round.autoReaction === undefined) saved.round.autoReaction = false; 
                      if (saved.round.isWorldTimeFlowPaused === undefined) saved.round.isWorldTimeFlowPaused = false;
                      
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
                      updateState(() => saved);
                  }
              }
          } catch (e) {
              console.warn("Failed to load autosave from IndexedDB:", e);
          }
      };
      
      loadState();
  }, []);

  // --- STRATEGY 1: INTERVAL (Backup) ---
  useEffect(() => {
      const saveInterval = setInterval(() => {
          persistState();
      }, 30000);
      return () => clearInterval(saveInterval);
  }, []); 

  // --- STRATEGY 2: LIFECYCLE EVENTS (Crucial for Mobile) ---
  useEffect(() => {
      const handleVisChange = () => {
          if (document.hidden) {
              console.log("[Persistence] App hidden, forcing save...");
              persistState();
          }
      };
      
      const handlePageHide = () => {
          persistState();
      };

      document.addEventListener('visibilitychange', handleVisChange);
      window.addEventListener('pagehide', handlePageHide);
      window.addEventListener('beforeunload', handlePageHide);

      let nativeListener: any = null;
      if (Capacitor.isNativePlatform()) {
          App.addListener('appStateChange', (state) => {
              if (!state.isActive) {
                  console.log("[Persistence] Native App paused, forcing save...");
                  persistState();
              }
          }).then(handle => {
              nativeListener = handle;
          });
      }

      return () => {
          document.removeEventListener('visibilitychange', handleVisChange);
          window.removeEventListener('pagehide', handlePageHide);
          window.removeEventListener('beforeunload', handlePageHide);
          if (nativeListener) {
               if (typeof nativeListener.remove === 'function') nativeListener.remove();
          }
      };
  }, []);

  const onSaveClick = () => {
      setSaveLoadModal({ type: 'save', isOpen: true });
  };

  const onLoadClick = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      setSaveLoadModal({ type: 'load', isOpen: true, fileToLoad: file, error: undefined });
      e.target.value = ''; 
  };

  const executeSave = async (
      includeProgress: boolean, 
      includeSettings: boolean, 
      includeModelInterface: boolean, 
      includeGlobalContext: boolean, 
      customFilename?: string,
      expirationDateOverride?: string
  ) => {
      // EXPORT: Fully resolve images to Base64 to make the save file portable
      // This ensures images are not lost when transferring save files or clearing DB
      const s = await imageStorage.exportState(stateRef.current);
      
      const exportData: any = {};
      exportData.timestamp = Date.now();
      
      if (includeProgress) {
          exportData.world = s.world;
          exportData.round = s.round;
          exportData.characters = s.characters;
          exportData.cardPool = s.cardPool;
          exportData.prizePools = s.prizePools;
          exportData.triggers = s.triggers;
          exportData.triggerGroups = s.triggerGroups; // Save Groups
          exportData.debugLogs = []; // Do not save debug logs to file
          exportData.map = s.map;
      }

      if (includeSettings) {
          const settingsToSave = { ...s.appSettings };
          settingsToSave.apiKeys = { 
              [Provider.XAI]: '', 
              [Provider.GEMINI]: '', 
              [Provider.VOLCANO]: '', 
              [Provider.OPENROUTER]: '', 
              [Provider.OPENAI]: '', 
              [Provider.CLAUDE]: '',
              [Provider.CUSTOM]: ''
          };
          settingsToSave.devPassword = "";
          settingsToSave.devOptionsUnlocked = false; 
          delete (settingsToSave as any).themeConfig;
          delete (settingsToSave as any).lockedFeatures;
          
          // Exclude Font Settings from save file
          delete (settingsToSave as any).storyLogFontSize;
          delete (settingsToSave as any).storyLogFontWeight;

          // **FIX: Exclude customEndpoints from General Settings**
          // They belong to Model Interface now
          delete (settingsToSave as any).customEndpoints;

          if (expirationDateOverride !== undefined) {
              settingsToSave.saveExpirationDate = expirationDateOverride;
          }

          exportData.appSettings = settingsToSave;
          exportData.defaultSettings = s.defaultSettings;
          exportData.devMode = s.devMode;
      }

      if (includeModelInterface) {
          if (!exportData.appSettings) exportData.appSettings = {};
          exportData.appSettings.apiKeys = s.appSettings.apiKeys;
          
          // **FIX: Include customEndpoints here**
          exportData.appSettings.customEndpoints = s.appSettings.customEndpoints;

          exportData.judgeConfig = s.judgeConfig;
          exportData.charGenConfig = s.charGenConfig; 
          exportData.charBehaviorConfig = s.charBehaviorConfig; 
      }

      if (includeModelInterface || includeGlobalContext) {
          if (!exportData.appSettings) exportData.appSettings = {};
          exportData.appSettings.devPassword = s.appSettings.devPassword;
          exportData.appSettings.encryptSaveFiles = s.appSettings.encryptSaveFiles;
          exportData.appSettings.saveExpirationDate = s.appSettings.saveExpirationDate;
          exportData.appSettings.lockedFeatures = s.appSettings.lockedFeatures;
      }

      if (includeGlobalContext) {
          exportData.globalContext = s.globalContext;
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

      if (Capacitor.isNativePlatform()) {
          try {
              const safeName = `${filename}.json`;
              const targetDir = Directory.Documents;
              const targetFolder = 'Huahai Aetheria';

              try {
                  await Filesystem.mkdir({
                      path: targetFolder,
                      directory: targetDir,
                      recursive: true
                  });
              } catch (e) {
                  // Ignore
              }

              await Filesystem.writeFile({
                  path: `${targetFolder}/${safeName}`,
                  data: dataStr,
                  directory: targetDir,
                  encoding: Encoding.UTF8
              });

              addLog(`系统: 游戏已保存至设备 (Documents/${targetFolder}/${safeName})`);
              alert(`保存成功！\n位置: 内部存储/Documents/${targetFolder}/${safeName}`);
              setSaveLoadModal({ ...saveLoadModal, isOpen: false });
              return; 
          } catch (e: any) {
              console.error("Native save failed, falling back to browser download:", e);
              addLog(`系统: 原生保存失败 (${e.message})，尝试浏览器下载...`);
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

  const executeLoad = async (
      includeProgress: boolean,
      includeSettings: boolean,
      includeModelInterface: boolean,
      includeGlobalContext: boolean,
      data: any
  ) => {
      if (!data) return;

      const newState: GameState = { ...stateRef.current };

      if (includeProgress) {
          // Hydrate the incoming data first
          // This will extract base64 images from JSON, save to DB, and return Blob URLs
          const hydratedData = await imageStorage.hydrateState(data);

          if (hydratedData.world) newState.world = hydratedData.world;
          if (hydratedData.round) newState.round = hydratedData.round;
          if (hydratedData.characters) newState.characters = hydratedData.characters;
          if (hydratedData.cardPool) newState.cardPool = hydratedData.cardPool;
          if (hydratedData.prizePools) newState.prizePools = hydratedData.prizePools;
          if (hydratedData.triggers) newState.triggers = hydratedData.triggers;
          if (hydratedData.triggerGroups) newState.triggerGroups = hydratedData.triggerGroups; // Load Groups
          if (hydratedData.map) newState.map = hydratedData.map;
          
          if (!newState.prizePools) newState.prizePools = createInitialGameState().prizePools;
          if (!newState.triggers) newState.triggers = {};
          if (!newState.triggerGroups) newState.triggerGroups = {}; // Fallback
      }

      if (includeSettings) {
          if (data.appSettings) {
              const loadedSettings = { ...data.appSettings };
              
              if (!includeModelInterface) {
                  // If we are NOT loading Model Interface, we should keep current keys AND endpoints
                  loadedSettings.apiKeys = newState.appSettings.apiKeys;
                  // **FIX: Explicitly remove customEndpoints from settings load to prevent overwriting existing ones with old data if Model Interface is unchecked**
                  delete loadedSettings.customEndpoints; 
              }
              
              loadedSettings.themeConfig = newState.appSettings.themeConfig;
              
              // Preserve Font Settings from local state
              loadedSettings.storyLogFontSize = newState.appSettings.storyLogFontSize;
              loadedSettings.storyLogFontWeight = newState.appSettings.storyLogFontWeight;
              
              newState.appSettings = { ...newState.appSettings, ...loadedSettings };
              
              if (data.defaultSettings) newState.defaultSettings = data.defaultSettings;
              if (data.devMode !== undefined) newState.devMode = data.devMode;
          }
      }

      if (includeModelInterface) {
          if (data.appSettings && data.appSettings.apiKeys) {
               newState.appSettings = { ...newState.appSettings, apiKeys: data.appSettings.apiKeys };
          }

          // **FIX: Load customEndpoints here**
          if (data.appSettings && data.appSettings.customEndpoints) {
              newState.appSettings = { 
                  ...newState.appSettings, 
                  customEndpoints: data.appSettings.customEndpoints 
              };
          }

          if (data.judgeConfig) newState.judgeConfig = data.judgeConfig;
          if (data.charGenConfig) newState.charGenConfig = data.charGenConfig;
          if (data.charBehaviorConfig) newState.charBehaviorConfig = data.charBehaviorConfig;
          
          if (data.appSettings && data.appSettings.devPassword) {
              newState.appSettings.devPassword = data.appSettings.devPassword;
          }
      }

      if (includeGlobalContext) {
          if (data.globalContext) newState.globalContext = data.globalContext;
      }

      if (!newState.charGenConfig && newState.judgeConfig) newState.charGenConfig = newState.judgeConfig;
      if (!newState.charBehaviorConfig && newState.judgeConfig) newState.charBehaviorConfig = newState.judgeConfig;

      // Force autosave immediately via IndexedDB (will dehydrate automatically)
      persistState().catch(console.error);
      
      updateState(() => newState);
      addLog("系统: 存档加载成功。");
      setSaveLoadModal({ ...saveLoadModal, isOpen: false });
  };

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

                  const promptUser = (msg: string, expectedPwd?: string) => {
                      return new Promise<string | null>((resolvePrompt) => {
                          setPasswordChallenge({
                              isOpen: true,
                              message: msg,
                              expectedPassword: expectedPwd, 
                              resolve: (val: string | null) => resolvePrompt(val)
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
                                  const pwd = await promptUser(`${msg}\n\n请输入开发者密码以继续加载 (Enter Developer Password to Override):`, savedPwd);
                                  
                                  if (pwd === null) {
                                      throw new Error("UserCancelled");
                                  }
                                  if (pwd !== savedPwd) {
                                      throw new Error("存档已过期且密码验证失败 (Expired & Invalid Password).");
                                  } else {
                                      addLog("系统: 开发者密码验证通过，强制加载过期存档。");
                                  }
                              } else {
                                  addLog("系统: 存档时效性验证通过。");
                              }
                          } catch (e: any) {
                              if (e.message === "UserCancelled") {
                                  throw e; 
                              }
                              if (e.message.includes("Expired & Invalid Password")) {
                                  throw e;
                              }

                              const pwd = await promptUser(`${e.message}\n\n无法验证时间。如果您是开发者，请输入密码以跳过验证:`, savedPwd);
                              if (pwd === null) {
                                  throw new Error("UserCancelled");
                              }
                              if (pwd !== savedPwd) {
                                  throw new Error(`安全验证阻止了加载:\n${e.message}`);
                              } else {
                                  addLog("系统: 开发者密码验证通过，跳过网络时间检查。");
                              }
                          }
                      }
                  }
                  resolve(json);

              } catch (e: any) {
                  reject(e);
              }
          };
          reader.readAsText(file);
      });
  };

  const importCharacters = async (charsToImport: Character[], sourceHistory: LogEntry[] = [], keepMemory: boolean = false, memoryRounds: number = 20, sourceCardPool: Card[] = []) => {
      
      // Hydrate imported characters before merging (in case they have ID references)
      const hydratedChars = await imageStorage.hydrateState(charsToImport);
      const hydratedHistory = await imageStorage.hydrateState(sourceHistory);
      const hydratedCardPool = await imageStorage.hydrateState(sourceCardPool);

      updateState(prev => {
          const newChars = { ...prev.characters };
          const newPositions = { ...prev.map.charPositions };
          const activeLocId = prev.map.activeLocationId || 'loc_start_0_0';
          const targetLoc = prev.map.locations[activeLocId];
          
          const usedCharIds = new Set(Object.keys(newChars));
          const usedCardIds = new Set(prev.cardPool.map(c => c.id));
          
          const newPoolCards: Card[] = [];

          hydratedChars.forEach((char: Character) => {
              const oldId = char.id;
              
              const newId = generateCharacterId(usedCharIds);
              usedCharIds.add(newId);
              
              const newChar = JSON.parse(JSON.stringify(char));
              newChar.id = newId;

              if (newChar.conflicts) {
                  newChar.conflicts.forEach((c: any) => c.solved = false);
              }

              if (newChar.skills) {
                  newChar.skills = newChar.skills.map((skill: Card) => {
                       const newSkillId = generateCardId(usedCardIds);
                       usedCardIds.add(newSkillId);
                       return { ...skill, id: newSkillId };
                  });
              }

              if (!keepMemory) {
                  newChar.useAiOverride = false;
                  newChar.aiConfig = undefined;
                  newChar.contextConfig = { messages: [] };
                  newChar.lifeTrajectory = { past: "", current: "", future: "" };
                  newChar.mailHistory = [];
                  newChar.secrets = [];
                  newChar.conflicts = []; 
                  newChar.drives = []; 
                  newChar.previousLifeLogs = [];
                  
                  newChar.memoryConfig = {
                      useOverride: false,
                      maxMemoryRounds: 10,
                      actionDropoutProbability: 0.34,
                      reactionDropoutProbability: 0.34
                  };

                  newChar.inventory = [];

                  newChar.attributes = {
                       '创造点': { id: '创造点', name: '创造点', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                       '健康': { id: '健康', name: '健康', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                       '体能': { id: '体能', name: '体能', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                       '活跃': { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                       '快感': { id: '快感', name: '快感', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                       '状态': { id: '状态', name: '状态', type: AttributeType.TEXT, value: '正常', visibility: AttributeVisibility.PUBLIC },
                  };
                  
              } else {
                  if (newChar.inventory && hydratedCardPool.length > 0) {
                      const newInventory: string[] = [];
                      newChar.inventory.forEach((oldItemId: string) => {
                          const originalCard = hydratedCardPool.find((c: Card) => c.id === oldItemId);
                          if (originalCard) {
                               const newItemId = generateCardId(usedCardIds);
                               usedCardIds.add(newItemId);
                               
                               const newCard = { ...originalCard, id: newItemId };
                               newPoolCards.push(newCard); 
                               newInventory.push(newItemId);
                          } else {
                              const existingInCurrent = prev.cardPool.find(c => c.id === oldItemId);
                              if (existingInCurrent) {
                                  const newItemId = generateCardId(usedCardIds);
                                  usedCardIds.add(newItemId);
                                  const newCard = { ...existingInCurrent, id: newItemId };
                                  newPoolCards.push(newCard);
                                  newInventory.push(newItemId);
                              }
                          }
                      });
                      newChar.inventory = newInventory;
                  } else if (newChar.inventory) {
                      newChar.inventory = [];
                  }

                  if (hydratedHistory.length > 0) {
                      const extractedHistory = extractCharacterHistory(hydratedHistory, oldId);
                      let combinedLogs = [...(newChar.previousLifeLogs || []), ...extractedHistory];
                      
                      let maxRound = 0;
                      combinedLogs.forEach(l => {
                          if (l.round > maxRound) maxRound = l.round;
                      });

                      combinedLogs = combinedLogs.map(log => ({
                          ...log,
                          round: log.round - maxRound,
                      }));

                      newChar.previousLifeLogs = combinedLogs;
                  }
              }

              newChars[newId] = newChar;
              
              newPositions[newId] = {
                  x: targetLoc ? targetLoc.coordinates.x : 0,
                  y: targetLoc ? targetLoc.coordinates.y : 0,
                  locationId: activeLocId
              };
          });

          let newOrder = prev.round.currentOrder;
          Object.keys(newChars).forEach(id => {
              if (!prev.characters[id] && !newOrder.includes(id)) {
                  newOrder = [...newOrder, id];
              }
          });

          return {
              ...prev,
              characters: newChars,
              map: { ...prev.map, charPositions: newPositions },
              round: { ...prev.round, currentOrder: newOrder },
              cardPool: [...prev.cardPool, ...newPoolCards] 
          };
      });
      
      if (keepMemory) {
          addLog(`系统: 已导入 ${charsToImport.length} 名角色及其完整前世记忆 (新身份ID及物品ID已生成)。`);
      } else {
          addLog(`系统: 已导入 ${charsToImport.length} 名角色 (已重置为初始状态)。`);
      }
      
      persistState();
      
      setSaveLoadModal({ ...saveLoadModal, isOpen: false });
  };

  const resetGame = async () => {
      forceClearReactionRequest(); 
      // Clear both storages to be safe
      localStorage.removeItem(AUTOSAVE_KEY);
      await storage.removeItem(AUTOSAVE_KEY);
      
      // Cleanup image storage cache and store
      imageStorage.cleanup();
      // Optionally clear image store (commented out to preserve images between hard resets if desired, but for full wipe should be cleared)
      // await localforage.createInstance({ name: 'AetheriaEngine', storeName: 'image_blobs' }).clear(); 

      const currentThemeConfig = stateRef.current.appSettings.themeConfig;
      // Preserve Font Settings
      const currentFontSize = stateRef.current.appSettings.storyLogFontSize;
      const currentFontWeight = stateRef.current.appSettings.storyLogFontWeight;

      const freshState = createInitialGameState();
      
      const newState: GameState = {
          ...freshState,
          appSettings: {
              ...freshState.appSettings,
              themeConfig: currentThemeConfig,
              storyLogFontSize: currentFontSize,
              storyLogFontWeight: currentFontWeight
          },
          world: {
             ...freshState.world,
             history: [
                 {
                     id: `log_reset_${Date.now()}`,
                     round: 1, 
                     turnIndex: 0, 
                     content: "系统: 游戏已完全重置 (Factory Reset)。所有设定（包括 API Key）已恢复默认。", 
                     timestamp: Date.now(), 
                     type: 'system',
                     snapshot: freshState.round
                 },
                 {
                     id: `log_init_done_${Date.now()}`,
                     round: 1,
                     turnIndex: 0,
                     content: "系统: 初始化完成。",
                     timestamp: Date.now() + 1,
                     type: 'system',
                     snapshot: freshState.round
                 }
             ]
          }
      };

      try {
          // Dehydrate fresh state (mostly empty but good practice)
          // For AutoSave, we use dehydrateState (ID based)
          const dehydrated = imageStorage.dehydrateState(newState);
          await storage.setItem(AUTOSAVE_KEY, dehydrated);
      } catch (e) {
          console.error("Force autosave failed during reset:", e);
      }

      updateState(() => newState);
      // addLog("系统: 初始化完成。"); // Removed to prevent state clobbering race condition
  };

  return {
      onSaveClick,
      onLoadClick,
      executeSave,
      executeLoad,
      parseAndValidateSave,
      importCharacters,
      resetGame
  };
};
