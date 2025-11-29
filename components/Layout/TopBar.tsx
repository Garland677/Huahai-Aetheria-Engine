
import React, { useState } from 'react';
import { GameState, WindowState } from '../../types';
import { Button } from '../ui/Button';
import { Download, Upload, Layers, Settings, User, Coins, MapPin, BookOpen, Map, Terminal, RotateCcw, Trash2, Menu, X, Lock, Gift, Clock, Pause, Play, Zap, Sun, Moon } from 'lucide-react';

interface TopBarProps {
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    openWindow: (type: WindowState['type'], data?: any) => void;
    restartGame: () => void;
    onSaveClick: () => void;
    onLoadClick: (e: React.ChangeEvent<HTMLInputElement>) => void;
    fileInputRef: React.RefObject<HTMLInputElement>;
    setSelectedCharId: (id: string) => void;
    onTogglePause?: () => void; 
    mobileView?: 'story' | 'map' | 'char';
    setMobileView?: (view: 'story' | 'map' | 'char') => void;
    onConfirm?: (title: string, msg: string, action: () => void) => void;
}

export const TopBar: React.FC<TopBarProps> = ({ 
    state, updateState, openWindow, onSaveClick, onLoadClick, fileInputRef, setSelectedCharId, mobileView, setMobileView, restartGame, onConfirm
}) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    
    const locked = state.appSettings.lockedFeatures || ({} as any);
    const isLightMode = state.appSettings.storyLogLightMode;

    const handleClearStory = () => {
        if (onConfirm) {
            onConfirm("清空故事", "确定要清空所有故事日志并重置轮次吗？(角色和地图状态将保留)", () => {
                updateState(prev => ({
                    ...prev,
                    world: { 
                        ...prev.world, 
                        history: [
                            { 
                                id: `log_cleared_${Date.now()}`, 
                                round: 1, 
                                turnIndex: 0, 
                                content: "系统: 故事记录已清空。轮次已重置为 1。", 
                                timestamp: Date.now(), 
                                type: 'system' 
                            },
                            {
                                id: `log_round_1_start_${Date.now()}`,
                                round: 1,
                                turnIndex: 0,
                                content: "--- 第 1 轮 开始 ---",
                                timestamp: Date.now() + 1,
                                type: 'system'
                            }
                        ] 
                    },
                    round: {
                        ...prev.round,
                        roundNumber: 1,
                        turnIndex: 0,
                        phase: 'init',
                        currentOrder: [],
                        activeCharId: undefined,
                        isPaused: true,
                        autoAdvanceCount: 0,
                        lastErrorMessage: undefined
                    }
                }));
            });
        }
        setIsMobileMenuOpen(false);
    };

    const handleAction = (action: () => void) => {
        action();
        setIsMobileMenuOpen(false);
    };

    const toggleLightMode = () => {
        updateState(s => ({
            ...s,
            appSettings: { ...s.appSettings, storyLogLightMode: !s.appSettings.storyLogLightMode }
        }));
    };

    return (
      <div className="h-16 bg-slate-950 border-b border-slate-800 flex items-center px-4 shadow-lg z-50 shrink-0 justify-between gap-2 relative">
         {/* Logo */}
         <div className="flex items-center shrink-0">
             <h1 className="text-xl font-bold tracking-tight text-indigo-500 hidden sm:block">花海 <span className="text-[10px] text-slate-500 align-top">v1.0</span></h1>
             <h1 className="text-lg font-bold tracking-tight text-indigo-500 sm:hidden">花海</h1>
         </div>
         
         {/* MOBILE: Navigation Tabs (Center) */}
         <div className="flex lg:hidden bg-slate-900 rounded-lg p-1 border border-slate-800 items-center gap-1">
             <button 
                onClick={() => setMobileView && setMobileView('map')}
                className={`p-2 rounded flex items-center justify-center ${mobileView === 'map' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
             >
                 <Map size={18}/>
             </button>
             <button 
                onClick={() => setMobileView && setMobileView('story')}
                className={`p-2 rounded flex items-center justify-center ${mobileView === 'story' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
             >
                 <BookOpen size={18}/>
             </button>
             <button 
                onClick={() => setMobileView && setMobileView('char')}
                className={`p-2 rounded flex items-center justify-center ${mobileView === 'char' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
             >
                 <User size={18}/>
             </button>
         </div>

         {/* Spacer to push right utilities */}
         <div className="flex-1"></div>

         {/* Right Utilities (Desktop) */}
         <div className="hidden md:flex gap-2 items-center shrink-0 z-20 bg-slate-950 pl-2">
             {/* Time Flow Toggle */}
             <button 
                onClick={() => updateState(s => ({...s, round: {...s.round, isWorldTimeFlowPaused: !s.round.isWorldTimeFlowPaused}}))} 
                className={`p-2 rounded transition-colors flex items-center gap-1 ${state.round.isWorldTimeFlowPaused ? 'text-red-400 hover:bg-red-900/20' : 'text-green-400 hover:bg-green-900/20'}`}
                title={state.round.isWorldTimeFlowPaused ? "时间已暂停 (点击恢复)" : "时间流逝中 (点击暂停)"}
             >
                 <Clock size={16}/>
                 {state.round.isWorldTimeFlowPaused ? <Pause size={12}/> : <Play size={12}/>}
             </button>

             {/* Light Mode Toggle */}
             <button
                onClick={toggleLightMode}
                className="p-2 text-slate-500 hover:text-yellow-400 hover:bg-slate-800 rounded transition-colors"
                title={isLightMode ? "切换至暗黑模式" : "切换至明亮模式 (阅读)"}
             >
                 {isLightMode ? <Moon size={16}/> : <Sun size={16}/>}
             </button>

             <div className="w-px h-4 bg-slate-800 mx-1"></div>

             <div className="flex items-center gap-1 border-r border-slate-800 pr-2 mr-2">
                 <button onClick={restartGame} className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition-colors" title="重置游戏"><RotateCcw size={16}/></button>
                 <div className="w-px h-4 bg-slate-800 mx-1"></div>
                 <button onClick={handleClearStory} className="p-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition-colors" title="清空日志与重置轮次"><Trash2 size={16}/></button>
                 <div className="w-px h-4 bg-slate-800 mx-1"></div>
                 <button onClick={onSaveClick} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded"><Download size={16}/></button>
                 <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded"><Upload size={16}/></button>
             </div>

             {state.devMode && (
                <Button size="sm" variant="secondary" onClick={() => openWindow('dev')} className="px-2 text-green-400 border-green-900/50" title="Debug Console">
                    <Terminal size={16}/>
                </Button>
             )}

             <Button size="sm" variant="secondary" onClick={() => openWindow('settings')} className="px-2 sm:px-3"><Settings size={16} /></Button>
             <div className="flex gap-2">
                 <Button 
                    size="sm" 
                    variant="secondary" 
                    onClick={() => !locked.cardPoolEditor && openWindow('pool')} 
                    className={`px-2 ${locked.cardPoolEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={locked.cardPoolEditor ? "已锁定 (Locked)" : "卡池"}
                 >
                     {locked.cardPoolEditor ? <Lock size={16}/> : <Layers size={16}/>}
                 </Button>
                 <Button 
                    size="sm" 
                    variant="secondary" 
                    onClick={() => !locked.characterEditor && openWindow('char_pool')} 
                    className={`px-2 ${locked.characterEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={locked.characterEditor ? "已锁定 (Locked)" : "角色池"}
                 >
                     {locked.characterEditor ? <Lock size={16}/> : <User size={16}/>}
                 </Button>
                 <Button 
                    size="sm" 
                    variant="secondary" 
                    onClick={() => !locked.locationEditor && openWindow('location_pool')} 
                    className={`px-2 ${locked.locationEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={locked.locationEditor ? "已锁定 (Locked)" : "地点池"}
                 >
                     {locked.locationEditor ? <Lock size={16}/> : <MapPin size={16}/>}
                 </Button>
                 <Button 
                    size="sm" 
                    variant="secondary" 
                    onClick={() => !locked.prizePoolEditor && openWindow('prize_pool')} 
                    className={`px-2 ${locked.prizePoolEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={locked.prizePoolEditor ? "已锁定 (Locked)" : "奖池 (Lottery)"}
                 >
                     {locked.prizePoolEditor ? <Lock size={16}/> : <Gift size={16}/>}
                 </Button>
                 <Button 
                    size="sm" 
                    variant="secondary" 
                    onClick={() => !locked.triggerEditor && openWindow('trigger_pool')} 
                    className={`px-2 ${locked.triggerEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={locked.triggerEditor ? "已锁定 (Locked)" : "触发器 (Triggers)"}
                 >
                     {locked.triggerEditor ? <Lock size={16}/> : <Zap size={16} className="text-yellow-400"/>}
                 </Button>
             </div>
         </div>

         {/* Mobile Menu Toggle (Visible < md) */}
         <div className="md:hidden flex items-center gap-2">
             <Button size="sm" variant="ghost" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="px-2 text-slate-400">
                 {isMobileMenuOpen ? <X size={24}/> : <Menu size={24}/>}
             </Button>
         </div>

         {/* Mobile Dropdown Menu */}
         {isMobileMenuOpen && (
             <div className="absolute top-16 right-0 w-48 bg-slate-900 border border-slate-700 shadow-2xl rounded-bl-lg z-50 flex flex-col p-2 animate-in fade-in slide-in-from-top-2 md:hidden">
                 <div className="flex flex-col gap-1 border-b border-slate-800 pb-2 mb-2">
                     {/* Mobile Time Toggle */}
                     <button 
                        onClick={() => handleAction(() => updateState(s => ({...s, round: {...s.round, isWorldTimeFlowPaused: !s.round.isWorldTimeFlowPaused}})))}
                        className={`flex items-center gap-2 p-2 rounded text-sm text-left ${state.round.isWorldTimeFlowPaused ? 'text-red-400 bg-red-900/10' : 'text-green-400 bg-green-900/10'}`}
                     >
                         <Clock size={16}/> {state.round.isWorldTimeFlowPaused ? "时间已暂停" : "时间流逝中"}
                     </button>

                     {/* Mobile Light Mode Toggle */}
                     <button 
                        onClick={() => handleAction(toggleLightMode)}
                        className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-yellow-400 text-left"
                     >
                         {isLightMode ? <><Moon size={16}/> 切换暗黑模式</> : <><Sun size={16}/> 切换明亮模式</>}
                     </button>

                     <button onClick={() => handleAction(() => openWindow('settings'))} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-200 text-left">
                         <Settings size={16}/> 设置 (Settings)
                     </button>
                     <button 
                        onClick={() => !locked.cardPoolEditor && handleAction(() => openWindow('pool'))} 
                        className={`flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-200 text-left ${locked.cardPoolEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                         {locked.cardPoolEditor ? <Lock size={16}/> : <Layers size={16}/>} 卡池 (Cards)
                     </button>
                     <button 
                        onClick={() => !locked.characterEditor && handleAction(() => openWindow('char_pool'))} 
                        className={`flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-200 text-left ${locked.characterEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                         {locked.characterEditor ? <Lock size={16}/> : <User size={16}/>} 角色池 (Chars)
                     </button>
                     <button 
                        onClick={() => !locked.locationEditor && handleAction(() => openWindow('location_pool'))} 
                        className={`flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-200 text-left ${locked.locationEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                         {locked.locationEditor ? <Lock size={16}/> : <MapPin size={16}/>} 地点池 (Locs)
                     </button>
                     <button 
                        onClick={() => !locked.prizePoolEditor && handleAction(() => openWindow('prize_pool'))} 
                        className={`flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-200 text-left ${locked.prizePoolEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                         {locked.prizePoolEditor ? <Lock size={16}/> : <Gift size={16}/>} 奖池 (Prize)
                     </button>
                     <button 
                        onClick={() => !locked.triggerEditor && handleAction(() => openWindow('trigger_pool'))} 
                        className={`flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-200 text-left ${locked.triggerEditor ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                         {locked.triggerEditor ? <Lock size={16}/> : <Zap size={16} className="text-yellow-400"/>} 触发器 (Triggers)
                     </button>
                     {state.devMode && (
                        <button onClick={() => handleAction(() => openWindow('dev'))} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-green-400 text-left">
                            <Terminal size={16}/> Debug Console
                        </button>
                     )}
                 </div>
                 <div className="flex flex-col gap-1">
                     <button onClick={() => handleAction(onSaveClick)} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-400 hover:text-white text-left">
                         <Download size={16}/> 保存进度
                     </button>
                     <button onClick={() => { fileInputRef.current?.click(); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-slate-400 hover:text-white text-left">
                         <Upload size={16}/> 读取进度
                     </button>
                     
                     <button onClick={() => handleAction(handleClearStory)} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-red-400 text-left">
                         <Trash2 size={16}/> 清空日志
                     </button>
                     <button onClick={() => handleAction(restartGame)} className="flex items-center gap-2 p-2 hover:bg-slate-800 rounded text-sm text-red-400 text-left">
                         <RotateCcw size={16}/> 重置游戏
                     </button>
                 </div>
             </div>
         )}

         {/* Hidden File Input (Moved out of conditional rendering for stability) */}
         <input type="file" ref={fileInputRef} onChange={onLoadClick} className="hidden" accept=".json" />
      </div>
    );
};