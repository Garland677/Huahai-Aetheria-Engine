
import React, { useState, useMemo } from 'react';
import { GameState, WindowState, GameAttribute, Character } from '../../types';
import { Edit2, User, Coins, ListOrdered, Trash2, Lock, MessageSquare, Heart, Activity, Zap, Smile, Crown, Footprints, Feather, VenetianMask, FileText, BookOpen, ChevronRight, Briefcase, Eye } from 'lucide-react';
import { getCharacterMemory } from '../../services/ai/memoryUtils';

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
    const lowerKey = key.toLowerCase();
    const foundKey = Object.keys(char.attributes).find(k => k.toLowerCase() === lowerKey);
    if (foundKey) return Number(char.attributes[foundKey].value);
    
    return fallback;
};

// Hand-drawn X Overlay for Permadeath (-1 HP)
// Updated: Uses negative inset to bleed outside the container
const DeadXOverlay = () => (
    <div className="absolute -inset-1.5 flex items-center justify-center z-50 pointer-events-none select-none overflow-visible">
        <svg viewBox="0 0 100 100" className="w-full h-full text-endorphin opacity-90 filter drop-shadow-md">
            <defs>
                <filter id="brush-glow">
                    <feGaussianBlur stdDeviation="1" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <path 
                d="M 15,15 Q 50,50 85,85" 
                stroke="currentColor" 
                strokeWidth="12" 
                strokeLinecap="round" 
                fill="none"
                style={{ filter: 'url(#brush-glow)' }}
            />
             <path 
                d="M 85,15 Q 50,50 15,85" 
                stroke="currentColor" 
                strokeWidth="12" 
                strokeLinecap="round" 
                fill="none"
                style={{ filter: 'url(#brush-glow)' }}
            />
             {/* Small splatter details */}
             <circle cx="20" cy="80" r="2" fill="currentColor" />
             <circle cx="80" cy="20" r="3" fill="currentColor" />
        </svg>
    </div>
);

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
                const charMap = Object.values(state.characters) as Character[];
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

    // Logic to combine "Active Order" + "Other Characters at Location"
    const { fullList, activeIndexMap } = useMemo(() => {
        const activeLocId = state.map.activeLocationId;
        const indexMap: Record<number, number> = {};
        
        // 1. Filter the global order to ONLY keep characters at the current location
        // This solves the issue of showing previous location's characters
        const localActiveOrder: string[] = [];
        let localIdx = 0;
        
        displayOrder.forEach((id, globalIdx) => {
            const pos = state.map.charPositions[id];
            if (pos && pos.locationId === activeLocId) {
                localActiveOrder.push(id);
                indexMap[localIdx] = globalIdx;
                localIdx++;
            }
        });

        const activeSet = new Set(localActiveOrder);
        const inactiveIds: string[] = [];

        // 2. Find all OTHER characters at current location who are NOT in the active order
        if (activeLocId) {
            (Object.values(state.characters) as Character[]).forEach(c => {
                const pos = state.map.charPositions[c.id];
                if (pos && pos.locationId === activeLocId && !activeSet.has(c.id)) {
                    inactiveIds.push(c.id);
                }
            });
        }

        // Sort inactive by: Player first, then Name
        inactiveIds.sort((a, b) => {
            const cA = state.characters[a];
            const cB = state.characters[b];
            if (cA.isPlayer && !cB.isPlayer) return -1;
            if (!cA.isPlayer && cB.isPlayer) return 1;
            return (cA.name || '').localeCompare(cB.name || '');
        });

        return { 
            fullList: [...localActiveOrder, ...inactiveIds],
            activeIndexMap: indexMap
        };
    }, [displayOrder, state.map.activeLocationId, state.map.charPositions, state.characters]);

    return (
        <div className="w-full lg:w-72 bg-app border-l border-border flex flex-col z-0 shadow-xl h-full">
            {/* Top Control Bar for Manual Order & Skip Settlement (Fixed at top) */}
            <div className="p-4 border-b border-border bg-surface/30 flex flex-col gap-3 shrink-0">
                <div className="flex items-center gap-2 text-muted text-xs font-bold uppercase tracking-wider">
                    <ListOrdered size={14}/> 轮次控制
                </div>
                <div className="flex justify-between">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-muted select-none">
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
                            {/* Endorphin (Orange) for Control Toggles */}
                            <div className="w-7 h-4 bg-surface-highlight peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-endorphin"></div>
                        </div>
                        手动判定
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer text-xs text-muted select-none" title="行动后直接结束轮次，不进行结算">
                        <div className="relative">
                            <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={state.round.skipSettlement || false}
                                onChange={(e) => {
                                    updateState(s => ({ ...s, round: { ...s.round, skipSettlement: e.target.checked } }));
                                }}
                            />
                            {/* Endorphin (Orange) for Control Toggles */}
                            <div className="w-7 h-4 bg-surface-highlight peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-endorphin"></div>
                        </div>
                        跳过结算
                    </label>
                </div>
            </div>

            {/* Combined Scrollable Area for Order List AND Character Details */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                
                {/* Turn Order List Section */}
                <div className="p-3 border-b border-border bg-surface/50">
                    <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2 flex justify-between items-center">
                        <span>{isHistoricalView ? "上轮顺序 (回顾)" : "当前列表"} ({fullList.length})</span>
                        <span className="text-faint">{!isHistoricalView ? `Turn ${state.round.turnIndex + 1}` : "Ended"}</span>
                    </div>
                    
                    {fullList.length === 0 ? (
                        <div className="text-center text-xs text-faint py-2 italic">无人在此...</div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            {fullList.map((id, idx) => {
                                const char = state.characters[id];
                                if (!char) return null;
                                
                                const isEnv = id.startsWith('env_');

                                // Check if this ID is part of the GLOBAL turn order
                                const globalIdx = activeIndexMap[idx];
                                const isInOrder = globalIdx !== undefined;
                                const orderIdx = isInOrder ? globalIdx : -1;
                                
                                // Enhanced Active Check:
                                // 1. Standard Turn Index match (if not historical view)
                                const isIndexActive = !isHistoricalView && isInOrder && orderIdx === state.round.turnIndex;
                                // 2. Explicit Active ID match (Forced state, Environment Char regeneration, etc.)
                                // Note: This might highlight multiple if duplicates exist, but isIndexActive is preferred for turn flow
                                const isExplicitlyActive = state.round.activeCharId === id && (!isInOrder || isIndexActive);
                                
                                let isActive = isIndexActive || isExplicitlyActive;
                                
                                // Fetch all 4 attributes
                                const hp = getAttrValue(char, '健康');
                                const physique = getAttrValue(char, '体能');
                                const cp = getAttrValue(char, 'cp');
                                const pleasure = getAttrValue(char, '快感');
                                
                                const isDead = hp <= 0 && !isEnv;
                                const isPermadeath = hp === -1 && !isEnv; // Check for -1 specifically

                                // Style for inactive (not in turn order) chars
                                let inactiveStyle = !isInOrder ? "opacity-60 grayscale hover:opacity-100 hover:grayscale-0" : "";

                                // --- HIDDEN ROUND OBFUSCATION ---
                                const isHiddenRound = state.round.isHiddenRound;
                                const showHiddenContent = state.appSettings.showHiddenRoundContent;
                                if (isHiddenRound && !showHiddenContent) {
                                    isActive = false; // Hide active indicator
                                    inactiveStyle = "opacity-60 grayscale hover:opacity-100 hover:grayscale-0"; // Force inactive style
                                }

                                return (
                                    <div 
                                        key={`${id}-${idx}`}
                                        onClick={() => {
                                            if (setSelectedCharId) setSelectedCharId(id);
                                        }}
                                        className={`
                                            flex items-center gap-2 p-1.5 rounded border cursor-pointer transition-all relative
                                            ${isActive 
                                                ? 'bg-primary/20 border-primary/50 shadow-sm z-10' 
                                                : 'bg-surface border-border hover:border-highlight'
                                            }
                                            ${selectedCharId === id ? 'ring-1 ring-primary' : ''}
                                            ${isDead ? 'opacity-50 grayscale' : inactiveStyle}
                                        `}
                                    >
                                        <div className="w-4 text-center text-[9px] font-mono text-faint shrink-0">
                                            {isInOrder ? orderIdx + 1 : '-'}
                                        </div>
                                        
                                        {/* Avatar Container: Use relative wrapper to allow Overlay to break out of overflow */}
                                        <div className="relative shrink-0 w-8 h-8">
                                            <div className="w-full h-full rounded bg-surface-highlight overflow-hidden border border-border">
                                                {char.avatarUrl ? <img src={char.avatarUrl} className="w-full h-full object-cover"/> : <User className="p-1 w-full h-full text-muted"/>}
                                            </div>
                                            {/* Overlay moved outside of overflow-hidden div */}
                                            {isPermadeath && <DeadXOverlay />}
                                        </div>

                                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                                            <div className={`text-xs font-bold leading-none truncate ${isActive ? 'text-primary' : 'text-body'}`}>{char.name}</div>
                                            
                                            {/* Attributes Row - HIDDEN FOR ENV CHARACTERS */}
                                            {!isEnv && (
                                                <div className="flex items-center gap-2 mt-1 w-full overflow-hidden">
                                                    {/* Health -> Endorphin */}
                                                    <div className="flex items-center gap-0.5 text-[8px] text-endorphin" title="健康 (Health)">
                                                        <Activity size={8}/> {hp}
                                                    </div>
                                                    {/* Physique -> Oxytocin */}
                                                    <div className="flex items-center gap-0.5 text-[8px] text-oxytocin" title="体能 (Physique)">
                                                        <Zap size={8}/> {physique}
                                                    </div>
                                                    {/* Pleasure -> Libido */}
                                                    <div className="flex items-center gap-0.5 text-[8px] text-libido" title="快感 (Pleasure)">
                                                        <Heart size={8}/> {pleasure}
                                                    </div>
                                                    {/* CP -> Dopamine */}
                                                    <div className="flex items-center gap-0.5 text-[8px] text-dopamine" title="创造点 (CP)">
                                                        <Coins size={8}/> {cp}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        {/* Status Dots - Fixed Positions */}
                                        <div className="flex items-center gap-1 shrink-0">
                                            {char.isPlayer ? <div className="w-1.5 h-1.5 rounded-full bg-dopamine shrink-0" title="玩家角色"></div> : <div className="w-1.5 h-1.5 shrink-0"></div>}
                                            {isActive ? <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0 animate-pulse"></div> : <div className="w-1.5 h-1.5 shrink-0"></div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Character Detail Section */}
                <div className="p-5">
                    {(!selectedCharId || !state.characters[selectedCharId]) ? (
                        <div className="flex flex-col items-center justify-center text-muted text-sm h-40 italic">
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
    const isEnv = char.id.startsWith('env_');

    const cpValue = getAttrValue(char, 'cp', 0);
    const pleasureValue = getAttrValue(char, '快感', 50);
    const hpValue = getAttrValue(char, '健康', 50);
    const isPermadeath = hpValue === -1 && !isEnv;

    const togglePlayerStatus = () => {
        updateState((prev: GameState) => ({
            ...prev,
            characters: {
                ...prev.characters,
                [char.id]: {
                    ...char,
                    isPlayer: !char.isPlayer
                }
            }
        }));
    };

    const toggleFollowStatus = () => {
        updateState((prev: GameState) => ({
            ...prev,
            characters: {
                ...prev.characters,
                [char.id]: {
                    ...char,
                    isFollowing: !char.isFollowing
                }
            }
        }));
    };

    const toggleProfessionalStatus = () => {
        updateState((prev: GameState) => ({
            ...prev,
            characters: {
                ...prev.characters,
                [char.id]: {
                    ...char,
                    isProfessional: !char.isProfessional
                }
            }
        }));
    };

    const handleReadMemory = () => {
        const memory = getCharacterMemory(
            state.world.history, 
            char.id, 
            state.map.activeLocationId, 
            state.appSettings.maxCharacterMemoryRounds,
            undefined, 
            state.appSettings.maxInputTokens,
            state.characters,
            state.map.locations,
            char.previousLifeLogs // Pass legacy logs (Fix for missing imported memory)
        );

        openWindow('reading_mode', {
            title: `角色记忆: ${char.name}`,
            content: memory || "(暂无相关记忆)",
            type: 'memory'
        });
    };

    return (
    <>
        <div className="flex justify-end mb-4 gap-2">
            <button
                onClick={() => openWindow('letter', char.id)}
                className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded text-accent-teal hover:text-teal-300 hover:bg-surface border border-transparent hover:border-teal-900"
                title="书信 (Letters)"
            >
                <Feather size={14}/>
            </button>
            <button 
                onClick={() => !isLocked && openWindow('char', char)} 
                disabled={isLocked}
                className={`flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded ${isLocked ? 'text-faint cursor-not-allowed' : 'text-muted hover:text-primary hover:bg-surface'}`}
            >
                {isLocked ? <Lock size={12}/> : <Edit2 size={12}/>} 编辑
            </button>
        </div>
        
        <div className="flex flex-col items-center mb-4">
            <div className="relative">
                {/* Player Status Hat Button (Crown) - Top (Dopamine) - Hide for Env */}
                {!isEnv && (
                    <button
                        onClick={togglePlayerStatus}
                        className={`absolute -top-3 left-1/2 -translate-x-1/2 z-10 p-1 rounded-full border transition-colors shadow-md hover:scale-110 ${char.isPlayer ? 'bg-dopamine border-dopamine text-black' : 'bg-surface-highlight border-border text-muted hover:bg-surface-light'}`}
                        title={char.isPlayer ? "当前为玩家角色 (点击取消)" : "设为玩家角色"}
                    >
                        <Crown size={14} className={char.isPlayer ? "fill-current" : ""} />
                    </button>
                )}

                {/* Avatar */}
                <div className="w-24 h-24 rounded-full bg-surface overflow-hidden border-4 border-border shadow-2xl group">
                        {char.avatarUrl ? 
                        <img src={char.avatarUrl} className="w-full h-full object-cover transition-transform group-hover:scale-110 pixelated" style={{ imageRendering: 'pixelated' }}/> 
                        : <User className="w-full h-full p-6 text-muted"/>}
                </div>
                {/* Overlay moved outside of overflow-hidden div, relative to the main wrapper */}
                {isPermadeath && <DeadXOverlay />}
            </div>
            
            <div className="text-muted font-mono text-[10px] mb-2 bg-surface/50 px-2 py-0.5 rounded border border-border/50 mt-4">
                ID: {char.id}
            </div>

            <h2 className="text-xl font-bold text-body text-center leading-tight">{char.name}</h2>
            {isPermadeath && <div className="text-xs text-endorphin font-bold mt-1">【彻底死亡】</div>}
        </div>

        {/* Status Control Row - HIDDEN FOR ENV CHARACTERS */}
        {!isEnv && (
            <div className="flex flex-wrap justify-center gap-2 mb-6">
                    {/* CP -> Dopamine (Compact) */}
                    <div className="bg-dopamine/10 border border-dopamine/30 px-2 py-1 rounded flex items-center gap-1 text-dopamine font-mono text-xs h-[26px]" title="创造点 (Creation Points)">
                        <Coins size={12}/> {cpValue}
                    </div>
                    {/* Pleasure -> Libido (Compact) */}
                    <div className="bg-libido/10 border border-libido/30 px-2 py-1 rounded flex items-center gap-1 text-libido font-mono text-xs h-[26px]" title="快感 (Pleasure)">
                        <Heart size={12}/> {pleasureValue}
                    </div>
                    {/* Follow Status Button */}
                    <button
                        onClick={toggleFollowStatus}
                        className={`px-2 rounded border transition-colors shadow-sm flex items-center justify-center h-[26px] min-w-[32px] ${char.isFollowing ? 'bg-dopamine border-dopamine text-black hover:bg-dopamine/90' : 'bg-surface-highlight border-border text-muted hover:text-body'}`}
                        title={char.isFollowing ? "跟随模式已开启 (点击关闭)" : "开启跟随模式"}
                    >
                        <Footprints size={14} className={char.isFollowing ? "fill-current" : ""} />
                    </button>
                    
                    {/* Professional Mode Button - Changed to Text 'Pro' */}
                    <button
                        onClick={toggleProfessionalStatus}
                        className={`px-2 rounded border transition-colors shadow-sm flex items-center justify-center text-[10px] font-bold h-[26px] min-w-[32px] ${char.isProfessional ? 'bg-dopamine border-dopamine text-black hover:bg-dopamine/90' : 'bg-surface-highlight border-border text-muted hover:text-body'}`}
                        title={char.isProfessional ? "专业模式已开启 (点击关闭)" : "开启专业模式"}
                    >
                        Pro
                    </button>
            </div>
        )}

        <div className="space-y-4">
            {/* Description Section - Title -> Oxytocin */}
            <div className="bg-surface/30 p-3 rounded border border-border relative">
                <div className="text-[10px] font-bold text-oxytocin mb-1 flex items-center gap-1">
                    <FileText size={10}/> 设定 (Description)
                </div>
                <p className="text-xs text-muted italic leading-relaxed whitespace-pre-wrap">
                    {char.description}
                </p>
            </div>
            
            {/* Hint for Appearance */}
            <div className="flex justify-center">
                 <span className="text-[10px] text-faint flex items-center gap-1">
                    <Eye size={10}/> 外观详情请使用「观测」功能查看
                 </span>
            </div>

            {/* Character Memory Section - Replaced with Button Card */}
            <div className="mt-2">
                <button 
                    onClick={handleReadMemory}
                    className="w-full bg-surface-highlight/50 hover:bg-surface-highlight border border-border rounded-lg p-4 flex items-center justify-between group transition-all"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-primary/10 text-primary group-hover:bg-primary/20">
                            <BookOpen size={18}/>
                        </div>
                        <div className="text-left">
                            <div className="text-sm font-bold text-body group-hover:text-highlight">阅读角色记忆</div>
                            <div className="text-[10px] text-muted">点击以阅读模式查看前世今生</div>
                        </div>
                    </div>
                    <ChevronRight size={16} className="text-muted group-hover:translate-x-1 transition-transform"/>
                </button>
            </div>
        </div>
    </>
    );
};
