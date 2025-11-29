
import React, { useState, useMemo } from 'react';
import { GameState, WindowState, GameAttribute, Character } from '../../types';
import { Edit2, User, Coins, ListOrdered, Trash2, Lock, MessageSquare, Heart, Activity, Zap, Smile } from 'lucide-react';
import { getCharacterMemory } from '../../services/aiService';
import { TextArea } from '../ui/Button';

interface RightPanelProps {
    selectedCharId: string | null;
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    openWindow: (type: WindowState['type'], data?: any) => void;
    onToggleManualOrder?: (val: boolean) => void; 
    setSelectedCharId?: (id: string) => void;
}

// Robust attribute getter with aliases
const getAttrValue = (char: Character, key: string, fallback: number = 0): number => {
    if (!char || !char.attributes) return fallback;
    
    // 1. Direct match
    if (char.attributes[key]) return Number(char.attributes[key].value);
    
    // 2. Alias map (English <-> Chinese)
    const map: Record<string, string> = {
        'health': '健康', '健康': 'health',
        'cp': '创造点', '创造点': 'cp',
        'status': '状态', '状态': 'status',
        'physique': '体能', '体能': 'physique',
        'pleasure': '快感', '快感': 'pleasure',
        'energy': '能量', '能量': 'energy'
    };
    
    if (map[key] && char.attributes[map[key]]) {
        return Number(char.attributes[map[key]].value);
    }
    
    // 3. Case insensitive search
    const lower = key.toLowerCase();
    const foundKey = Object.keys(char.attributes).find(k => k.toLowerCase() === lower);
    if (foundKey) return Number(char.attributes[foundKey].value);
    
    return fallback;
};

export const RightPanel: React.FC<RightPanelProps> = ({ selectedCharId, state, updateState, openWindow, setSelectedCharId }) => {
    
    // Logic to recover order from history if current state is empty
    const displayOrder = useMemo(() => {
        if (state.round.currentOrder.length > 0) return state.round.currentOrder;

        // Scan history backwards for the last valid order log
        const history = state.world.history;
        for (let i = history.length - 1; i >= 0; i--) {
            const content = history[i].content;
            // Match logs like "系统: 本轮行动顺序...: [Name1, Name2]" or "系统: 手动...: [Name1]"
            const match = content.match(/顺序.*\[(.*?)\]/);
            if (match) {
                const namesOrIds = match[1].split(',').map(s => s.trim()).filter(s => s);
                const charMap = Object.values(state.characters);
                const recoveredIds: string[] = [];
                
                namesOrIds.forEach(val => {
                    // 1. Try ID Match
                    if (state.characters[val]) {
                        recoveredIds.push(val);
                        return;
                    }
                    // 2. Try Name Match (Prefer Player > NPC)
                    const candidates = charMap.filter(c => c.name === val);
                    if (candidates.length > 0) {
                        const player = candidates.find(c => c.isPlayer);
                        recoveredIds.push(player ? player.id : candidates[0].id);
                    }
                });
                
                // Only return if we found valid IDs
                if (recoveredIds.length > 0) return recoveredIds;
            }
        }
        return [];
    }, [state.round.currentOrder, state.world.history, state.characters]);

    const isHistoricalView = state.round.currentOrder.length === 0 && displayOrder.length > 0;

    return (
        <div className="w-full lg:w-72 bg-slate-950 border-l border-slate-800 flex flex-col z-0 shadow-xl h-full">
            {/* Top Control Bar for Manual Order & Skip Settlement (Fixed at top) */}
            <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex flex-col gap-3 shrink-0">
                <div className="flex items-center gap-2 text-slate-400 text-xs font-bold uppercase tracking-wider">
                    <ListOrdered size={14}/> 轮次控制
                </div>
                <div className="flex justify-between">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none">
                        <div className="relative">
                            <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={state.round.useManualTurnOrder || false}
                                onChange={(e) => {
                                    const event = new CustomEvent('update_manual_order', { detail: e.target.checked });
                                    window.dispatchEvent(event);
                                }}
                            />
                            <div className="w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                        </div>
                        手动判定
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none" title="行动后直接结束轮次，不进行结算">
                        <div className="relative">
                            <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={state.round.skipSettlement || false}
                                onChange={(e) => {
                                    updateState(s => ({ ...s, round: { ...s.round, skipSettlement: e.target.checked } }));
                                }}
                            />
                            <div className="w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-600"></div>
                        </div>
                        跳过结算
                    </label>
                </div>
            </div>

            {/* Combined Scrollable Area for Order List AND Character Details */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                
                {/* Turn Order List Section */}
                <div className="p-3 border-b border-slate-800 bg-slate-900/50">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex justify-between items-center">
                        <span>{isHistoricalView ? "上轮顺序 (回顾)" : "当前轮次顺序"} ({displayOrder.length})</span>
                        <span className="text-slate-600">{!isHistoricalView ? `Turn ${state.round.turnIndex + 1}` : "Ended"}</span>
                    </div>
                    
                    {displayOrder.length === 0 ? (
                        <div className="text-center text-xs text-slate-600 py-2 italic">等待判定...</div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {displayOrder.map((id, idx) => {
                                const char = state.characters[id];
                                if (!char) return null;
                                const isActive = !isHistoricalView && idx === state.round.turnIndex;
                                
                                // Fetch all 4 attributes
                                const hp = getAttrValue(char, '健康');
                                const physique = getAttrValue(char, '体能');
                                const cp = getAttrValue(char, 'cp');
                                const pleasure = getAttrValue(char, '快感');
                                
                                const isDead = hp <= 0 && !char.id.startsWith('env_');

                                return (
                                    <div 
                                        key={`${id}-${idx}`}
                                        onClick={() => {
                                            if (setSelectedCharId) setSelectedCharId(id);
                                        }}
                                        className={`
                                            flex items-center gap-2 p-1.5 rounded border cursor-pointer transition-colors relative
                                            ${isActive 
                                                ? 'bg-indigo-900/40 border-indigo-500/50 shadow-sm z-10' 
                                                : 'bg-slate-900 border-slate-800 hover:border-slate-600'
                                            }
                                            ${selectedCharId === id ? 'ring-1 ring-indigo-400' : ''}
                                            ${isDead ? 'opacity-50 grayscale' : ''}
                                        `}
                                    >
                                        <div className="w-4 text-center text-[9px] font-mono text-slate-500 shrink-0">{idx + 1}</div>
                                        <div className="w-8 h-8 rounded bg-slate-800 overflow-hidden border border-slate-700 shrink-0">
                                            {char.avatarUrl ? <img src={char.avatarUrl} className="w-full h-full object-cover"/> : <User className="p-1 w-full h-full text-slate-500"/>}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                            <div className={`text-xs font-bold leading-none truncate ${isActive ? 'text-indigo-300' : 'text-slate-300'}`}>{char.name}</div>
                                            
                                            {/* 4 Attributes Row */}
                                            <div className="flex items-center gap-2 mt-1 w-full overflow-hidden">
                                                <div className="flex items-center gap-0.5 text-[8px] text-red-400" title="健康 (Health)">
                                                    <Activity size={8}/> {hp}
                                                </div>
                                                <div className="flex items-center gap-0.5 text-[8px] text-blue-400" title="体能 (Physique)">
                                                    <Zap size={8}/> {physique}
                                                </div>
                                                <div className="flex items-center gap-0.5 text-[8px] text-pink-400" title="快感 (Pleasure)">
                                                    <Heart size={8}/> {pleasure}
                                                </div>
                                                <div className="flex items-center gap-0.5 text-[8px] text-yellow-500" title="创造点 (CP)">
                                                    <Coins size={8}/> {cp}
                                                </div>
                                            </div>
                                        </div>
                                        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 animate-pulse"></div>}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Character Detail Section */}
                <div className="p-5">
                    {(!selectedCharId || !state.characters[selectedCharId]) ? (
                        <div className="flex flex-col items-center justify-center text-slate-500 text-sm h-40 italic">
                            请选择一个角色以查看详情
                        </div>
                    ) : (
                        <CharacterDetail 
                            char={state.characters[selectedCharId]} 
                            state={state} 
                            openWindow={openWindow} 
                            updateState={updateState}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

const CharacterDetail: React.FC<{ char: Character, state: GameState, openWindow: any, updateState: any }> = ({ char, state, openWindow, updateState }) => {
    const isLocked = state.appSettings.lockedFeatures?.characterEditor;

    const cpValue = getAttrValue(char, 'cp', 0);
    const pleasureValue = getAttrValue(char, '快感', 50);

    return (
    <>
        <div className="flex justify-end mb-4">
            <button 
                onClick={() => !isLocked && openWindow('char', char)} 
                disabled={isLocked}
                className={`flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded ${isLocked ? 'text-slate-600 cursor-not-allowed' : 'text-slate-500 hover:text-indigo-400 hover:bg-slate-900'}`}
            >
                {isLocked ? <Lock size={12}/> : <Edit2 size={12}/>} 编辑
            </button>
        </div>
        
        <div className="flex flex-col items-center mb-4 relative">
            <div className="w-24 h-24 rounded-full bg-slate-900 mb-2 overflow-hidden border-4 border-slate-800 shadow-2xl group">
                    {char.avatarUrl ? 
                    <img src={char.avatarUrl} className="w-full h-full object-cover transition-transform group-hover:scale-110 pixelated" style={{ imageRendering: 'pixelated' }}/> 
                    : <User className="w-full h-full p-6 text-slate-700"/>}
            </div>
            
            <div className="text-slate-500 font-mono text-[10px] mb-2 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-800/50">
                ID: {char.id}
            </div>

            <h2 className="text-xl font-bold text-slate-200 text-center leading-tight">{char.name}</h2>
            
            {char.isFollowing && (
                <div className="mt-2 text-[10px] bg-indigo-900/30 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/30 flex items-center gap-1">
                    跟随模式 (Following)
                </div>
            )}
        </div>

        <div className="flex justify-center gap-2 mb-6">
                <div className="bg-yellow-900/20 border border-yellow-900/50 px-3 py-1 rounded flex items-center gap-2 text-yellow-400 font-mono text-sm" title="创造点 (Creation Points)">
                    <Coins size={14}/> {cpValue} CP
                </div>
                <div className="bg-pink-900/20 border border-pink-900/50 px-3 py-1 rounded flex items-center gap-2 text-pink-400 font-mono text-sm" title="快感 (Pleasure)">
                    <Heart size={14}/> {pleasureValue}
                </div>
        </div>

        <div className="space-y-4">
            <p className="text-xs text-slate-400 italic leading-relaxed bg-slate-900/50 p-3 rounded border border-slate-800">
                "{char.description}"
            </p>

            {/* Character Memory Section */}
            <div className="flex-1 flex flex-col min-h-[200px]">
                <h4 className="text-xs font-bold text-indigo-500 uppercase border-b border-indigo-900/30 pb-2 mb-2 flex items-center gap-2">
                    <MessageSquare size={12}/> 角色记忆 (Memory)
                </h4>
                <TextArea 
                    readOnly 
                    value={getCharacterMemory(state.world.history, char.id, state.map.activeLocationId, state.appSettings.maxCharacterMemoryRounds) || "(暂无相关记忆)"} 
                    className="w-full h-64 font-serif text-xs leading-relaxed bg-black/30 text-slate-400 resize-none border-slate-800 focus:border-slate-700"
                />
            </div>
        </div>
    </>
    );
};
