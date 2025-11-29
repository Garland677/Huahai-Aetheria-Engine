
import React, { useState, useRef, useEffect } from 'react';
import { GameState, Character, GamePhase, LogEntry } from '../../types';
import { Button, TextArea, Input } from '../ui/Button';
import { Trash2, Scissors, Edit2, RefreshCw, ListOrdered, User, CheckCircle, AlertCircle, Sword, Play, Pause, Square, FastForward, X, Zap, MapPin } from 'lucide-react';

interface StoryLogProps {
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    onConfirm: (title: string, msg: string, action: () => void) => void;
    onRollback: (index: number) => void; // New Prop
}

const ProcessVisualizer = ({ state, onClearError }: { state: GameState, onClearError: () => void }) => {
    const { phase, roundNumber, activeCharId, turnIndex, currentOrder, lastErrorMessage, isPaused } = state.round;
    const activeChar = activeCharId ? state.characters[activeCharId] : null;

    const steps = [
        { id: 'order', label: '判定顺序', icon: <ListOrdered size={14}/> },
        { id: 'turn', label: '角色行动', icon: <User size={14}/> },
        { id: 'settlement', label: '轮次结算', icon: <CheckCircle size={14}/> },
    ];

    // Determine current visual step
    let currentStepId = '';
    if (phase === 'init' || phase === 'order') currentStepId = 'order';
    else if (['turn_start', 'char_acting', 'executing'].includes(phase)) currentStepId = 'turn';
    else if (['settlement', 'round_end'].includes(phase)) currentStepId = 'settlement';

    return (
        <div className="bg-slate-900 border-b border-slate-800 shadow-md z-30 flex flex-col shrink-0">
            <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2 md:gap-4 overflow-x-auto scrollbar-hide max-w-full">
                    <div className="flex flex-col items-center justify-center bg-indigo-900/30 px-2 py-1 rounded border border-indigo-500/30 shrink-0">
                        <span className="text-[8px] md:text-[10px] text-indigo-400 uppercase font-bold tracking-wider">Round</span>
                        <span className="text-lg md:text-xl font-mono font-bold text-indigo-200 leading-none">{roundNumber}</span>
                    </div>
                    
                    {isPaused && (
                         <div className="flex items-center gap-2 text-amber-500 text-xs font-bold bg-amber-900/20 px-2 py-1 rounded animate-pulse shrink-0">
                             <Pause size={12}/> <span className="hidden sm:inline">PAUSED</span>
                         </div>
                    )}

                    <div className="h-6 w-px bg-slate-800 mx-1 shrink-0"></div>

                    <div className="flex items-center gap-1">
                        {steps.map((step, idx) => {
                            const isActive = currentStepId === step.id;
                            const isDone = steps.findIndex(s => s.id === currentStepId) > idx;
                            
                            return (
                                <React.Fragment key={step.id}>
                                    <div className={`
                                        flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1 md:py-1.5 rounded transition-all shrink-0
                                        ${isActive 
                                            ? (lastErrorMessage ? 'bg-red-900/50 text-red-200 border border-red-500' : 'bg-indigo-600 text-white shadow-lg scale-105') 
                                            : isDone ? 'text-indigo-400 opacity-50' : 'text-slate-600 bg-slate-900'}
                                    `}>
                                        <div className={isActive && phase === 'executing' ? 'animate-spin' : ''}>{step.icon}</div>
                                        <span className="text-xs font-bold hidden sm:inline">{step.label}</span>
                                    </div>
                                    {idx < steps.length - 1 && (
                                        <div className={`h-0.5 w-2 md:w-4 ${isDone ? 'bg-indigo-500/50' : 'bg-slate-800'}`}></div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* Active Char Info */}
                {currentStepId === 'turn' && activeChar && (
                     <div className="flex items-center gap-2 md:gap-3 animate-in slide-in-from-right-4 pl-2 border-l border-slate-800 ml-2 shrink-0">
                         <div className="text-right hidden xs:block">
                             <div className="text-[10px] text-slate-500 uppercase">Turn {turnIndex + 1}/{currentOrder.length}</div>
                             <div className="text-sm font-bold text-slate-200 truncate max-w-[80px]">{activeChar.name}</div>
                         </div>
                         <div className="w-8 h-8 rounded bg-slate-800 overflow-hidden border border-slate-600 shrink-0">
                             {activeChar.avatarUrl && <img src={activeChar.avatarUrl} className="w-full h-full object-cover"/>}
                         </div>
                     </div>
                )}
            </div>

            {/* Error Message Display */}
            {lastErrorMessage && (
                <div className="bg-red-900/20 border-t border-red-900/50 px-4 py-2 flex items-center gap-2 text-xs text-red-400 animate-in slide-in-from-top-1">
                    <AlertCircle size={14} className="shrink-0"/>
                    <span className="font-mono flex-1">{lastErrorMessage}</span>
                    <button 
                        onClick={onClearError}
                        className="p-1 hover:bg-red-900/30 rounded text-red-400 hover:text-red-200 transition-colors"
                        title="关闭报错信息"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
        </div>
    );
};

// --- Location Bar Component (New) ---
const LocationBar = ({ state }: { state: GameState }) => {
    const locId = state.map.activeLocationId;
    const location = locId ? state.map.locations[locId] : null;
    const regionName = location && location.regionId && state.map.regions[location.regionId] 
        ? state.map.regions[location.regionId].name 
        : "未知区域";
    
    const timeStr = state.world.attributes['worldTime']?.value || "0000:00:00";
    // Extract meaningful time part (YY:MM:DD:HH:MM)
    const displayTime = timeStr.toString().split(':').slice(0, 5).join(':');

    return (
        <div className="relative h-12 w-full overflow-hidden border-b border-slate-800 bg-slate-950 shrink-0 group">
            {/* 1. Background Image (Blurred) */}
            <div 
                className="absolute inset-0 bg-cover bg-center opacity-60 transition-all duration-1000"
                style={{ 
                    backgroundImage: location?.avatarUrl ? `url(${location.avatarUrl})` : 'none',
                    filter: 'blur(0px)' // The image itself is already blurred from generator
                }}
            />
            
            {/* 2. Gradient Overlay (Left Transparent -> Right Black) */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/40 to-black/90 pointer-events-none" />

            {/* 3. Info Text (Right Aligned) */}
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-right z-10 flex flex-col items-end justify-center h-full pointer-events-none">
                <div 
                    className="text-sm md:text-base font-black text-black uppercase tracking-widest leading-none mb-0.5"
                    style={{ 
                        textShadow: '-1px -1px 0 #c084fc, 1px -1px 0 #c084fc, -1px 1px 0 #c084fc, 1px 1px 0 #c084fc' 
                    }}
                >
                    {regionName} - {location ? location.name : "未知地点"}
                </div>
                <div className="text-[10px] md:text-xs text-purple-300 font-mono bg-black/50 px-2 rounded border border-purple-500/30 backdrop-blur-sm">
                    {displayTime}
                </div>
            </div>
            
            {/* Optional Left Icon */}
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 z-10">
                <MapPin size={24} />
            </div>
        </div>
    );
};

export const StoryLog: React.FC<StoryLogProps> = ({ state, updateState, onConfirm, onRollback }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [editingLogIndex, setEditingLogIndex] = useState<number | null>(null);
    const [editLogValue, setEditLogValue] = useState("");
    
    // Auto Round Input State
    const [showAutoInput, setShowAutoInput] = useState(false);
    const [autoRoundInput, setAutoRoundInput] = useState("5");

    const isLightMode = state.appSettings.storyLogLightMode;

    useEffect(() => {
        if (scrollRef.current && editingLogIndex === null) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [state.world.history, editingLogIndex]);

    const handleLogEdit = (index: number, newValue: string) => {
        updateState(prev => {
            const newHistory = [...prev.world.history];
            newHistory[index] = { ...newHistory[index], content: newValue };
            return { ...prev, world: { ...prev.world, history: newHistory } };
        });
        setEditingLogIndex(null);
    };

    const handleLogDelete = (index: number) => {
        // If deleting the last item, behave like a rollback to index-1
        if (index === state.world.history.length - 1 && index > 0) {
             onRollback(index - 1);
        } else {
             updateState(prev => {
                const newHistory = prev.world.history.filter((_, i) => i !== index);
                return { ...prev, world: { ...prev.world, history: newHistory } };
            });
        }
        if (editingLogIndex === index) setEditingLogIndex(null);
    };

    const handleBranchStory = (index: number) => {
        onConfirm("分叉剧情", "确定要在此处分叉剧情吗？此条之后的所有日志将被删除，系统将尝试根据当前日志自动恢复轮次状态。", () => {
            onRollback(index);
        });
    };

    const handleRegenerate = () => {
        if (state.world.history.length <= 1) return;
        // Rollback to the second to last item (effectively deleting the last one and resetting state)
        onRollback(state.world.history.length - 2);
    };

    const togglePause = () => {
        updateState(s => ({...s, round: {...s.round, isPaused: !s.round.isPaused}}));
    };

    const handleStopRound = () => {
        updateState(s => ({
            ...s,
            round: {
                ...s.round,
                isPaused: true,
                autoAdvance: false,
                autoAdvanceCount: 0, // Clear auto rounds on stop
                turnIndex: 0,
                phase: 'order',
                currentOrder: [],
                activeCharId: undefined
            }
        }));
    };

    const handleAutoRoundClick = () => {
        // If already running auto, stop it
        if ((state.round.autoAdvanceCount || 0) > 0) {
            updateState(s => ({ ...s, round: { ...s.round, autoAdvanceCount: 0 } }));
        } else {
            setShowAutoInput(true);
        }
    };

    const confirmAutoRounds = () => {
        const count = parseInt(autoRoundInput);
        if (!isNaN(count) && count > 0) {
            updateState(s => ({ 
                ...s, 
                round: { 
                    ...s.round, 
                    autoAdvanceCount: count,
                    isPaused: false // Also auto-start
                } 
            }));
        }
        setShowAutoInput(false);
    };

    const clearError = () => {
        updateState(prev => ({
            ...prev,
            round: { ...prev.round, lastErrorMessage: undefined }
        }));
    };

    // --- Smart Text Enrichment ---
    const enrichLogText = (text: string) => {
        let enriched = text;
        
        // 1. Replace Character Names with Avatar + Name
        (Object.values(state.characters) as Character[]).forEach(char => {
            if (char.avatarUrl && enriched.includes(char.name)) {
                const imgTag = `<span class="inline-flex items-center align-bottom mx-1"><img src="${char.avatarUrl}" class="w-4 h-4 rounded-sm object-cover mr-1 opacity-80"/>${char.name}</span>`;
                enriched = enriched.split(char.name).join(imgTag); 
            }
        });

        // 2. Replace [CardName] or 【CardName】 with Icon + Name
        // Support both [] and 「」 for skills
        const allCards = [...state.cardPool];
        (Object.values(state.characters) as Character[]).forEach(c => allCards.push(...c.skills));
        
        const uniqueCards = Array.from(new Set(allCards.map(c => c.name))).map(name => {
            return allCards.find(c => c.name === name);
        });

        uniqueCards.forEach(card => {
            if (!card || !card.imageUrl) return;
            
            // Standard bracket
            if (enriched.includes(`[${card.name}]`)) {
                const imgTag = `[<span class="inline-flex items-center align-bottom mx-0.5"><img src="${card.imageUrl}" class="w-4 h-4 rounded-sm object-cover mr-1 opacity-80"/>${card.name}</span>]`;
                enriched = enriched.split(`[${card.name}]`).join(imgTag);
            }
            // Chinese bracket
            if (enriched.includes(`「${card.name}」`)) {
                const imgTag = `「<span class="inline-flex items-center align-bottom mx-0.5"><img src="${card.imageUrl}" class="w-4 h-4 rounded-sm object-cover mr-1 opacity-80"/>${card.name}</span>」`;
                enriched = enriched.split(`「${card.name}」`).join(imgTag);
            }
        });

        // 3. Process Bolding **text**
        // In light mode, light indigo text is hard to read, so use darker purple (indigo-900)
        const boldClass = isLightMode ? "text-indigo-900 italic font-bold" : "text-indigo-300 italic";
        enriched = enriched.replace(/\*\*(.*?)\*\*/g, `<span class="${boldClass}">$1</span>`);

        return enriched;
    };

    return (
      <div className={`flex-1 flex flex-col min-w-0 relative transition-colors duration-500 bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] ${isLightMode ? 'bg-[#f9f8f4] bg-blend-exclusion' : 'bg-slate-950'}`}>
          
          <ProcessVisualizer state={state} onClearError={clearError} />
          
          {/* New Location Bar below Process Visualizer */}
          <LocationBar state={state} />

          <div className="flex-1 relative group">
            <div ref={scrollRef} className="absolute inset-0 overflow-y-auto p-4 md:p-6 space-y-4 font-serif leading-relaxed">
                {state.world.history.map((entry, i) => {
                    const line = entry.content;
                    // Robust System Message Detection
                    const isSystemLog = entry.type === 'system' || line.match(/^\[.*?\]\s*系统[:\s]/) || line.includes('---');
                    
                    // Fixed: Only extract tags that appear at the very START of the string to avoid catching skills in brackets
                    const systemTagMatch = line.match(/^\[(.*?)\]/);
                    const systemTag = systemTagMatch ? systemTagMatch[0] : "";
                    const displayContent = systemTag ? line.substring(systemTag.length) : line;

                    // Text Color Class based on Mode
                    // Light Mode: text-[#35324e] (Dark Desaturated Purple)
                    // Dark Mode: text-slate-300
                    const textClass = isSystemLog 
                        ? (isLightMode ? 'text-slate-600 text-xs italic border-l-2 border-slate-400 pl-2 py-1' : 'text-slate-500 text-xs italic border-l-2 border-slate-800 pl-2 py-1')
                        : (isLightMode ? 'text-[#35324e]' : 'text-slate-300'); 

                    return (
                    <div key={entry.id || i} className={`relative group/line animate-in fade-in slide-in-from-bottom-1 duration-300 ${textClass} pr-2 md:pr-24`}>
                        {editingLogIndex === i ? (
                            <div className="flex flex-col gap-2 bg-slate-900/50 p-2 rounded border border-indigo-500/50">
                                <TextArea 
                                    autoFocus
                                    value={editLogValue}
                                    onChange={e => setEditLogValue(e.target.value)}
                                    className="w-full min-h-[100px]"
                                />
                                <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="secondary" onClick={() => setEditingLogIndex(null)}>取消</Button>
                                    <Button size="sm" onClick={() => handleLogEdit(i, editLogValue)}>保存</Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <span className="opacity-30 text-[10px] mr-3 select-none font-mono">
                                    {systemTag}
                                    {state.devMode && entry.locationId && <span className="ml-1 text-[8px] opacity-50">[{entry.locationId.substring(0,8)}]</span>}
                                    {state.devMode && <span className="ml-1 text-[8px] opacity-30">T:{entry.turnIndex}</span>}
                                </span>
                                <span dangerouslySetInnerHTML={{__html: enrichLogText(displayContent)}}></span>
                                
                                <div className="absolute right-0 top-0 opacity-0 group-hover/line:opacity-100 flex gap-1 bg-slate-950/80 backdrop-blur px-1 rounded transition-opacity">
                                    <button onClick={() => handleBranchStory(i)} className="text-slate-500 hover:text-amber-400 p-1" title="在此处分叉 (删除后续剧情)"><Scissors size={12}/></button>
                                    <button onClick={() => { setEditingLogIndex(i); setEditLogValue(line); }} className="text-slate-500 hover:text-indigo-400 p-1"><Edit2 size={12}/></button>
                                    <button onClick={() => handleLogDelete(i)} className="text-slate-500 hover:text-red-400 p-1"><Trash2 size={12}/></button>
                                    {i === state.world.history.length - 1 && state.world.history.length > 0 && (
                                        <button onClick={handleRegenerate} className="text-slate-500 hover:text-green-400 p-1" title="撤销并重新生成"><RefreshCw size={12}/></button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )})}
                {state.world.history.length <= 1 && <div className="text-slate-600 italic text-center mt-20">创建角色并解除暂停以开始故事...</div>}
            </div>
          </div>

          {/* Bottom Control Bar */}
          <div className="shrink-0 border-t border-slate-800 bg-slate-900 p-2 flex items-center gap-2 z-30 relative">
              {/* Auto Round Popup */}
              {showAutoInput && (
                  <div className="absolute bottom-16 right-2 bg-slate-800 border border-slate-600 p-3 rounded shadow-xl flex flex-col gap-2 w-48 animate-in slide-in-from-bottom-2 z-50">
                      <div className="text-xs font-bold text-slate-300">设置自动轮次数量</div>
                      <div className="flex gap-2">
                          <Input 
                              type="number" 
                              value={autoRoundInput} 
                              onChange={e => setAutoRoundInput(e.target.value)}
                              className="h-8 text-xs"
                              autoFocus
                          />
                          <Button size="sm" onClick={confirmAutoRounds}>确认</Button>
                      </div>
                      <div className="text-[10px] text-slate-500">结束后自动暂停</div>
                  </div>
              )}

              <Button 
                  variant="secondary" 
                  onClick={togglePause} 
                  className={`flex-1 h-10 flex items-center justify-center gap-2 text-sm font-bold border transition-all
                      ${!state.round.isPaused ? 'border-amber-500 text-amber-400 bg-amber-900/10' : 'border-green-600 text-green-400 bg-green-900/10 hover:bg-green-900/30'}
                  `}
              >
                  {!state.round.isPaused ? (
                      <><Pause size={18}/> 暂停</>
                  ) : (
                      <><Play size={18}/> 继续</>
                  )}
              </Button>

              <Button 
                  variant="secondary"
                  onClick={() => updateState(s => ({ ...s, round: { ...s.round, autoReaction: !s.round.autoReaction } }))}
                  className={`w-24 h-10 flex items-center justify-center gap-1 border-slate-700 transition-all ${state.round.autoReaction ? 'bg-teal-900/30 text-teal-400 border-teal-500' : 'text-slate-400 hover:text-slate-200'}`}
                  title={state.round.autoReaction ? "玩家角色将自动使用AI反应" : "玩家角色需手动输入反应"}
              >
                  <Zap size={16} className={state.round.autoReaction ? "fill-teal-400" : ""}/> 
                  <span className="text-xs">{state.round.autoReaction ? "自动反应" : "手动反应"}</span>
              </Button>

              <Button 
                  variant="secondary"
                  onClick={handleAutoRoundClick}
                  className={`w-24 h-10 flex items-center justify-center gap-1 border-slate-700 transition-all ${state.round.autoAdvanceCount && state.round.autoAdvanceCount > 0 ? 'bg-blue-900/30 text-blue-400 border-blue-500' : 'text-slate-400 hover:text-slate-200'}`}
                  title="自动进行多轮"
              >
                  {state.round.autoAdvanceCount && state.round.autoAdvanceCount > 0 ? (
                      <span className="font-mono font-bold animate-pulse">{state.round.autoAdvanceCount} 轮</span>
                  ) : (
                      <><FastForward size={18}/> 自动</>
                  )}
              </Button>

              <Button 
                  variant="secondary" 
                  onClick={handleStopRound} 
                  className="w-16 h-10 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/20 border-slate-700"
                  title="中止本轮 / 清空自动队列"
              >
                  <Square size={18} className="fill-current"/>
              </Button>
          </div>
      </div>
    );
};
