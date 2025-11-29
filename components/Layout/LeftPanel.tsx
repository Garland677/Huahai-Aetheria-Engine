
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GameState, WindowState, GameAttribute, Conflict, MapLocation, MapRegion, Character } from '../../types';
import { Edit2, X, Globe, Wind, MapPin, Clock, Zap, Sun, Navigation, Compass, Footprints, AlertTriangle, Map, Users, RefreshCw, History, Lock, Check, Save, Hand } from 'lucide-react';
import { MapVisualizer } from './MapVisualizer';
import { Button, TextArea, Label, Input } from '../ui/Button';
import { getTerrainHeight } from '../../services/mapUtils';
import { generateRandomFlagAvatar } from '../../assets/imageLibrary';

interface LeftPanelProps {
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    openWindow: (type: WindowState['type']) => void;
    addLog: (text: string) => void;
    onResetLocation: (locationId: string, keepRegion: boolean) => void;
}

const AttrIcon = ({ id }: { id: string }) => {
    switch(id) {
        case 'weather': return <Wind size={14} />;
        case 'world_status': return <Wind size={14} />;
        case 'time': return <Clock size={14} />;
        case 'worldTime': return <Clock size={14} />;
        case 'chaos_level': return <Zap size={14} />;
        default: return <Sun size={14} />;
    }
};

export const LeftPanel: React.FC<LeftPanelProps> = ({ state, updateState, openWindow, addLog, onResetLocation }) => {
    const [viewingLocId, setViewingLocId] = useState<string | null>(null);
    const [isEditingGuidance, setIsEditingGuidance] = useState(false);
    const [guidanceTemp, setGuidanceTemp] = useState("");
    const [showConflictHistory, setShowConflictHistory] = useState(false);
    const [isManualMove, setIsManualMove] = useState(false);

    // Region Editing State
    const [isEditingRegion, setIsEditingRegion] = useState(false);
    const [tempRegion, setTempRegion] = useState({ name: "", description: "" });

    const locked = state.appSettings.lockedFeatures || ({} as any);

    // Reset Location Modal
    const [resetLocModal, setResetLocModal] = useState<{ isOpen: boolean, keepRegion: boolean } | null>(null);

    useEffect(() => {
        if (!viewingLocId && state.map.activeLocationId) {
            setViewingLocId(state.map.activeLocationId);
        }
    }, [state.map.activeLocationId]);

    const handleLocationSelect = (locId: string) => {
        setViewingLocId(locId);
        // Reset editing state when changing location
        setIsEditingRegion(false);
    };

    const handleCreateLocation = (x: number, y: number) => {
        const seed = state.map.chunks['0_0']?.seed || 123;
        const z = getTerrainHeight(x, y, seed);
        const newId = `loc_custom_${x}_${y}_${Date.now()}`;
        
        const newLoc: MapLocation = {
            id: newId,
            name: "标记地点",
            description: "玩家自行标记的未知地点。等待探索。",
            coordinates: { x, y, z },
            isKnown: false,
            radius: 50,
            associatedNpcIds: [],
            avatarUrl: generateRandomFlagAvatar(true) // Generate blurred avatar for manual creation
        };
        
        updateState(prev => ({
            ...prev,
            map: {
                ...prev.map,
                locations: {
                    ...prev.map.locations,
                    [newId]: newLoc
                }
            }
        }));
        setViewingLocId(newId);
        addLog(`系统: 已在坐标 (${x}, ${y}) 标记新地点。`);
    };

    const handleTravel = () => {
        if (viewingLocId && viewingLocId !== state.map.activeLocationId) {
            const loc = state.map.locations[viewingLocId];
            const currentLocId = state.map.activeLocationId;
            const activeLoc = state.map.locations[currentLocId || ''];
            
            let cost = 0;
            // Free travel to known locations
            if (!loc.isKnown && activeLoc) {
                 const dist = Math.sqrt(Math.pow(loc.coordinates.x - activeLoc.coordinates.x, 2) + Math.pow(loc.coordinates.y - activeLoc.coordinates.y, 2));
                 cost = Math.ceil(dist / 100);
            }

            if (state.round.actionPoints < cost) {
                addLog(`系统: 行动点不足！需要 ${cost} AP，当前仅有 ${state.round.actionPoints} AP。`);
                return;
            }

            updateState(prev => {
                const nextPos = { ...prev.map.charPositions };
                const nextChars = { ...prev.characters };
                
                // Calculate ID base
                let maxId = 0;
                (Object.values(prev.characters) as Character[]).forEach(c => {
                    c.conflicts?.forEach(x => {
                        const n = parseInt(x.id);
                        if (!isNaN(n) && n > maxId) maxId = n;
                    });
                });

                // Move Followers Logic
                (Object.values(prev.characters) as Character[]).forEach(c => {
                    if (c.isFollowing) {
                        const pos = nextPos[c.id];
                        if (pos && pos.locationId === currentLocId) {
                            nextPos[c.id] = {
                                x: loc.coordinates.x,
                                y: loc.coordinates.y,
                                locationId: viewingLocId
                            };
                            
                            // Add Conflict
                            maxId++;
                            const updatedChar = { ...nextChars[c.id] };
                            updatedChar.conflicts = [
                                ...(updatedChar.conflicts || []),
                                {
                                    id: String(maxId),
                                    desc: "刚到此地，对当地情况不熟悉",
                                    apReward: 2,
                                    solved: false
                                }
                            ];
                            nextChars[c.id] = updatedChar;
                        }
                    }
                });

                return {
                    ...prev,
                    map: { 
                        ...prev.map, 
                        activeLocationId: viewingLocId, 
                        charPositions: nextPos, 
                        manualExplorationNext: isManualMove // Pass manual flag to map state
                    },
                    characters: nextChars,
                    round: { ...prev.round, actionPoints: prev.round.actionPoints - cost }
                };
            });
            
            if (cost > 0) {
                addLog(`系统: 消耗 ${cost} AP，全员移动至 [${loc.name}]。`);
            } else {
                addLog(`系统: 快速移动至已知地点 [${loc.name}] (0 AP)。`);
            }
        }
    };

    const handleSaveGuidance = () => {
        updateState(prev => ({
            ...prev,
            world: { ...prev.world, worldGuidance: guidanceTemp }
        }));
        setIsEditingGuidance(false);
        addLog("系统: 世界发展指导需求已更新，AI 将尝试遵循新指令。");
    };

    const confirmResetLocation = () => {
        if (viewingLocId && resetLocModal) {
            onResetLocation(viewingLocId, resetLocModal.keepRegion);
            setResetLocModal(null);
        }
    };

    const viewingLocation = viewingLocId ? state.map.locations[viewingLocId] : null;
    const isAtLocation = viewingLocId === state.map.activeLocationId;
    // Look up region from map state
    const viewingRegion = viewingLocation?.regionId ? state.map.regions[viewingLocation.regionId] : null;

    const handleSaveRegion = () => {
        if (!viewingRegion) return;
        updateState(prev => ({
            ...prev,
            map: {
                ...prev.map,
                regions: {
                    ...prev.map.regions,
                    [viewingRegion.id]: {
                        ...viewingRegion,
                        name: tempRegion.name,
                        description: tempRegion.description
                    }
                }
            }
        }));
        setIsEditingRegion(false);
        addLog(`系统: 区域 [${tempRegion.name}] 信息已更新。`);
    };

    // Characters at viewing location
    const charsAtLocation = viewingLocId ? (Object.values(state.characters) as Character[]).filter(c => {
        const pos = state.map.charPositions[c.id];
        return pos && pos.locationId === viewingLocId;
    }) : [];

    // Gather conflicts from CHARACTERS
    // Filter: Only show NOT solved conflicts in the main list
    const localConflicts: { charName: string, conflict: Conflict }[] = [];
    charsAtLocation.forEach(c => {
        if (c.conflicts) {
            c.conflicts.forEach(conf => {
                if (!conf.solved) {
                    localConflicts.push({ charName: c.name, conflict: conf });
                }
            });
        }
    });

    // Gather region conflicts (characters in same region but NOT current location)
    const regionOtherConflicts: { locName: string, charName: string, conflict: Conflict }[] = [];
    if (viewingRegion) {
        (Object.values(state.characters) as Character[]).forEach(c => {
            const pos = state.map.charPositions[c.id];
            // Filter: In same region, but not in viewingLocId
            if (pos && pos.locationId && pos.locationId !== viewingLocId) {
                const loc = state.map.locations[pos.locationId];
                if (loc && loc.regionId === viewingRegion.id) {
                    if (c.conflicts) {
                        c.conflicts.forEach(conf => {
                             if (!conf.solved) {
                                 regionOtherConflicts.push({ locName: loc.name, charName: c.name, conflict: conf });
                             }
                        });
                    }
                }
            }
        });
    }

    // Gather ALL solved conflicts for history
    const solvedConflicts: { charName: string, conflict: Conflict }[] = [];
    (Object.values(state.characters) as Character[]).forEach(c => {
        if(c.conflicts) {
            c.conflicts.forEach(conf => {
                if(conf.solved) {
                    solvedConflicts.push({ charName: c.name, conflict: conf });
                }
            });
        }
    });
    // Sort by solvedTimestamp (most recent first)
    solvedConflicts.sort((a,b) => (b.conflict.solvedTimestamp || 0) - (a.conflict.solvedTimestamp || 0));

    let travelCost = 0;
    let distance = 0;
    if (viewingLocation && state.map.activeLocationId) {
        const activeLoc = state.map.locations[state.map.activeLocationId];
        if (activeLoc) {
            distance = Math.sqrt(Math.pow(viewingLocation.coordinates.x - activeLoc.coordinates.x, 2) + Math.pow(viewingLocation.coordinates.y - activeLoc.coordinates.y, 2));
            if (!viewingLocation.isKnown) {
                travelCost = Math.ceil(distance / 100);
            }
        }
    }

    return (
      <div className="w-full lg:w-72 bg-slate-950 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col z-0 shadow-lg relative h-full">
          
          {/* Conflict History Modal */}
          {showConflictHistory && (
              <div className="absolute inset-0 z-[100] bg-slate-950/95 flex flex-col p-4">
                  <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-2">
                      <h3 className="font-bold text-white flex items-center gap-2"><History size={16}/> 矛盾解决历史 (Resolved Conflicts)</h3>
                      <button onClick={() => setShowConflictHistory(false)} className="text-slate-400 hover:text-white"><X size={20}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
                      {solvedConflicts.length === 0 ? (
                          <div className="text-center text-slate-500 text-sm mt-10 italic">暂无已解决的矛盾。</div>
                      ) : (
                          solvedConflicts.map((item, idx) => (
                              <div key={idx} className="bg-slate-900 border border-green-900/30 rounded p-3 opacity-80 hover:opacity-100 transition-opacity">
                                  <div className="flex justify-between text-xs mb-1">
                                      <span className="text-slate-400 font-bold">[{item.charName}]</span>
                                      <span className="text-green-500 font-mono text-[10px]">
                                          {item.conflict.solvedTimestamp ? new Date(item.conflict.solvedTimestamp).toLocaleTimeString() : "已解决"}
                                      </span>
                                  </div>
                                  <div className="text-sm text-slate-300 line-through decoration-green-500 decoration-2">{item.conflict.desc}</div>
                                  <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                                      <Zap size={10}/> 已获得奖励: {item.conflict.apReward} AP
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </div>
          )}

          {/* Reset Location Modal */}
          {resetLocModal && (
              <div className="absolute inset-0 z-[100] bg-slate-950/90 flex items-center justify-center p-4">
                  <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 shadow-xl w-full">
                      <h3 className="font-bold text-white mb-2 flex items-center gap-2 text-sm"><RefreshCw size={14}/> 重置/重生成地点?</h3>
                      <p className="text-xs text-slate-400 mb-4">
                          这将清除当前地点的名称和描述，并根据当前世界观重新生成。地理位置和现有角色将保留。
                      </p>
                      
                      <label className="flex items-center gap-2 text-xs text-slate-300 mb-4 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={resetLocModal.keepRegion} 
                            onChange={e => setResetLocModal({...resetLocModal, keepRegion: e.target.checked})}
                            className="accent-indigo-500"
                          />
                          保留区域信息 (Keep Region)
                      </label>
                      <div className="text-[10px] text-slate-500 mb-4 ml-5">
                          {resetLocModal.keepRegion ? "地点将适配现有区域主题。" : "将同时重新生成所属区域的设定。"}
                      </div>

                      <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setResetLocModal(null)}>取消</Button>
                          <Button size="sm" variant="danger" onClick={confirmResetLocation}>确定重置</Button>
                      </div>
                  </div>
              </div>
          )}

          {/* MAIN SCROLLABLE CONTAINER */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
              
              {/* 1. Map Visualizer (Fixed Height within scroll) */}
              <div className="w-full h-64 shrink-0 relative border-b border-slate-800 bg-black">
                  <MapVisualizer 
                    state={state} 
                    onLocationSelect={handleLocationSelect} 
                    viewingLocationId={viewingLocId}
                    onCreateLocation={handleCreateLocation}
                  />
              </div>
              
              {/* 2. Action Points & Guidance Controls */}
              <div className="bg-slate-900 p-2 border-b border-slate-800 flex flex-col gap-2 shrink-0">
                   <div className="flex items-center justify-between bg-slate-950 p-2 rounded border border-slate-800">
                       <div className="flex items-center gap-2 text-teal-400 font-bold text-xs">
                           <Footprints size={14}/> 行动点 (AP)
                       </div>
                       <div className="flex items-center gap-1">
                           <input 
                               type="number" 
                               className={`w-28 bg-black border border-slate-700 rounded px-1 text-right text-xs font-mono text-white outline-none ${locked.actionPoints ? 'opacity-50 cursor-not-allowed' : 'focus:border-teal-500'}`}
                               value={state.round.actionPoints}
                               readOnly={locked.actionPoints}
                               onChange={(e) => {
                                   if (locked.actionPoints) return;
                                   const val = parseInt(e.target.value) || 0;
                                   updateState(s => ({...s, round: {...s.round, actionPoints: val}}));
                               }}
                           />
                       </div>
                   </div>

                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className={`w-full flex justify-between items-center text-xs text-slate-400 hover:text-indigo-300 hover:bg-slate-800 py-1 h-auto ${locked.directorInstructions ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => { 
                        if (locked.directorInstructions) return;
                        setGuidanceTemp(state.world.worldGuidance || ""); 
                        setIsEditingGuidance(true); 
                    }}
                    title={locked.directorInstructions ? "已锁定" : "点击编辑世界生成指导"}
                  >
                      <span className="flex items-center gap-2"><Compass size={12}/> 生成设定 / 导演指令</span>
                      {locked.directorInstructions ? <Lock size={10}/> : <Edit2 size={10} />}
                  </Button>
              </div>

              {/* 3. Location & Region Details Panel */}
              {viewingLocation && (
                  <div className="p-4 border-b border-slate-800 bg-slate-900/30 shrink-0">
                      {/* Region Section */}
                      <div className="mb-3 pb-3 border-b border-slate-800/50">
                          <div className="flex justify-between items-start mb-1">
                              <h3 className="text-[10px] font-bold text-indigo-400 flex items-center gap-1 uppercase tracking-wider">
                                  <Map size={10}/> 所属区域 (Region)
                              </h3>
                          </div>
                          
                          {viewingRegion ? (
                            isEditingRegion ? (
                                <div className="flex flex-col gap-2 bg-slate-950/50 p-2 rounded border border-slate-700/50 mt-1">
                                    <Input 
                                        value={tempRegion.name} 
                                        onChange={e => setTempRegion({...tempRegion, name: e.target.value})}
                                        className="text-xs h-7 bg-slate-900 border-slate-600"
                                        placeholder="区域名称"
                                    />
                                    <TextArea 
                                        value={tempRegion.description}
                                        onChange={e => setTempRegion({...tempRegion, description: e.target.value})}
                                        className="text-xs min-h-[100px] leading-relaxed bg-slate-900 border-slate-600 resize-none"
                                        placeholder="区域描述..."
                                    />
                                    <div className="flex justify-end gap-2 mt-1">
                                        <button 
                                            onClick={() => setIsEditingRegion(false)} 
                                            className="text-[10px] flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-slate-400 hover:bg-slate-700"
                                        >
                                            <X size={10}/> 取消
                                        </button>
                                        <button 
                                            onClick={handleSaveRegion} 
                                            className="text-[10px] flex items-center gap-1 px-2 py-1 rounded bg-green-900/50 text-green-400 hover:bg-green-900/80 border border-green-900"
                                        >
                                            <Save size={10}/> 保存
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="group relative pr-6">
                                    <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => {
                                                if (locked.locationEditor) return;
                                                setTempRegion({ name: viewingRegion.name, description: viewingRegion.description });
                                                setIsEditingRegion(true);
                                            }}
                                            className={`p-1 rounded ${locked.locationEditor ? 'text-slate-600 cursor-not-allowed' : 'text-slate-500 hover:text-indigo-400 hover:bg-slate-800'}`}
                                            title={locked.locationEditor ? "区域编辑已锁定" : "编辑区域信息"}
                                        >
                                            {locked.locationEditor ? <Lock size={12}/> : <Edit2 size={12}/>}
                                        </button>
                                    </div>
                                    <p className="text-xs font-bold text-slate-200 mb-1">{viewingRegion.name}</p>
                                    <p className="text-[9px] text-slate-500 leading-tight">{viewingRegion.description}</p>
                                </div>
                            )
                          ) : (
                            <p className="text-[9px] text-slate-600 italic">未知 / 未分配区域</p>
                          )}
                      </div>

                      <div className="flex items-start justify-between mb-2">
                           <h3 className="text-xs font-bold text-slate-400 flex items-center gap-2">
                              <MapPin size={12}/> 
                              {viewingLocation.isKnown ? viewingLocation.name : "未知地点"}
                              {isAtLocation && <span className="text-[9px] bg-red-900/50 text-red-400 px-1.5 rounded">当前位置</span>}
                           </h3>
                           {viewingLocation.isKnown && !locked.locationReset && (
                               <button 
                                 onClick={() => setResetLocModal({ isOpen: true, keepRegion: true })}
                                 className="text-slate-600 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors"
                                 title="重置/重新生成地点信息"
                               >
                                   <RefreshCw size={12}/>
                               </button>
                           )}
                      </div>
                      
                      <p className="text-[10px] text-slate-500 mb-3 italic leading-relaxed">
                          {viewingLocation.isKnown ? viewingLocation.description : "遥远的未知之地。点击「移动」以探索此地。"}
                      </p>
                      <div className="flex justify-between items-center text-[9px] text-slate-600 font-mono mb-2 bg-black/20 p-1 rounded">
                          <span>X: {viewingLocation.coordinates.x.toFixed(0)}, Y: {viewingLocation.coordinates.y.toFixed(0)}</span>
                          <span className="text-yellow-500 font-bold">Z: {viewingLocation.coordinates.z.toFixed(0)}m</span>
                      </div>

                      {/* Character List */}
                      <div className="mb-3">
                           <h3 className="text-[10px] font-bold text-teal-400 uppercase mb-1 flex items-center gap-1">
                              <Users size={10}/> 区域角色 ({(charsAtLocation || []).length})
                           </h3>
                           {(charsAtLocation || []).length > 0 ? (
                               <div className="flex flex-wrap gap-1">
                                   {(charsAtLocation || []).map(c => (
                                       <span key={c.id} className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                                           {c.name}
                                       </span>
                                   ))}
                               </div>
                           ) : (
                               <span className="text-[9px] text-slate-600 italic">空无一人</span>
                           )}
                      </div>

                      {/* Conflicts Display */}
                      {viewingLocation.isKnown && (
                          <div className="mt-3 mb-3 space-y-2">
                              <div className="flex justify-between items-center">
                                  <h3 className="text-[10px] font-bold text-orange-400 uppercase flex items-center gap-1">
                                      <AlertTriangle size={10} /> 活跃矛盾 (Active)
                                  </h3>
                                  <button onClick={() => setShowConflictHistory(true)} className="text-[9px] text-slate-500 hover:text-white flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                      <History size={10}/> 历史
                                  </button>
                              </div>

                              {/* Local Conflicts */}
                              {localConflicts.length > 0 ? (
                                  <div className="bg-orange-900/10 border border-orange-900/30 rounded p-2">
                                      <div className="space-y-1">
                                          {localConflicts.map((item, idx) => (
                                              <div key={idx} className="text-[10px] flex justify-between gap-2 text-slate-300">
                                                  <span className="whitespace-pre-wrap break-words">
                                                      <span className="text-slate-500">[{item.charName}]</span> {item.conflict.desc}
                                                  </span>
                                                  <span className="font-mono text-orange-300 whitespace-nowrap">+{item.conflict.apReward}</span>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              ) : (
                                  <div className="text-[9px] text-slate-600 italic px-2">无本地角色矛盾</div>
                              )}
                              
                              {/* Region Conflicts */}
                              {regionOtherConflicts.length > 0 && (
                                  <div className="bg-slate-800/30 border border-slate-700/50 rounded p-2 opacity-80 hover:opacity-100 transition-opacity">
                                      <div className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1">
                                          <Globe size={10} /> 区域其他矛盾 (Region)
                                      </div>
                                      <div className="space-y-1">
                                          {regionOtherConflicts.slice(0, 3).map((item, i) => (
                                              <div key={i} className="text-[9px] text-slate-400 flex justify-between gap-2">
                                                  <span className="whitespace-pre-wrap break-words">[{item.locName} - {item.charName}] {item.conflict.desc}</span>
                                                  <span className="font-mono text-slate-500">+{item.conflict.apReward}</span>
                                              </div>
                                          ))}
                                          {regionOtherConflicts.length > 3 && <div className="text-[8px] text-slate-600">...以及更多 ({regionOtherConflicts.length - 3})</div>}
                                      </div>
                                  </div>
                              )}
                          </div>
                      )}
                      
                      {!isAtLocation && (
                          <div className="flex flex-col gap-1 mt-4">
                              <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                   <span>距离: {distance.toFixed(0)}m</span>
                                   <span className={state.round.actionPoints >= travelCost ? "text-teal-400" : "text-red-400"}>消耗: {travelCost} AP</span>
                              </div>
                              <div className="flex gap-2">
                                  {!viewingLocation.isKnown && (
                                      <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer px-2 py-1 rounded bg-slate-900 border border-slate-800 hover:bg-slate-800" title="手动模式: 跳过AI生成，手动填写地名和描述">
                                          <input 
                                              type="checkbox" 
                                              checked={isManualMove} 
                                              onChange={e => setIsManualMove(e.target.checked)}
                                              className="accent-indigo-500"
                                          />
                                          手动
                                      </label>
                                  )}
                                  <Button 
                                    size="sm" 
                                    className="flex-1 flex items-center justify-center gap-2" 
                                    onClick={handleTravel}
                                    disabled={state.round.actionPoints < travelCost}
                                    variant={state.round.actionPoints < travelCost ? 'secondary' : 'primary'}
                                  >
                                      <Navigation size={14}/> {state.round.actionPoints < travelCost ? "AP不足" : "移动至此"}
                                  </Button>
                              </div>
                          </div>
                      )}
                  </div>
              )}

              {/* 4. World Status Panel */}
              <div className="p-4 shrink-0">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                        <Globe size={12}/> 世界状态
                    </h3>
                    <button 
                        onClick={() => !locked.worldState && openWindow('world')} 
                        disabled={locked.worldState}
                        className={`text-slate-500 hover:text-white ${locked.worldState ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {locked.worldState ? <Lock size={12}/> : <Edit2 size={12}/>}
                    </button>
                  </div>
                  <div className="space-y-2">
                      {(Object.values(state.world.attributes) as GameAttribute[]).map(attr => (
                          <div key={attr.id} className="flex justify-between items-center bg-slate-900 p-2.5 rounded border border-slate-800 group hover:border-slate-700 transition-colors">
                              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
                                  <AttrIcon id={attr.id} /> {attr.name}
                              </div>
                              <span className="font-mono text-xs text-indigo-300 bg-black/40 px-1.5 py-0.5 rounded">{attr.value}</span>
                          </div>
                      ))}
                  </div>
              </div>
              
              {/* Spacer for bottom clearance on mobile if needed */}
              <div className="h-10 lg:h-0 shrink-0"></div>
          </div>

          {/* Director Instructions Modal Overlay - Moved to Portal for Z-Index safety */}
          {isEditingGuidance && createPortal(
              <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
                  <div className="w-full max-w-5xl bg-slate-900 border border-slate-700 rounded-lg p-6 shadow-2xl flex flex-col gap-4 h-[80vh]">
                      <h3 className="text-lg font-bold text-indigo-400 flex items-center gap-2 shrink-0"><Compass size={20}/> 世界导演指令 / 生成设定 (Director Instructions)</h3>
                      <div className="flex-1 overflow-hidden">
                          <TextArea
                              className="w-full h-full text-sm font-mono leading-relaxed resize-none bg-slate-950 border-slate-800 focus:border-indigo-500 p-4"
                              placeholder="例如: 这是一个赛博朋克世界，科技发达但社会秩序混乱。所有的NPC都应该带有某种机械改造特征..."
                              value={guidanceTemp}
                              onChange={e => setGuidanceTemp(e.target.value)}
                          />
                      </div>
                      <div className="flex justify-end gap-2 shrink-0">
                          <Button variant="secondary" onClick={() => setIsEditingGuidance(false)}>取消</Button>
                          <Button onClick={handleSaveGuidance}>保存设定</Button>
                      </div>
                  </div>
              </div>,
              document.body
          )}
      </div>
    );
};