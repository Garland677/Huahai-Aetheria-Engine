
import React, { useState, useEffect } from 'react';
import { useGame } from './hooks/useGame';
import { useEngine } from './hooks/useEngine';
import { TopBar } from './components/Layout/TopBar';
import { LeftPanel } from './components/Layout/LeftPanel';
import { StoryLog } from './components/Layout/StoryLog';
import { PlayerControls } from './components/Layout/PlayerControls';
import { RightPanel } from './components/Layout/RightPanel';
import { WindowManager } from './components/Layout/WindowManager';
import { Button, Label, Input, TextArea } from './components/ui/Button';
import { Download, Upload, CheckSquare, Square, Key, ListOrdered, ArrowUp, ArrowDown, GripVertical, FileText, Lock, AlertTriangle, Plus, Trash2, X, Clock, UserPlus, Users, BrainCircuit, MessageSquare } from 'lucide-react';
import { Character, LogEntry, GameState } from './types';
import { decryptData } from './services/cryptoService';

// Internal Password Modal Component
const PasswordChallengeModal: React.FC<{ 
    message: string, 
    onConfirm: (pwd: string) => void, 
    onCancel: () => void 
}> = ({ message, onConfirm, onCancel }) => {
    const [input, setInput] = useState("");
    return (
        <div className="fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-slate-900 border border-red-500/50 rounded-lg p-6 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-300">
                <h3 className="text-lg font-bold text-red-400 mb-4 flex items-center gap-2">
                    <Lock size={20}/> 安全验证 (Security Check)
                </h3>
                <div className="text-slate-300 text-sm mb-6 whitespace-pre-wrap leading-relaxed bg-black/40 p-4 rounded border border-slate-800 font-mono">
                    {message}
                </div>
                
                <Label>开发者密码 (Developer Password)</Label>
                <Input 
                    type="password" 
                    autoFocus
                    placeholder="请输入密码..."
                    className="mb-6 border-red-900/50 focus:border-red-500"
                    value={input}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                    onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === 'Enter') onConfirm(input);
                    }}
                />
                
                <div className="flex justify-end gap-3">
                    <Button variant="secondary" onClick={onCancel}>取消 (Cancel)</Button>
                    <Button onClick={() => onConfirm(input)} className="bg-red-600 hover:bg-red-500 text-white border-transparent">
                        验证 (Verify)
                    </Button>
                </div>
            </div>
        </div>
    );
};

// Internal Reaction Request Modal
const ReactionRequestModal: React.FC<{
    title: string;
    message: string;
    charName: string;
    onConfirm: (text: string) => void;
}> = ({ title, message, charName, onConfirm }) => {
    const [input, setInput] = useState("");
    return (
        <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-slate-900 border border-indigo-500/50 rounded-lg p-6 max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-300 flex flex-col max-h-[80vh]">
                <h3 className="text-lg font-bold text-indigo-400 mb-2 flex items-center gap-2">
                    <MessageSquare size={20}/> {title}
                </h3>
                <p className="text-xs text-slate-500 mb-4">角色: <span className="font-bold text-white">{charName}</span></p>
                
                <div className="text-slate-300 text-sm mb-4 whitespace-pre-wrap leading-relaxed bg-slate-950 p-4 rounded border border-slate-800 overflow-y-auto max-h-40">
                    {message}
                </div>
                
                <Label>你的反应 (Your Reaction)</Label>
                <TextArea 
                    autoFocus
                    placeholder="输入你的台词或行动描述..."
                    className="mb-6 border-indigo-500/50 focus:border-indigo-500 h-32 resize-none"
                    value={input}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
                />
                
                <div className="flex justify-end gap-3 mt-auto">
                    <Button onClick={() => onConfirm(input)} disabled={!input.trim()}>
                        提交反应 (Submit)
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default function App() {
  const game = useGame();
  const engine = useEngine({
    state: game.state,
    stateRef: game.stateRef,
    updateState: game.updateState,
    addLog: game.addLog,
    addDebugLog: game.addDebugLog,
    requestPlayerReaction: game.requestPlayerReaction
  });

  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  
  // Mobile/Responsive View State
  const [mobileView, setMobileView] = useState<'story' | 'map' | 'char'>('story');

  // Local state for Save/Load checkboxes
  const [saveLoadModalData, setSaveLoadModalData] = useState({ progress: true, settings: true, apiKeys: false });
  
  // Import Mode State
  const [isImportMode, setIsImportMode] = useState(false);
  const [parsedImportChars, setParsedImportChars] = useState<Character[]>([]);
  const [parsedImportHistory, setParsedImportHistory] = useState<LogEntry[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  // Import Settings
  const [importSettings, setImportSettings] = useState({ keepMemory: false, memoryRounds: 20 });
  
  // Local state for Filename Input (Save only)
  const [saveFilename, setSaveFilename] = useState("");
  
  // Manual Order state
  const [manualOrderList, setManualOrderList] = useState<string[]>([]);
  const [charToAdd, setCharToAdd] = useState("");

  // Listen for RightPanel Toggle & Shop Open
  useEffect(() => {
      const manualHandler = (e: any) => {
          game.updateState((s: GameState) => ({ ...s, round: { ...s.round, useManualTurnOrder: e.detail } }));
      };
      
      const shopHandler = (e: any) => {
          // e.detail contains charId
          if (e.detail && e.detail.charId) {
              // Temporarily set selected char to ensure shop knows who is buying
              engine.setSelectedCharId(e.detail.charId);
              game.openWindow('shop');
          }
      };

      window.addEventListener('update_manual_order', manualHandler);
      window.addEventListener('open_shop_window', shopHandler);
      return () => {
          window.removeEventListener('update_manual_order', manualHandler);
          window.removeEventListener('open_shop_window', shopHandler);
      };
  }, []);

  // Sync Manual List when modal opens
  useEffect(() => {
      if (game.state.round.isWaitingForManualOrder) {
          // Fetch current location characters
          const locId = game.state.map.activeLocationId;
          const locChars = (Object.values(game.state.characters) as Character[]).filter(c => {
              const pos = game.state.map.charPositions[c.id];
              return pos && pos.locationId === locId;
          }).map(c => c.id);
          
          // Sort: Non-Environment first, then Environment at the end
          const envChars = locChars.filter(id => id.startsWith('env_'));
          const nonEnv = locChars.filter(id => !id.startsWith('env_'));
          
          setManualOrderList([...nonEnv, ...envChars]);
      }
  }, [game.state.round.isWaitingForManualOrder]);

  // Generate default filename when Save Modal opens
  useEffect(() => {
      if (game.saveLoadModal.isOpen && game.saveLoadModal.type === 'save') {
          const date = new Date();
          const timeStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const s = game.state;
          const activeLoc = s.map.activeLocationId ? s.map.locations[s.map.activeLocationId] : null;
          const regionName = activeLoc?.regionId && s.map.regions[activeLoc.regionId] ? s.map.regions[activeLoc.regionId].name : "UnknownRegion";
          const locName = activeLoc ? activeLoc.name : "UnknownLoc";
          setSaveFilename(`${timeStr}_${regionName}_${locName}`);
      }
      
      // Reset Import Mode on Open
      if (game.saveLoadModal.isOpen) {
          setIsImportMode(false);
          setParsedImportChars([]);
          setParsedImportHistory([]);
          setSelectedImportIds(new Set());
          setImportSettings({ keepMemory: false, memoryRounds: 20 }); // Reset settings
      }
  }, [game.saveLoadModal.isOpen, game.saveLoadModal.type]);

  // Effect to parse AND VALIDATE file when Import Mode is active or File changes
  useEffect(() => {
      if (game.saveLoadModal.isOpen && game.saveLoadModal.type === 'load' && game.saveLoadModal.fileToLoad) {
          // Use the shared secure parsing function from useGame
          // This handles decryption, expiration checking, and password prompting automatically
          game.parseAndValidateSave(game.saveLoadModal.fileToLoad)
              .then((json: any) => {
                  if (json) {
                      if (json.characters) {
                          const chars = Object.values(json.characters) as Character[];
                          setParsedImportChars(chars);
                      } else {
                          setParsedImportChars([]);
                      }
                      // Capture History for memory import
                      if (json.world && json.world.history) {
                          setParsedImportHistory(json.world.history);
                      } else {
                          setParsedImportHistory([]);
                      }
                  }
              })
              .catch((e: any) => {
                  console.error("Secure load failed", e);
                  setParsedImportChars([]);
                  setParsedImportHistory([]);
                  // Update the modal error state to show the user why it failed
                  game.setSaveLoadModal((prev: any) => ({ 
                      ...prev, 
                      error: e.message || "文件解析或安全验证失败。" 
                  }));
              });
      }
  }, [game.saveLoadModal.isOpen, game.saveLoadModal.fileToLoad, game.saveLoadModal.type]);

  const restartGame = () => {
      setConfirmModal({
          title: "重置游戏 (Factory Reset)",
          message: "警告：这将完全清空当前游戏的所有进度，删除自动存档，并恢复到【系统初始设置】。所有的自定义设置和 **API Key** 都将丢失。此操作不可撤销。",
          onConfirm: () => {
              game.resetGame();
          }
      });
  };

  const handleTogglePause = () => {
      game.updateState((s: GameState) => ({...s, round: {...s.round, isPaused: !s.round.isPaused}}));
  };

  const handleSaveLoadConfirm = () => {
      if (game.saveLoadModal.type === 'save') {
          game.executeSave(
              saveLoadModalData.progress, 
              saveLoadModalData.settings, 
              saveLoadModalData.apiKeys, 
              saveFilename
          );
      } else {
          if (isImportMode) {
              const selectedChars = parsedImportChars.filter(c => selectedImportIds.has(c.id));
              if (selectedChars.length > 0) {
                  // Pass new memory options
                  game.importCharacters(
                      selectedChars, 
                      parsedImportHistory, 
                      importSettings.keepMemory, 
                      importSettings.memoryRounds
                  );
              } else {
                  alert("请先选择至少一个角色。");
              }
          } else {
              game.executeLoad(saveLoadModalData.progress, saveLoadModalData.settings, saveLoadModalData.apiKeys);
          }
      }
  };

  const toggleImportSelection = (id: string) => {
      const newSet = new Set(selectedImportIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedImportIds(newSet);
  };

  const selectAllImport = () => {
      if (selectedImportIds.size === parsedImportChars.length) {
          setSelectedImportIds(new Set());
      } else {
          setSelectedImportIds(new Set(parsedImportChars.map(c => c.id)));
      }
  };

  // Manual Order Handlers
  const moveOrderItem = (index: number, direction: -1 | 1) => {
      const newList = [...manualOrderList];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= newList.length) return;
      const temp = newList[index];
      newList[index] = newList[targetIndex];
      newList[targetIndex] = temp;
      setManualOrderList(newList);
  };

  const removeOrderItem = (index: number) => {
      const newList = [...manualOrderList];
      newList.splice(index, 1);
      setManualOrderList(newList);
  };

  const cancelManualOrder = () => {
      game.updateState((s: GameState) => ({
          ...s,
          round: {
              ...s.round,
              isWaitingForManualOrder: false,
              isPaused: true
          }
      }));
  };

  const confirmManualOrder = () => {
      game.updateState((s: GameState) => ({
          ...s,
          round: {
              ...s.round,
              currentOrder: manualOrderList,
              defaultOrder: manualOrderList, // Update default too for consistency
              isWaitingForManualOrder: false,
              phase: 'turn_start',
              turnIndex: 0
          }
      }));
      game.addLog(`系统: 手动设定轮次顺序: [${manualOrderList.map(id => game.state.characters[id]?.name || id).join(', ')}]`);
  };

  // Get available characters for manual add
  const availableChars = (Object.values(game.state.characters) as Character[]).filter(c => {
      const pos = game.state.map.charPositions[c.id];
      return pos && pos.locationId === game.state.map.activeLocationId;
  });

  return (
    <div className="w-full h-screen flex flex-col bg-gray-950 text-slate-200 relative font-sans select-none overflow-hidden">
      
      {/* Confirmation Modal */}
      {confirmModal && (
          <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center">
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                  <h3 className="text-lg font-bold text-white mb-2">{confirmModal.title}</h3>
                  <p className="text-slate-400 mb-6 text-sm leading-relaxed">{confirmModal.message}</p>
                  <div className="flex justify-end gap-3">
                      <Button variant="secondary" onClick={() => setConfirmModal(null)}>取消</Button>
                      <Button variant="danger" onClick={() => {
                          confirmModal.onConfirm();
                          setConfirmModal(null);
                      }}>确定</Button>
                  </div>
              </div>
          </div>
      )}

      {/* Password Challenge Modal */}
      {game.passwordChallenge && (
          <PasswordChallengeModal 
              message={game.passwordChallenge.message}
              onConfirm={(pwd) => game.respondToPasswordChallenge(pwd)}
              onCancel={() => game.respondToPasswordChallenge(null)}
          />
      )}

      {/* Reaction Request Modal */}
      {game.reactionRequest && (
          <ReactionRequestModal
              title={game.reactionRequest.title}
              message={game.reactionRequest.message}
              charName={game.state.characters[game.reactionRequest.charId]?.name || "Unknown"}
              onConfirm={(text) => game.respondToReactionRequest(text)}
          />
      )}

      {/* Manual Order Modal */}
      {game.state.round.isWaitingForManualOrder && (
          <div className="fixed inset-0 bg-slate-950/90 z-[150] flex items-center justify-center">
              <div className="bg-slate-900 border border-indigo-500/50 rounded-lg p-6 max-w-md w-full shadow-2xl flex flex-col max-h-[80vh]">
                  <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-indigo-400 font-bold text-lg">
                          <ListOrdered size={20}/> 手动轮次判定
                      </div>
                      <button onClick={cancelManualOrder} className="text-slate-500 hover:text-white"><X size={20}/></button>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">请调整本轮角色的行动顺序。您可以增加或删除任意角色（包括重复）。</p>
                  
                  <div className="flex-1 overflow-y-auto space-y-2 pr-2 mb-4 bg-slate-900/50 p-2 rounded border border-slate-800">
                      {manualOrderList.map((id, idx) => {
                          const char = game.state.characters[id];
                          if (!char) return null;
                          return (
                              <div key={`${id}_${idx}`} className="flex items-center bg-slate-900 p-2 rounded border border-slate-800 gap-2">
                                  <span className="text-slate-500 font-mono w-6 text-center text-xs">{idx + 1}</span>
                                  <div className="flex-1 font-bold text-slate-200 text-sm truncate">{char.name}</div>
                                  <div className="flex gap-1 shrink-0">
                                      <button onClick={() => moveOrderItem(idx, -1)} disabled={idx === 0} className="p-1 hover:bg-slate-700 rounded text-slate-400 disabled:opacity-20"><ArrowUp size={14}/></button>
                                      <button onClick={() => moveOrderItem(idx, 1)} disabled={idx === manualOrderList.length - 1} className="p-1 hover:bg-slate-700 rounded text-slate-400 disabled:opacity-20"><ArrowDown size={14}/></button>
                                      <button onClick={() => removeOrderItem(idx)} className="p-1 hover:bg-red-900/50 rounded text-slate-500 hover:text-red-400"><Trash2 size={14}/></button>
                                  </div>
                              </div>
                          )
                      })}
                  </div>

                  {/* Add Character Section */}
                  <div className="flex gap-2 mb-4 border-t border-slate-800 pt-4">
                      <select 
                          className="flex-1 bg-gray-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                          value={charToAdd}
                          onChange={(e) => setCharToAdd(e.target.value)}
                      >
                          <option value="">-- 选择角色添加 --</option>
                          {availableChars.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                      </select>
                      <Button 
                          size="sm" 
                          disabled={!charToAdd}
                          onClick={() => {
                              if (charToAdd) {
                                  setManualOrderList([...manualOrderList, charToAdd]);
                                  setCharToAdd("");
                              }
                          }}
                      >
                          <Plus size={14}/> 添加
                      </Button>
                  </div>
                  
                  <div className="flex gap-3">
                      <Button variant="secondary" onClick={cancelManualOrder} className="flex-1">取消/暂停</Button>
                      <Button onClick={confirmManualOrder} className="flex-1">确认并开始</Button>
                  </div>
              </div>
          </div>
      )}

      {/* Save/Load Selection Modal */}
      {game.saveLoadModal.isOpen && (
          <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center">
              <div className={`bg-slate-900 border border-slate-700 rounded-lg p-6 w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col ${isImportMode ? 'max-w-2xl max-h-[85vh]' : 'max-w-md'}`}>
                  <div className="flex justify-between items-start mb-4">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          {game.saveLoadModal.type === 'save' ? <Download size={20}/> : <Upload size={20}/>}
                          {game.saveLoadModal.type === 'save' ? "保存游戏 (Save Game)" : "加载数据 (Load Data)"}
                      </h3>
                      {game.saveLoadModal.type === 'load' && game.saveLoadModal.fileToLoad && (
                          <div className="flex bg-slate-800 rounded p-0.5 text-xs">
                              <button 
                                  onClick={() => setIsImportMode(false)}
                                  className={`px-3 py-1 rounded ${!isImportMode ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                              >
                                  完整加载
                              </button>
                              <button 
                                  onClick={() => setIsImportMode(true)}
                                  className={`px-3 py-1 rounded flex items-center gap-1 ${isImportMode ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'}`}
                              >
                                  <UserPlus size={12}/> 导入角色
                              </button>
                          </div>
                      )}
                  </div>
                  
                  {/* ERROR MESSAGE DISPLAY */}
                  {game.saveLoadModal.error && (
                      <div className="mb-4 bg-red-900/50 border border-red-500/50 text-red-200 p-3 rounded text-xs whitespace-pre-wrap leading-relaxed">
                          <div className="font-bold flex items-center gap-2 mb-1 text-red-400">
                              <AlertTriangle size={14}/> 错误 (Error)
                          </div>
                          {game.saveLoadModal.error}
                      </div>
                  )}
                  
                  {game.saveLoadModal.type === 'save' && (
                      <div className="mb-6">
                          <Label className="mb-2 block">文件名 (Filename)</Label>
                          <div className="flex items-center gap-2 mb-4">
                              <Input 
                                  value={saveFilename} 
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSaveFilename(e.target.value)} 
                                  className="flex-1"
                                  placeholder="Enter filename..."
                              />
                              <span className="text-slate-500 text-sm font-mono">.json</span>
                          </div>

                          <div className="space-y-4 mb-6">
                              <div 
                                className={`flex items-center p-3 rounded border cursor-pointer transition-colors ${saveLoadModalData.progress ? 'bg-indigo-900/30 border-indigo-500' : 'bg-slate-950 border-slate-800'}`}
                                onClick={() => setSaveLoadModalData(p => ({ ...p, progress: !p.progress }))}
                              >
                                  {saveLoadModalData.progress ? <CheckSquare className="text-indigo-400 mr-3"/> : <Square className="text-slate-500 mr-3"/>}
                                  <div>
                                      <div className="font-bold text-sm text-slate-200">游戏进度 (Game Progress)</div>
                                      <div className="text-xs text-slate-500">包含角色、世界、地图、背包等当前状态。</div>
                                  </div>
                              </div>

                              <div 
                                className={`flex items-center p-3 rounded border cursor-pointer transition-colors ${saveLoadModalData.settings ? 'bg-indigo-900/30 border-indigo-500' : 'bg-slate-950 border-slate-800'}`}
                                onClick={() => setSaveLoadModalData(p => ({ ...p, settings: !p.settings }))}
                              >
                                  {saveLoadModalData.settings ? <CheckSquare className="text-indigo-400 mr-3"/> : <Square className="text-slate-500 mr-3"/>}
                                  <div>
                                      <div className="font-bold text-sm text-slate-200">全局设置 (Global Settings)</div>
                                      <div className="text-xs text-slate-500">包含AI模型配置、Prompt模版和默认值。</div>
                                  </div>
                              </div>

                              <div 
                                className={`flex items-center p-3 rounded border cursor-pointer transition-colors ${saveLoadModalData.apiKeys ? 'bg-red-900/20 border-red-500/50' : 'bg-slate-950 border-slate-800'}`}
                                onClick={() => setSaveLoadModalData(p => ({ ...p, apiKeys: !p.apiKeys }))}
                              >
                                  {saveLoadModalData.apiKeys ? <CheckSquare className="text-red-400 mr-3"/> : <Square className="text-slate-500 mr-3"/>}
                                  <div className="flex items-start gap-2">
                                      <Key size={16} className="mt-1 text-slate-400"/>
                                      <div>
                                          <div className="font-bold text-sm text-slate-200">API 密钥 (API Keys)</div>
                                          <div className="text-xs text-slate-500">包含您输入的API Key。请谨慎勾选，避免泄露。</div>
                                      </div>
                                  </div>
                              </div>
                          </div>

                          {/* Expiration setting removed for security reasons. Use Settings window to set global expiration. */}

                          {game.state.appSettings.encryptSaveFiles && (
                              <div className="text-xs text-teal-400 flex items-center gap-1 bg-teal-900/20 p-2 rounded border border-teal-900/50">
                                  <Lock size={12}/> 
                                  <span>加密已启用。文件名即密钥，请务必牢记文件名！</span>
                              </div>
                          )}
                      </div>
                  )}

                  {/* LOAD MODE CONTENT */}
                  {game.saveLoadModal.type === 'load' && (
                      <>
                          {game.saveLoadModal.fileToLoad && (
                              <div className="mb-4 bg-slate-950 p-3 rounded border border-slate-800 flex justify-between items-center">
                                  <div className="flex items-center gap-2 text-sm text-slate-300 overflow-hidden">
                                      <FileText size={16} className="shrink-0"/>
                                      <span className="font-mono truncate">{game.saveLoadModal.fileToLoad.name}</span>
                                  </div>
                              </div>
                          )}

                          {/* Regular Full Load Options */}
                          {!isImportMode && (
                              <div className="space-y-4 mb-6">
                                  <div 
                                    className={`flex items-center p-3 rounded border cursor-pointer transition-colors ${saveLoadModalData.progress ? 'bg-indigo-900/30 border-indigo-500' : 'bg-slate-950 border-slate-800'}`}
                                    onClick={() => setSaveLoadModalData(p => ({ ...p, progress: !p.progress }))}
                                  >
                                      {saveLoadModalData.progress ? <CheckSquare className="text-indigo-400 mr-3"/> : <Square className="text-slate-500 mr-3"/>}
                                      <div>
                                          <div className="font-bold text-sm text-slate-200">游戏进度 (Game Progress)</div>
                                          <div className="text-xs text-slate-500">包含角色、世界、地图、背包等当前状态。</div>
                                      </div>
                                  </div>

                                  <div 
                                    className={`flex items-center p-3 rounded border cursor-pointer transition-colors ${saveLoadModalData.settings ? 'bg-indigo-900/30 border-indigo-500' : 'bg-slate-950 border-slate-800'}`}
                                    onClick={() => setSaveLoadModalData(p => ({ ...p, settings: !p.settings }))}
                                  >
                                      {saveLoadModalData.settings ? <CheckSquare className="text-indigo-400 mr-3"/> : <Square className="text-slate-500 mr-3"/>}
                                      <div>
                                          <div className="font-bold text-sm text-slate-200">全局设置 (Global Settings)</div>
                                          <div className="text-xs text-slate-500">包含AI模型配置、Prompt模版和默认值。</div>
                                      </div>
                                  </div>

                                  <div 
                                    className={`flex items-center p-3 rounded border cursor-pointer transition-colors ${saveLoadModalData.apiKeys ? 'bg-red-900/20 border-red-500/50' : 'bg-slate-950 border-slate-800'}`}
                                    onClick={() => setSaveLoadModalData(p => ({ ...p, apiKeys: !p.apiKeys }))}
                                  >
                                      {saveLoadModalData.apiKeys ? <CheckSquare className="text-red-400 mr-3"/> : <Square className="text-slate-500 mr-3"/>}
                                      <div className="flex items-start gap-2">
                                          <Key size={16} className="mt-1 text-slate-400"/>
                                          <div>
                                              <div className="font-bold text-sm text-slate-200">API 密钥 (API Keys)</div>
                                              <div className="text-xs text-slate-500">包含您输入的API Key。请谨慎勾选，避免泄露。</div>
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          )}

                          {/* Character Import UI */}
                          {isImportMode && (
                              <div className="flex flex-col flex-1 overflow-hidden">
                                  {/* Import Options (Memory Retention) */}
                                  <div className="mb-4 p-3 bg-slate-950/50 rounded border border-slate-800 space-y-2">
                                      <div className="flex items-center justify-between">
                                          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                                              <input 
                                                  type="checkbox" 
                                                  className="accent-indigo-500"
                                                  checked={importSettings.keepMemory}
                                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImportSettings({...importSettings, keepMemory: e.target.checked})}
                                              />
                                              <span className="flex items-center gap-1"><BrainCircuit size={14} className="text-indigo-400"/> 保留角色记忆 (Keep Memory)</span>
                                          </label>
                                          
                                          {importSettings.keepMemory && (
                                              <div className="flex items-center gap-2 text-xs">
                                                  <span className="text-slate-500">回溯轮数:</span>
                                                  <Input 
                                                      type="number" 
                                                      className="w-16 h-6 text-center text-xs bg-black border-slate-700" 
                                                      value={importSettings.memoryRounds}
                                                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImportSettings({...importSettings, memoryRounds: Math.max(1, parseInt(e.target.value) || 20)})}
                                                  />
                                              </div>
                                          )}
                                      </div>
                                      {importSettings.keepMemory && (
                                          <p className="text-[10px] text-slate-500 ml-5">
                                              启用后，系统将自动从源存档提取每个角色的近期经历并写入其描述中。同时会触发“神秘传送”剧情。
                                          </p>
                                      )}
                                  </div>

                                  <div className="flex justify-between items-center mb-2">
                                      <div className="text-xs text-slate-400">
                                          共发现 {parsedImportChars.length} 名角色
                                      </div>
                                      <button onClick={selectAllImport} className="text-xs text-indigo-400 hover:text-indigo-300">
                                          {selectedImportIds.size === parsedImportChars.length ? "取消全选" : "全选"}
                                      </button>
                                  </div>
                                  
                                  <div className="flex-1 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-2 space-y-1 custom-scrollbar min-h-[150px]">
                                      {parsedImportChars.length === 0 && <div className="text-center text-slate-600 py-10 text-xs">未在存档中找到有效角色数据或正在解密验证中...</div>}
                                      {parsedImportChars.map(char => {
                                          const isSelected = selectedImportIds.has(char.id);
                                          return (
                                              <div 
                                                  key={char.id} 
                                                  onClick={() => toggleImportSelection(char.id)}
                                                  className={`flex items-center gap-3 p-2 rounded cursor-pointer border transition-colors ${isSelected ? 'bg-teal-900/30 border-teal-500/50' : 'bg-slate-900 border-slate-800 hover:border-slate-600'}`}
                                              >
                                                  {isSelected ? <CheckSquare size={16} className="text-teal-400 shrink-0"/> : <Square size={16} className="text-slate-600 shrink-0"/>}
                                                  <div className="w-8 h-8 rounded bg-slate-800 overflow-hidden shrink-0">
                                                       {char.avatarUrl ? <img src={char.avatarUrl} className="w-full h-full object-cover"/> : <Users size={16} className="m-2 text-slate-600"/>}
                                                  </div>
                                                  <div className="flex-1 min-w-0">
                                                      <div className="text-sm font-bold text-slate-200 truncate">{char.name}</div>
                                                      <div className="text-[10px] text-slate-500 truncate">{char.description}</div>
                                                  </div>
                                                  {char.isPlayer && <span className="text-[9px] bg-indigo-900/50 text-indigo-300 px-1.5 rounded">PC</span>}
                                              </div>
                                          );
                                      })}
                                  </div>
                                  <p className="text-[10px] text-slate-500 mt-2">
                                      选中的角色将被复制到当前游戏，并放置在您当前所在的地点。
                                  </p>
                              </div>
                          )}
                      </>
                  )}

                  <div className="flex justify-end gap-3 mt-6 shrink-0">
                      <Button variant="secondary" onClick={() => game.setSaveLoadModal((prev: any) => ({ ...prev, isOpen: false }))}>取消</Button>
                      <Button onClick={handleSaveLoadConfirm} disabled={isImportMode && selectedImportIds.size === 0}>
                          {game.saveLoadModal.type === 'save' ? "确认保存" : (isImportMode ? `导入选定 (${selectedImportIds.size})` : "确认加载")}
                      </Button>
                  </div>
              </div>
          </div>
      )}

      <TopBar 
        state={game.state}
        updateState={game.updateState}
        openWindow={game.openWindow}
        restartGame={restartGame}
        onSaveClick={game.onSaveClick}
        onLoadClick={game.onLoadClick}
        fileInputRef={game.fileInputRef}
        setSelectedCharId={engine.setSelectedCharId}
        onTogglePause={handleTogglePause}
        mobileView={mobileView}
        setMobileView={setMobileView}
        onConfirm={(title: string, msg: string, action: () => void) => setConfirmModal({ title, message: msg, onConfirm: action })}
      />

      {/* Responsive Layout Container */}
      <div className="flex-1 flex relative overflow-hidden w-full">
          
          {/* Left Panel (Map) */}
          <div className={`${mobileView === 'map' ? 'flex' : 'hidden'} lg:flex flex-col z-20 w-full lg:w-auto h-full border-r border-slate-800 shrink-0`}>
              <LeftPanel 
                 state={game.state} 
                 updateState={game.updateState} 
                 openWindow={game.openWindow}
                 addLog={game.addLog}
                 onResetLocation={engine.resetLocation}
              />
          </div>

          {/* Center Panel (Story + Controls) */}
          <div className={`${mobileView === 'story' ? 'flex' : 'hidden'} lg:flex flex-1 flex-col min-w-0 relative h-full`}>
             <StoryLog 
                state={game.state}
                updateState={game.updateState}
                onConfirm={(title: string, msg: string, action: () => void) => setConfirmModal({ title, message: msg, onConfirm: action })}
                onRollback={game.rollbackToLog}
             />
             <PlayerControls 
                state={game.state}
                activeCharId={game.state.round.currentOrder[game.state.round.turnIndex] || ""}
                playerInput={engine.playerInput}
                setPlayerInput={engine.setPlayerInput}
                selectedCardId={engine.selectedCardId}
                setSelectedCardId={engine.setSelectedCardId}
                selectedTargetId={engine.selectedTargetId}
                setSelectedTargetId={engine.setSelectedTargetId}
                submitPlayerTurn={engine.submitPlayerTurn}
                isProcessingAI={engine.isProcessingAI}
                pendingActions={engine.pendingActions}
                setPendingActions={engine.setPendingActions}
                onOpenShop={() => {
                    const charId = game.state.round.currentOrder[game.state.round.turnIndex];
                    if (charId) {
                        engine.setSelectedCharId(charId);
                        game.openWindow('shop');
                    }
                }}
                reactionRequest={game.reactionRequest}
                onRespondToReaction={game.respondToReactionRequest}
             />
          </div>

          {/* Right Panel (Character Info) */}
          <div className={`${mobileView === 'char' ? 'flex' : 'hidden'} lg:flex flex-col z-20 w-full lg:w-auto h-full border-l border-slate-800 shrink-0`}>
              <RightPanel 
                  selectedCharId={engine.selectedCharId}
                  state={game.state}
                  updateState={game.updateState}
                  openWindow={game.openWindow}
                  setSelectedCharId={engine.setSelectedCharId}
              />
          </div>
      </div>

      <WindowManager 
          windows={game.windows}
          closeWindow={game.closeWindow}
          state={game.state}
          updateState={game.updateState}
          openWindow={game.openWindow}
          addLog={game.addLog}
          selectedCharId={engine.selectedCharId}
          addDebugLog={game.addDebugLog} // Passed Here
      />
    </div>
  );
}
