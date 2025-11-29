
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GameState, Character, MapLocation, PrizePool, Card, PrizeItem } from '../../types';
import { Button, TextArea, Input, Label } from '../ui/Button';
import { Send, Target, Ban, Loader2, Plus, Trash2, ArrowRight, X, ShoppingCart, Navigation, MessageSquare, AlertCircle, Gift, Eye, Download, Upload, CheckCircle, Clock } from 'lucide-react';
import { PendingAction } from '../../hooks/useEngine';
import { DurationPicker } from '../ui/DurationPicker';

interface PlayerControlsProps {
    state: GameState;
    activeCharId: string;
    playerInput: string;
    setPlayerInput: (val: string) => void;
    selectedCardId: string | null;
    setSelectedCardId: (val: string | null) => void;
    selectedTargetId: string | null;
    setSelectedTargetId: (val: string | null) => void;
    submitPlayerTurn: (timePassed: number) => void; 
    isProcessingAI?: boolean;
    pendingActions?: PendingAction[];
    setPendingActions?: (actions: PendingAction[]) => void;
    onOpenShop?: () => void;
    reactionRequest?: {
        isOpen: boolean;
        message: string;
        title: string;
        charId: string;
        resolve: (response: string | null) => void;
    } | null;
    onRespondToReaction?: (response: string | null) => void;
}

// --- LOTTERY MODAL COMPONENT (PORTAL) ---
const LotteryModal: React.FC<{
    state: GameState,
    activeChar: Character,
    pendingCounts: Record<string, number>,
    onClose: () => void,
    onConfirm: (actionType: 'draw'|'deposit'|'peek', poolId: string, amount?: number, cardIds?: string[]) => void
}> = ({ state, activeChar, pendingCounts, onClose, onConfirm }) => {
    const [selectedPoolId, setSelectedPoolId] = useState<string>("");
    const [mode, setMode] = useState<'draw' | 'deposit' | 'peek'>('draw');
    const [drawAmount, setDrawAmount] = useState(1);
    const [peekAmount, setPeekAmount] = useState(1);
    
    const [selectedDepositIndices, setSelectedDepositIndices] = useState<Set<number>>(new Set());
    const [quickDepositCount, setQuickDepositCount] = useState(0);

    const locId = state.map.charPositions[activeChar.id]?.locationId;
    const localPools = (Object.values(state.prizePools) as PrizePool[]).filter(p => p.locationIds && p.locationIds.includes(locId || ""));

    const activePool = selectedPoolId ? state.prizePools[selectedPoolId] : null;

    React.useEffect(() => {
        if (!selectedPoolId && localPools.length > 0) setSelectedPoolId(localPools[0].id);
    }, [localPools]);

    const itemAvailability = useMemo(() => {
        const availability = new Array(activeChar.inventory.length).fill(true);
        const counts = { ...pendingCounts };
        activeChar.inventory.forEach((id, idx) => {
            if ((counts[id] || 0) > 0) {
                availability[idx] = false;
                counts[id]--;
            }
        });
        return availability;
    }, [activeChar.inventory, pendingCounts]);

    const maxAvailableToDeposit = itemAvailability.filter(Boolean).length;

    const toggleDepositSelection = (idx: number) => {
        const newSet = new Set(selectedDepositIndices);
        if (newSet.has(idx)) newSet.delete(idx);
        else newSet.add(idx);
        setSelectedDepositIndices(newSet);
        setQuickDepositCount(newSet.size); 
    };

    const handleQuickDepositChange = (val: number) => {
        setQuickDepositCount(val);
        const newSet = new Set<number>();
        let added = 0;
        for (let i = 0; i < activeChar.inventory.length; i++) {
            if (added >= val) break;
            if (itemAvailability[i]) {
                newSet.add(i);
                added++;
            }
        }
        setSelectedDepositIndices(newSet);
    };

    const handleConfirm = () => {
        if (!selectedPoolId) return;
        if (mode === 'draw') {
            onConfirm('draw', selectedPoolId, drawAmount);
        } else if (mode === 'deposit') {
            const idsToDeposit = Array.from(selectedDepositIndices).map(idx => activeChar.inventory[idx]);
            onConfirm('deposit', selectedPoolId, undefined, idsToDeposit);
        } else {
            onConfirm('peek', selectedPoolId, peekAmount);
        }
        onClose();
    };

    const content = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-slate-900 border border-pink-900/50 rounded-lg shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in zoom-in-95">
                <div className="p-3 bg-pink-900/20 border-b border-pink-900/30 flex justify-between items-center">
                    <span className="text-sm font-bold text-pink-400 flex items-center gap-2"><Gift size={16}/> 奖池互动</span>
                    <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={18}/></button>
                </div>
                
                {localPools.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-sm italic">当前地点无可用奖池。</div>
                ) : (
                    <div className="p-4 flex flex-col gap-4">
                        <div>
                            <Label>选择奖池</Label>
                            <select 
                                className="w-full bg-slate-950 border border-slate-700 rounded text-sm p-2 outline-none focus:border-pink-500"
                                value={selectedPoolId}
                                onChange={e => setSelectedPoolId(e.target.value)}
                            >
                                {localPools.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>

                        <div className="flex rounded bg-slate-950 p-1 border border-slate-800">
                            <button onClick={() => setMode('draw')} className={`flex-1 py-1.5 text-xs rounded font-bold transition-colors ${mode === 'draw' ? 'bg-pink-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>抽取</button>
                            <button onClick={() => setMode('deposit')} className={`flex-1 py-1.5 text-xs rounded font-bold transition-colors ${mode === 'deposit' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>放入</button>
                            <button onClick={() => setMode('peek')} className={`flex-1 py-1.5 text-xs rounded font-bold transition-colors ${mode === 'peek' ? 'bg-teal-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>查看</button>
                        </div>

                        <div className="bg-slate-950/50 rounded border border-slate-800 p-3 min-h-[120px] flex flex-col">
                            {mode === 'draw' && activePool && (
                                <div className="flex flex-col gap-3">
                                    <div className="flex justify-between text-xs text-slate-400">
                                        <span>抽取数量: <span className="text-white font-bold">{drawAmount}</span></span>
                                        <span>(限 {activePool.minDraws || 1}-{activePool.maxDraws || 1})</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min={activePool.minDraws || 1} 
                                        max={activePool.maxDraws || 1} 
                                        step={1}
                                        value={drawAmount}
                                        onChange={e => setDrawAmount(parseInt(e.target.value))}
                                        className="accent-pink-500 w-full"
                                    />
                                    <div className="text-xs text-slate-500 leading-relaxed mt-1 bg-black/20 p-2 rounded border border-slate-800/50">
                                        {activePool.description}
                                    </div>
                                </div>
                            )}

                            {mode === 'deposit' && (
                                <div className="flex-1 flex flex-col gap-2">
                                    <div className="flex justify-between text-xs text-slate-400">
                                        <span>快速选择数量: <span className="text-white font-bold">{quickDepositCount}</span></span>
                                        <span>/ {maxAvailableToDeposit} (可用)</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min={0} 
                                        max={maxAvailableToDeposit} 
                                        step={1}
                                        value={quickDepositCount}
                                        onChange={e => handleQuickDepositChange(parseInt(e.target.value))}
                                        className="accent-indigo-500 w-full mb-2"
                                    />
                                    
                                    <div className="flex-1 overflow-y-auto max-h-[120px] space-y-1 pr-1 custom-scrollbar border-t border-slate-800 pt-2">
                                        {activeChar.inventory.length === 0 && <div className="text-xs text-slate-600 text-center mt-4">背包为空</div>}
                                        {maxAvailableToDeposit === 0 && activeChar.inventory.length > 0 && <div className="text-xs text-slate-600 text-center mt-4">所有物品均已在行动队列中</div>}
                                        
                                        {activeChar.inventory.map((id, idx) => {
                                            if (!itemAvailability[idx]) return null;
                                            
                                            const card = state.cardPool.find(c => c.id === id);
                                            if(!card) return null;
                                            const isSelected = selectedDepositIndices.has(idx);
                                            return (
                                                <div 
                                                    key={`${id}_${idx}`} 
                                                    onClick={() => toggleDepositSelection(idx)}
                                                    className={`flex items-center gap-3 p-2 rounded cursor-pointer border text-xs transition-colors ${isSelected ? 'bg-indigo-900/30 border-indigo-500 text-indigo-200' : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                                                >
                                                    {isSelected ? <CheckCircle size={14} className="text-indigo-400"/> : <div className="w-3.5 h-3.5 rounded-full border border-slate-600"/>}
                                                    <span className="truncate">{card.name}</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {mode === 'peek' && activePool && (
                                <div className="flex flex-col gap-3">
                                    <div className="flex justify-between text-xs text-slate-400">
                                        <span>尝试查看数量: <span className="text-white font-bold">{peekAmount}</span></span>
                                        <span>(限 {activePool.maxDraws || 1})</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min={1} 
                                        max={Math.min(5, activePool.maxDraws || 5)} 
                                        step={1}
                                        value={peekAmount}
                                        onChange={e => setPeekAmount(parseInt(e.target.value))}
                                        className="accent-teal-500 w-full"
                                    />
                                    <div className="text-xs text-slate-400 text-center pt-2 leading-relaxed bg-black/20 p-2 rounded">
                                        试图偷偷查看奖池内容。<br/>可能会发现物品，但不保证成功。
                                    </div>
                                </div>
                            )}
                        </div>

                        <Button onClick={handleConfirm} className="h-10 text-sm font-bold bg-pink-700 hover:bg-pink-600">
                            {mode === 'draw' ? '确认抽取' : mode === 'deposit' ? `放入选定物品 (${selectedDepositIndices.size})` : '尝试查看'}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(content, document.body);
};

export const PlayerControls: React.FC<PlayerControlsProps> = ({
    state, activeCharId, playerInput, setPlayerInput, 
    selectedCardId, setSelectedCardId, selectedTargetId, setSelectedTargetId, 
    submitPlayerTurn, isProcessingAI,
    pendingActions = [], setPendingActions,
    onOpenShop,
    reactionRequest, onRespondToReaction
}) => {
    const activeChar = state.characters[activeCharId];
    const [showLottery, setShowLottery] = useState(false);
    
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [manualTime, setManualTime] = useState({ y: 0, m: 0, d: 0, h: 0, min: 5, s: 0 });

    const formatDuration = (t: typeof manualTime) => {
        let str = "";
        if (t.y > 0) str += `${t.y}年`;
        if (t.m > 0) str += `${t.m}月`;
        if (t.d > 0) str += `${t.d}日`;
        if (t.h > 0) str += `${t.h}时`;
        if (t.min > 0) str += `${t.min}分`;
        if (t.s > 0) str += `${t.s}秒`;
        return str || "0秒";
    };

    const getTotalSeconds = (t: typeof manualTime) => {
        return t.y * 31536000 + t.m * 2592000 + t.d * 86400 + t.h * 3600 + t.min * 60 + t.s;
    };

    const handleSubmit = () => {
        const seconds = getTotalSeconds(manualTime);
        submitPlayerTurn(seconds);
    };
    
    const pendingCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        if (pendingActions) {
            pendingActions.forEach(act => {
                if (act.type === 'use_skill' && act.cardId) {
                    counts[act.cardId] = (counts[act.cardId] || 0) + 1;
                }
                if (act.type === 'lottery' && act.action === 'deposit' && act.cardIds) {
                    act.cardIds.forEach(id => {
                        counts[id] = (counts[id] || 0) + 1;
                    });
                }
            });
        }
        return counts;
    }, [pendingActions]);

    const availableCards = useMemo(() => {
        if (!activeChar) return [];
        const skills = activeChar.skills.filter(c => c.triggerType === 'active' || c.triggerType === 'reaction');
        const inventoryItems: Card[] = [];
        const tempCounts = { ...pendingCounts };

        activeChar.inventory.forEach(itemId => {
            const card = state.cardPool.find(c => c.id === itemId);
            if (card && (card.triggerType === 'active' || card.triggerType === 'reaction')) {
                if ((tempCounts[itemId] || 0) > 0) {
                    tempCounts[itemId]--;
                } else {
                    inventoryItems.push(card);
                }
            }
        });

        return [...skills, ...inventoryItems];
    }, [activeChar, state.cardPool, pendingCounts]);

    const currentSelectedCard = useMemo(() => {
        return availableCards.find(c => c.id === selectedCardId) || null;
    }, [availableCards, selectedCardId]);

    const needsTarget = useMemo(() => {
        if (!currentSelectedCard) return false;
        
        // Hardcoded check for interaction
        if (currentSelectedCard.name === '互动' || currentSelectedCard.name === 'Interact') return true;
        
        // Effects Check (Safe access)
        if (currentSelectedCard.effects && currentSelectedCard.effects.length > 0) {
            return currentSelectedCard.effects.some(e => e.targetType === 'specific_char');
        }
        
        return false;
    }, [currentSelectedCard]);

    const isPlayerTurn = activeChar?.isPlayer && state.round.phase === 'char_acting';

    if (reactionRequest && reactionRequest.isOpen) {
        const reactorName = state.characters[reactionRequest.charId]?.name || "未知角色";
        const handleReactionSubmit = () => {
            if (onRespondToReaction) {
                onRespondToReaction(playerInput);
                setPlayerInput(""); 
            }
        };

        return (
            <div className="min-h-[180px] bg-slate-900 border-t border-amber-500/30 flex flex-col shadow-[0_-4px_20px_rgba(245,158,11,0.1)] relative z-10 animate-in slide-in-from-bottom-2">
                <div className="bg-amber-900/20 border-b border-amber-900/30 p-2 flex items-start gap-2">
                    <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5"/>
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">需要反应 (Reaction Needed)</span>
                            <span className="text-[10px] text-amber-500/70 font-mono">[{reactorName}]</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed bg-black/20 p-2 rounded border border-slate-800/50 whitespace-pre-wrap max-h-20 overflow-y-auto">
                            {reactionRequest.message}
                        </p>
                    </div>
                </div>

                <div className="flex-1 p-2 flex gap-2 items-start">
                    <TextArea 
                        className="flex-1 h-full min-h-[60px] rounded-lg p-2 text-xs focus:ring-2 focus:ring-amber-500 outline-none resize-none bg-black/30 border-amber-900/30 text-slate-200"
                        placeholder={`输入 ${reactorName} 的反应台词或行动描述...`}
                        value={playerInput}
                        onChange={e => setPlayerInput(e.target.value)}
                        autoFocus
                    />
                    <Button 
                        className="h-full min-h-[60px] w-20 bg-amber-600 hover:bg-amber-500 flex flex-col gap-1 justify-center items-center border-transparent text-white shadow-lg"
                        onClick={handleReactionSubmit}
                        disabled={!playerInput.trim()}
                    >
                        <MessageSquare size={16} className="fill-current"/>
                        <span className="text-[10px] font-bold">提交反应</span>
                    </Button>
                </div>
            </div>
        );
    }

    const getTargetOptions = () => {
        const currentLocId = state.map.activeLocationId;
        return (Object.values(state.characters) as Character[])
            .filter(c => {
                const pos = state.map.charPositions[c.id];
                return pos && pos.locationId === currentLocId;
            })
            .map(c => ({ id: c.id, name: c.name }));
    };

    const getMoveOptions = () => {
        const currentLocId = state.map.charPositions[activeCharId]?.locationId;
        const currentLoc = currentLocId ? state.map.locations[currentLocId] : null;
        if (!currentLoc) return [];

        const candidates: MapLocation[] = [];
        (Object.values(state.map.locations) as MapLocation[]).forEach(loc => {
            if (loc.id === currentLocId) return;
            const dist = Math.sqrt((loc.coordinates.x - currentLoc.coordinates.x)**2 + (loc.coordinates.y - currentLoc.coordinates.y)**2);
            if (dist <= 1000 || (loc.isKnown && loc.regionId === currentLoc.regionId)) {
                candidates.push(loc);
            }
        });
        return candidates.sort((a, b) => a.name.localeCompare(b.name));
    };

    if (!activeChar && state.round.phase !== 'settlement') return null;

    const handleAddToQueue = () => {
        if (!currentSelectedCard || !setPendingActions) return;
        
        const newAction: PendingAction = {
            id: `act_${Date.now()}`,
            type: 'use_skill',
            cardId: currentSelectedCard.id,
            cardName: currentSelectedCard.name,
            targetId: selectedTargetId || undefined
        };
        
        setPendingActions([...pendingActions, newAction]);
        
        setSelectedCardId(null);
        setSelectedTargetId(null);
    };

    const handleAddMoveToQueue = (locId: string) => {
        if (!setPendingActions) return;
        const loc = state.map.locations[locId];
        if (!loc) return;

        const filteredActions = pendingActions.filter(a => a.type !== 'move_to');

        const newAction: PendingAction = {
            id: `act_move_${Date.now()}`,
            type: 'move_to',
            cardName: `移动至 [${loc.name}]`, 
            destinationId: loc.id,
            destinationName: loc.name
        };
        
        setPendingActions([...filteredActions, newAction]);
    };

    const handleAddLotteryToQueue = (actionType: 'draw'|'deposit'|'peek', poolId: string, amount?: number, cardIds?: string[]) => {
        if (!setPendingActions) return;
        
        let name = "操作奖池";
        if (actionType === 'draw') name = `抽奖 (${amount}次)`;
        if (actionType === 'deposit') name = `放入物品 (${cardIds?.length})`;
        if (actionType === 'peek') name = `查看奖池 (${amount}个)`;

        const newAction: any = { 
            id: `act_lottery_${Date.now()}`,
            type: 'lottery',
            cardName: name,
            poolId: poolId,
            action: actionType,
            amount: amount,
            cardIds: cardIds,
            isHidden: false
        };
        setPendingActions([...pendingActions, newAction]);
    };

    const handleRemoveFromQueue = (index: number) => {
        if (!setPendingActions) return;
        const newActions = [...pendingActions];
        newActions.splice(index, 1);
        setPendingActions(newActions);
    };

    const handleOpenShop = () => {
        if (onOpenShop) onOpenShop();
    };

    return (
        <div className="min-h-[180px] bg-slate-900 border-t border-indigo-900/20 flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.5)] relative z-10">
            
            {showTimePicker && (
                <DurationPicker 
                    initialDuration={manualTime}
                    onConfirm={(newVal) => { setManualTime(newVal); setShowTimePicker(false); }}
                    onCancel={() => setShowTimePicker(false)}
                />
            )}

            {isPlayerTurn && !state.round.isPaused ? (
                <div className="flex flex-col h-full p-2 gap-2">
                    
                    {showLottery && activeChar && (
                        <LotteryModal 
                            state={state} 
                            activeChar={activeChar} 
                            pendingCounts={pendingCounts}
                            onClose={() => setShowLottery(false)} 
                            onConfirm={handleAddLotteryToQueue}
                        />
                    )}

                    {pendingActions.length > 0 && (
                        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-1 border-b border-slate-800/50 px-1">
                            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider shrink-0">Queue:</span>
                            {pendingActions.map((act, idx) => {
                                const targetName = act.targetId ? state.characters[act.targetId]?.name : "";
                                const isMove = act.type === 'move_to';
                                return (
                                    <div key={act.id} className={`flex items-center gap-1 border rounded px-2 py-1 text-xs shrink-0 animate-in fade-in slide-in-from-left-2 ${isMove ? 'bg-teal-900/40 border-teal-500/30 text-teal-100' : 'bg-indigo-900/40 border-indigo-500/30 text-indigo-100'}`}>
                                        <span className="font-bold">{act.cardName}</span>
                                        {targetName && <span className="text-[10px] text-indigo-300">➜ {targetName}</span>}
                                        <button onClick={() => handleRemoveFromQueue(idx)} className="ml-1 hover:text-red-400"><X size={10}/></button>
                                        {idx < pendingActions.length - 1 && <ArrowRight size={10} className="text-slate-500 ml-1"/>}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex gap-2 items-start">
                        <div className="flex-1 flex gap-2">
                            <div className="relative flex-1">
                                <TextArea 
                                  className="w-full h-10 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                                  placeholder={`${activeChar.name} 想要说什么/做什么 (Narrative)...`}
                                  value={playerInput}
                                  onChange={e => setPlayerInput(e.target.value)}
                                  disabled={isProcessingAI}
                                />
                            </div>
                            
                            {currentSelectedCard && (
                                <Button
                                    className="h-10 w-14 bg-slate-700 hover:bg-slate-600 flex flex-col gap-0.5 justify-center animate-in zoom-in duration-200"
                                    onClick={handleAddToQueue}
                                    disabled={isProcessingAI || (needsTarget && !selectedTargetId)}
                                    title="加入行动队列"
                                >
                                    <Plus size={14}/>
                                    <span className="text-[9px]">添加</span>
                                </Button>
                            )}

                            <Button 
                                className="h-10 w-16 bg-slate-800 hover:bg-slate-700 border border-slate-600 flex flex-col gap-0.5 justify-center items-center"
                                onClick={() => setShowTimePicker(true)}
                                disabled={isProcessingAI}
                                title="调整本轮行动耗时"
                            >
                                <Clock size={14} className="text-green-400"/>
                                <span className="text-[9px] font-mono truncate max-w-full px-1">{formatDuration(manualTime)}</span>
                            </Button>

                            <Button 
                                className="h-10 w-20 bg-indigo-600 hover:bg-indigo-500 flex flex-col gap-0.5 disabled:opacity-50 disabled:cursor-not-allowed justify-center" 
                                onClick={handleSubmit}
                                disabled={isProcessingAI || (needsTarget && !selectedTargetId && pendingActions.length === 0)}
                            >
                                {isProcessingAI ? <Loader2 size={14} className="animate-spin"/> : <Send size={14} />}
                                <span className="text-[10px]">{isProcessingAI ? "执行中" : (pendingActions.length > 0 ? "执行序列" : "结束/发送")}</span>
                            </Button>
                        </div>
                        
                        <div className="flex flex-col gap-1 animate-in fade-in slide-in-from-right-4">
                            <div className="flex gap-1">
                                <Button 
                                    size="sm" 
                                    className="h-6 w-16 bg-yellow-600 hover:bg-yellow-500 text-white text-[10px] flex items-center justify-center gap-1"
                                    onClick={handleOpenShop}
                                    disabled={isProcessingAI}
                                    title="购买或创造卡牌"
                                >
                                    <ShoppingCart size={12}/> 商店
                                </Button>
                                <Button 
                                    size="sm" 
                                    className="h-6 w-16 bg-pink-600 hover:bg-pink-500 text-white text-[10px] flex items-center justify-center gap-1"
                                    onClick={() => setShowLottery(true)}
                                    disabled={isProcessingAI}
                                    title="奖池互动 (抽奖/放入)"
                                >
                                    <Gift size={12}/> 奖池
                                </Button>
                            </div>

                            <div className="w-32 relative">
                                <select 
                                    className="w-full h-6 bg-gray-950 border border-teal-500/50 text-teal-200 text-[10px] rounded px-1 focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50 appearance-none"
                                    onChange={e => {
                                        if(e.target.value) {
                                            handleAddMoveToQueue(e.target.value);
                                            e.target.value = ""; 
                                        }
                                    }}
                                    disabled={isProcessingAI}
                                >
                                    <option value="">-- 转移地点 --</option>
                                    {getMoveOptions().map(l => (
                                        <option key={l.id} value={l.id}>{l.name}</option>
                                    ))}
                                </select>
                                <Navigation size={10} className="absolute right-1 top-1.5 text-teal-500 pointer-events-none"/>
                            </div>

                            {needsTarget && (
                                <div className="w-32">
                                    <select 
                                      className="w-full h-6 bg-gray-950 border border-indigo-500/50 text-slate-200 text-[10px] rounded px-1 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50"
                                      style={{ backgroundColor: '#030712', color: '#f8fafc' }}
                                      value={selectedTargetId || ""}
                                      onChange={e => setSelectedTargetId(e.target.value)}
                                      disabled={isProcessingAI}
                                    >
                                        <option value="">-- 选择目标 --</option>
                                        {getTargetOptions().map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-x-auto flex gap-2 items-center pb-1 custom-scrollbar">
                        <div 
                          className={`h-20 w-16 rounded-lg border flex items-center justify-center cursor-pointer transition-all shrink-0 ${selectedCardId === null ? 'border-indigo-400 bg-indigo-900/20 text-indigo-200' : 'border-slate-800 bg-gray-950 text-slate-600 hover:border-slate-600'}`}
                          onClick={() => { if(!isProcessingAI) { setSelectedCardId(null); setSelectedTargetId(null); } }}
                          title="取消选择卡牌"
                        >
                             <div className="flex flex-col items-center gap-1">
                                 <Ban size={16}/>
                                 <span className="text-[9px] font-bold">取消</span>
                             </div>
                        </div>

                        {availableCards.map((card, index) => (
                            <div 
                                key={`${card?.id}_${index}`}
                                onClick={() => { if(card && !isProcessingAI) setSelectedCardId(card.id); }}
                                className={`h-20 w-16 rounded-lg border p-1 flex flex-col justify-between cursor-pointer transition-all shrink-0 relative group ${selectedCardId === card?.id ? 'border-indigo-400 bg-indigo-900/20 ring-1 ring-indigo-500' : 'border-slate-800 bg-gray-950 hover:border-slate-600'} ${isProcessingAI ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {card?.triggerType === 'reaction' && (
                                    <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500 border border-gray-900 z-10" title="反应卡牌"></div>
                                )}
                                <div className="text-[9px] font-bold text-slate-200 leading-tight line-clamp-2 text-center">{card?.name}</div>
                                
                                <div className="flex justify-center items-center mt-auto">
                                    {card?.cost ? <span className="text-[8px] text-yellow-500 font-mono flex items-center gap-0.5"><div className="w-1 h-1 bg-yellow-500 rounded-full"></div>{card.cost}</span> : <span className="text-[8px] text-slate-600">-</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-center h-full text-slate-500 gap-2 flex-col">
                    {state.round.isPaused ? (
                         <span className="flex items-center gap-2 text-sm"><Loader2 size={16} className="text-amber-500"/> 游戏暂停中</span>
                    ) : isProcessingAI ? (
                         <div className="flex flex-col items-center gap-1 animate-pulse text-indigo-400">
                             <Loader2 size={24} className="animate-spin"/>
                             <span className="font-bold text-sm tracking-widest">AI PROCESSING</span>
                         </div>
                    ) : (
                         <span className="animate-pulse text-sm">等待 {state.characters[state.round.activeCharId || '']?.name || '角色'} 行动...</span>
                    )}
                </div>
            )}
        </div>
    );
};
