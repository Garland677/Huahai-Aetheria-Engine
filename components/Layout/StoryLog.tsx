
import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { GameState, Character, GamePhase, LogEntry, GameImage, WindowState } from '../../types';
import { Button, TextArea, Input, Label } from '../ui/Button';
import { Trash2, Scissors, Edit2, ListOrdered, User, CheckCircle, Check, AlertCircle, Pause, FastForward, X, ArrowDown, Book, BookOpen, ChevronDown, ChevronRight, ChevronUp, MapPin, Play, Zap, Square, MessageSquare } from 'lucide-react';
import { ImageUploadModal } from '../Modals/ImageUploadModal';
import { ModelQueueIndicator } from '../ui/ModelQueueIndicator';
import { Window } from '../ui/Window';
import { marked } from 'marked';
import { StreamBus } from '../../services/streamService';

interface StoryLogProps {
    state: GameState;

    updateState: (updater: (current: GameState) => GameState) => void;
    onConfirm: (title: string, msg: string, action: () => void) => void;
    onRollback: (index: number) => void; 
    onRegenerate: (index: number) => void; 
    onStopExecution: () => void;
    onUnveil?: (logs: string[], charIds: string[], intent?: string) => void; 
    openWindow?: (type: WindowState['type'], data?: any) => void; // New Prop
    onSkipPlayerTurn?: () => void; // Added for Next Button
}

// ... CharacterSelectorModal component (unchanged) ...
const CharacterSelectorModal: React.FC<{
    state: GameState,
    onConfirm: (ids: string[], intent: string) => void,
    onCancel: () => void
}> = ({ state, onConfirm, onCancel }) => {
    const activeLocId = state.map.activeLocationId;
    const localChars = (Object.values(state.characters) as Character[]).filter(c => 
        state.map.charPositions[c.id]?.locationId === activeLocId
    );
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [intent, setIntent] = useState("");

    const toggle = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    return (
        <Window
            title={<span className="flex items-center gap-2 text-primary"><BookOpen size={18}/> 选择揭露对象</span>}
            onClose={onCancel}
            maxWidth="max-w-md"
            height="h-auto"
            zIndex={200}
            noPadding={true}
            footer={
                <div className="flex justify-end gap-2 w-full">
                    <Button variant="secondary" onClick={onCancel} size="sm">取消</Button>
                    <Button 
                        onClick={() => onConfirm(Array.from(selectedIds), intent)}
                        disabled={selectedIds.size === 0}
                        className="bg-primary hover:bg-primary-hover text-primary-fg border-transparent"
                        size="sm"
                    >
                        确认揭露
                    </Button>
                </div>
            }
        >
            <div className="p-4 flex flex-col gap-4">
                <p className="text-xs text-muted">请选择要补充回忆的当前地点角色。</p>
                
                <div className="flex-1 overflow-y-auto space-y-1 bg-surface-light/50 p-2 rounded border border-border custom-scrollbar min-h-[150px] max-h-[40vh]">
                    {localChars.map(char => {
                        const isSel = selectedIds.has(char.id);
                        return (
                            <div 
                                key={char.id} 
                                onClick={() => toggle(char.id)}
                                className={`flex items-center gap-3 p-2 rounded cursor-pointer border transition-colors ${isSel ? 'bg-primary/20 border-primary/50' : 'bg-surface/50 border-border hover:bg-surface-highlight'}`}
                            >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSel ? 'border-primary bg-primary' : 'border-highlight'}`}>
                                    {isSel && <div className="text-primary-fg text-[10px]">✓</div>}
                                </div>
                                <div className="text-sm text-body font-bold">{char.name}</div>
                            </div>
                        )
                    })}
                    {localChars.length === 0 && <div className="text-muted text-center text-xs py-4">无可见角色</div>}
                </div>

                <div>
                    <Label>额外指示</Label>
                    <TextArea 
                        className="w-full h-24 text-xs bg-surface-light/50 border-border resize-none p-3 focus:border-primary mt-1"
                        placeholder="在此指定你想要揭露的具体细节或方向..."
                        value={intent}
                        onChange={e => setIntent(e.target.value)}
                    />
                </div>
            </div>
        </Window>
    );
};

const StreamAwareMarkdown = ({ logId, initialContent, isCompactLayout, parseFn }: { logId: string, initialContent: string, isCompactLayout: boolean, parseFn: (v: string, applyIndent: boolean) => string }) => {
    const [content, setContent] = useState(initialContent);

    useEffect(() => {
        setContent(initialContent);
    }, [initialContent]);

    useEffect(() => {
        const handleStream = (e: any) => {
             setContent(e.detail);
        };
        StreamBus.addEventListener(`stream-${logId}`, handleStream);
        return () => StreamBus.removeEventListener(`stream-${logId}`, handleStream);
    }, [logId]);

    return (
        <div 
            className={`markdown-content w-full ${isCompactLayout ? '[&_p]:!m-0 [&_blockquote]:!m-0' : 'inline-block align-top'}`} 
            style={{ 
                fontSize: isCompactLayout ? 'calc(var(--story-font-size) * 0.70)' : 'var(--story-font-size)', 
                fontWeight: 'var(--story-font-weight)',
                lineHeight: 'inherit',
                overflowWrap: 'anywhere'
            }}
            dangerouslySetInnerHTML={{__html: parseFn(content, !isCompactLayout)}}
        ></div>
    );
};

// --- Process Visualizer ---
const ProcessVisualizer = ({ state, onClearError, openWindow, getTopVisibleLogId }: { state: GameState, onClearError: () => void, openWindow?: (type: WindowState['type'], data?: any) => void, getTopVisibleLogId?: () => string | undefined }) => {
    const { phase, roundNumber, lastErrorMessage, isPaused } = state.round;
    
    // Count unsolved secrets in current location
    const activeLocId = state.map.activeLocationId;
    let unsolvedSecretsCount = 0;
    Object.values(state.characters).forEach(c => {
        if (state.map.charPositions[c.id]?.locationId === activeLocId) {
            unsolvedSecretsCount += (c.secrets || []).filter(s => !s.solved).length;
        }
    });

    // Dynamic Font Size for Round Number to prevent overflow
    const roundStr = roundNumber.toString();
    const getRoundFontSize = (len: number) => {
        if (len >= 5) return 'text-[10px]';
        if (len >= 4) return 'text-xs';
        if (len >= 3) return 'text-sm';
        return 'text-lg';
    };

    return (
        <div className="bg-surface border-b border-border shadow-md z-30 flex flex-col shrink-0 relative">
            <div className="flex items-center justify-between px-3 py-2 h-14">
                <div className="flex items-center gap-2 md:gap-4 overflow-x-auto scrollbar-hide max-w-full h-full">
                    {/* ROUND BOX */}
                    <div className="flex flex-col items-center justify-center bg-black/20 px-2 rounded border border-border shrink-0 h-10 min-w-[3rem] overflow-hidden">
                        <span className="text-[7px] text-muted uppercase font-bold tracking-wider leading-none mb-0.5">Round</span>
                        <span className={`${getRoundFontSize(roundStr.length)} font-mono font-bold text-endorphin leading-none`}>
                            {roundStr}
                        </span>
                    </div>
                    
                    {isPaused && (
                         <div className="flex items-center justify-center text-endorphin bg-endorphin/10 rounded animate-pulse shrink-0 border border-endorphin/30 h-8 w-8" title="已暂停 (PAUSED)">
                             <Pause size={16}/>
                         </div>
                    )}

                    <div className="h-6 w-px bg-border mx-1 shrink-0"></div>

                    <div className="flex items-center gap-1 min-w-[100px]">
                        {/* Placeholder for future buttons */}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {/* Reading Mode Button */}
                    <button
                        onClick={() => {
                            if (openWindow) {
                                const topId = getTopVisibleLogId ? getTopVisibleLogId() : undefined;
                                openWindow('reading_mode', { 
                                    title: '故事全文', 
                                    content: state.world.history, 
                                    type: 'history',
                                    initialLogId: topId
                                });
                            }
                        }}
                        className="flex items-center justify-center p-2 rounded bg-surface border border-border text-muted hover:text-primary hover:border-primary transition-all active:scale-95 h-10 w-10"
                        title="阅读模式"
                    >
                        <BookOpen size={16}/>
                    </button>

                    {/* Puzzle Entry Point */}
                    <button 
                        onClick={() => openWindow && openWindow('puzzle')}
                        className={`
                            flex items-center gap-2 px-3 py-1.5 rounded border h-10 transition-all hover:brightness-110 active:scale-95
                            ${unsolvedSecretsCount > 0 
                                ? 'bg-primary border-primary text-primary-fg shadow-lg shadow-primary/20' 
                                : 'bg-surface border-border text-muted hover:border-primary/50'
                            }
                        `}
                        title="点击打开解谜窗口"
                    >
                        <div className="flex flex-col items-start leading-none">
                            <span className="text-xs font-bold">解谜</span>
                            {unsolvedSecretsCount > 0 && <span className="text-[9px] opacity-80">{unsolvedSecretsCount} 个线索</span>}
                        </div>
                    </button>
                </div>
            </div>

            {/* Error Message Display */}
            {lastErrorMessage && (
                <div className="bg-red-900/20 border-t border-red-900/50 px-4 py-2 flex items-center gap-2 text-xs text-danger-fg animate-in slide-in-from-top-1">
                    <AlertCircle size={14} className="shrink-0"/>
                    <span className="font-mono flex-1">{lastErrorMessage}</span>
                    <button 
                        onClick={onClearError}
                        className="p-1 hover:bg-red-900/30 rounded text-danger-fg hover:text-red-200 transition-colors"
                        title="关闭报错信息"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
        </div>
    );
};

// ... Location Bar Component (unchanged) ...
const LocationBar = ({ state, openWindow }: { state: GameState, openWindow?: (type: WindowState['type'], data?: any) => void }) => {
    // Re-paste LocationBar code for completeness if needed, or assume unchanged parts are kept.
    const locId = state.map.activeLocationId;
    const location = locId ? state.map.locations[locId] : null;
    const regionName = location && location.regionId && state.map.regions[location.regionId] 
        ? state.map.regions[location.regionId].name 
        : "未知区域";
    
    const isLocked = state.appSettings.lockedFeatures?.locationEditor;

    const handlePinClick = (e: React.MouseEvent) => {
        if (isLocked || !location || !openWindow) return;
        e.stopPropagation();
        openWindow('location_edit', location);
    };

    const bgRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        let frameId: number;
        let lastTime = 0;
        const FPS = 15;
        const INTERVAL = 1000 / FPS;
        const DURATION = 30000; 

        const animate = (time: number) => {
            frameId = requestAnimationFrame(animate);
            if (time - lastTime < INTERVAL) return;
            lastTime = time;

            if (bgRef.current) {
                const t = time % (DURATION * 2);
                const phase = (t / (DURATION * 2)) * Math.PI * 2;
                const progress = (1 - Math.cos(phase)) / 2; 
                bgRef.current.style.backgroundPosition = `center ${progress * 100}%`;
            }
        };

        frameId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(frameId);
    }, []);
    
    return (
        <div className="relative h-12 w-full overflow-hidden border-b border-border bg-app shrink-0 group z-20">
            <div 
                ref={bgRef}
                className="absolute inset-0 opacity-60 bg-no-repeat transition-opacity duration-500"
                style={{ 
                    backgroundImage: location?.avatarUrl ? `url(${location.avatarUrl})` : 'none',
                    backgroundSize: '100% auto',
                    willChange: 'background-position',
                    filter: 'blur(0px)'
                }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/40 to-black/90 pointer-events-none" />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-right z-10 flex flex-col items-end justify-center h-full pointer-events-none">
                <div 
                    className="text-sm md:text-base font-black text-black uppercase tracking-widest leading-none mb-0.5"
                    style={{ 
                        textShadow: '-1px -1px 0 #0d9488, 1px -1px 0 #0d9488, -1px 1px 0 #0d9488, 1px 1px 0 #0d9488' 
                    }}
                >
                    {regionName} - {location ? location.name : "未知地点"}
                </div>
            </div>
            <div 
                className={`absolute left-4 top-1/2 -translate-y-1/2 text-white/50 z-20 p-2 rounded transition-colors ${!isLocked && location ? 'cursor-pointer hover:bg-white/10 hover:text-white' : ''}`}
                onClick={handlePinClick}
                title={!isLocked && location ? "编辑地点信息" : "当前地点"}
            >
                <MapPin size={24} />
            </div>
        </div>
    );
};

export const StoryLog: React.FC<StoryLogProps> = ({ state, updateState, onConfirm, onRollback, onRegenerate, onStopExecution, onUnveil, openWindow, onSkipPlayerTurn }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollAnchorRef = useRef<{ id: string, offset: number } | null>(null);
    const previousScrollHeightRef = useRef<number>(0);

    const [editingLogIndex, setEditingLogIndex] = useState<number | null>(null);
    const [editLogValue, setEditLogValue] = useState("");
    const [editLogHeight, setEditLogHeight] = useState<number | null>(null);
    const [focusedLogIndex, setFocusedLogIndex] = useState<number | null>(null);
    const [expandedSystemGroups, setExpandedSystemGroups] = useState<Set<string>>(new Set());
    
    const [showAutoInput, setShowAutoInput] = useState(false);
    const [autoRoundInput, setAutoRoundInput] = useState("5");

    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const [isStickToBottom, setIsStickToBottom] = useState(true);

    const [isUnveilMode, setIsUnveilMode] = useState(false);
    const [selectedUnveilIndices, setSelectedUnveilIndices] = useState<Set<number>>(new Set());
    const [showCharSelector, setShowCharSelector] = useState(false);
    const [multiDeleteConfirm, setMultiDeleteConfirm] = useState(false);

    const [editingImageInfo, setEditingImageInfo] = useState<{ logIndex: number, image: GameImage } | null>(null);

    // --- PAGINATION STATE ---
    const visibleRoundCount = 10; // Fixed window for now, can be state if dynamic loading is re-implemented differently
    
    const isLightMode = state.appSettings.storyLogLightMode;
    const isAutoScrollEnabled = state.appSettings.autoScrollOnNewLog ?? false;

    // --- LOAD DETECTION (Load/Reset) ---
    // Detect when the game has been reset or a new save loaded by checking the first log ID.
    // Ideally this would be a session ID, but checking the root history object change is sufficient if we catch it right.
    const startLogId = state.world.history[0]?.id;

    useEffect(() => {
        // When the first log ID changes (New Game or Load), force reset view to latest
        setIsStickToBottom(true);
        
        // Wait for render cycle to complete before scrolling
        setTimeout(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        }, 50);
    }, [startLogId]);

    // --- HISTORY SLICING LOGIC ---
    // Modified: Load more dynamically
    const [historyLimit, setHistoryLimit] = useState(10);
    
    const visibleHistory = useMemo(() => {
        const fullHistory = state.world.history;
        if (fullHistory.length === 0) return [];

        const currentRound = fullHistory[fullHistory.length - 1].round;
        const minRound = Math.max(1, currentRound - historyLimit + 1);

        return fullHistory.filter(log => log.round >= minRound);
    }, [state.world.history, historyLimit]);

    // --- HELPER: Get Top Visible Log ID ---
    const getTopVisibleLogId = () => {
        if (!scrollRef.current) return undefined;
        const container = scrollRef.current;
        const top = container.scrollTop;
        
        const children = Array.from(container.children) as HTMLElement[];
        
        for (const child of children) {
            const elTop = child.offsetTop;
            const elBottom = elTop + child.offsetHeight;
            if (elBottom >= top) {
                return child.id;
            }
        }
        return undefined;
    };

    // --- SCROLL HANDLER (Pagination) ---
    const handleScroll = () => {
        if (scrollRef.current) {
            const container = scrollRef.current;
            const { scrollTop, scrollHeight, clientHeight } = container;
            
            // Check stick to bottom status
            const distToBottom = scrollHeight - scrollTop - clientHeight;
            const isStick = distToBottom < 100;
            setShowScrollBottom(!isStick);
            setIsStickToBottom(isStick);

            // Load More Logic: If close to top and not showing all
            if (scrollTop < 50) {
                const totalRounds = state.world.history[state.world.history.length - 1]?.round || 0;
                if (historyLimit < totalRounds) {
                    // Record previous height to maintain scroll position after render
                    previousScrollHeightRef.current = scrollHeight;
                    // Load 10 more rounds
                    setHistoryLimit(prev => prev + 10);
                }
            }
        }
    };

    const scrollToBottom = () => {
        // Reset visible count to 10 when manually jumping to bottom to save performance
        setHistoryLimit(10);
        setIsStickToBottom(true);
        
        // Wait for render to apply trim, then scroll
        setTimeout(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            }
        }, 50);
    };

    // --- AUTO TRIM & SCROLL ADJUSTMENT ---
    const lastHistoryRef = useRef<typeof visibleHistory>([]);
    
    useLayoutEffect(() => {
        if (!scrollRef.current) return;
        const container = scrollRef.current;

        let historyChanged = false;
        if (lastHistoryRef.current !== visibleHistory) {
            historyChanged = true;
            lastHistoryRef.current = visibleHistory;
        }

        // 1. Maintain Scroll Position after "Load More" (Prepending content)
        if (previousScrollHeightRef.current > 0) {
            const newScrollHeight = container.scrollHeight;
            const diff = newScrollHeight - previousScrollHeightRef.current;
            if (diff > 0) {
                container.scrollTop += diff;
            }
            previousScrollHeightRef.current = 0; // Reset
        }
        // 2. Auto-scroll to bottom if new content added AND sticky mode is on
        else if (isAutoScrollEnabled && isStickToBottom && editingLogIndex === null) {
            // Only snap to bottom if the history reference actually changed in this render.
            // This prevents a sudden jump when the user merely scrolls past the isStickToBottom threshold.
            if (historyChanged) {
                container.scrollTop = container.scrollHeight;
            }
        }

    }, [visibleHistory, isAutoScrollEnabled, isStickToBottom, editingLogIndex]);


    // --- Log Actions ---
    const handleLogEdit = (index: number, newValue: string) => {
        // Note: index passed here is relative to visibleHistory.
        // We need to find the real index in global history.
        // Use Log ID to find it safely.
        const logId = visibleHistory[index].id;

        updateState(prev => {
            const newHistory = prev.world.history.map(l => 
                l.id === logId ? { ...l, content: newValue } : l
            );
            return { ...prev, world: { ...prev.world, history: newHistory } };
        });
        setEditingLogIndex(null);
        setFocusedLogIndex(null);
    };

    const handleLogDelete = (index: number) => {
        const logId = visibleHistory[index].id;
        const globalIndex = state.world.history.findIndex(l => l.id === logId);

        if (globalIndex === state.world.history.length - 1 && globalIndex > 0) {
             onRollback(globalIndex - 1);
        } else {
             updateState(prev => {
                const newHistory = prev.world.history.filter(l => l.id !== logId);
                return { ...prev, world: { ...prev.world, history: newHistory } };
            });
        }
        if (editingLogIndex === index) setEditingLogIndex(null);
        if (focusedLogIndex === index) setFocusedLogIndex(null);
    };

    const handleRegenerateAt = (index: number) => {
        const logId = visibleHistory[index].id;
        const globalIndex = state.world.history.findIndex(l => l.id === logId);
        const targetLog = state.world.history[globalIndex];

        // LOGIC UPDATE: Check Log Type
        const isSystemOrderLog = targetLog.content.includes("系统: 本轮行动顺序") || 
                                 targetLog.content.includes("系统: 手动设定轮次顺序") ||
                                 targetLog.content.includes("系统: 发现当地角色") ||
                                 targetLog.content.includes("系统: 发现新地点");
        
        // Also check if it's a "Round Start" log
        const isRoundStart = targetLog.content.match(/^--- 第 (\d+) 轮 开始 ---/);

        // If it is a System/Order/RoundStart log, we skip the review window and just execute
        if (isSystemOrderLog || isRoundStart || targetLog.type === 'system') {
            onRegenerate(globalIndex);
            setFocusedLogIndex(null);
        } else {
            // Case 2: Character Action/Reaction -> Open Review Window
            if (openWindow) {
                openWindow('review', { 
                    logIndex: globalIndex, 
                    onRegenerate: (idx: number) => {
                        onRegenerate(idx);
                        setFocusedLogIndex(null);
                    },
                    mode: 'branch' // Explicitly set mode to branch
                });
            } else {
                // Fallback if window manager not available
                onConfirm("重新生成 / 分叉", "确定要从此处分叉/重新生成吗？\n\n**此条消息**及之后的所有内容将被删除，系统将重新从本回合开始演算。", () => {
                    onRegenerate(globalIndex);
                    setFocusedLogIndex(null);
                });
            }
        }
    };

    // New: Handle Pure Comment (Annotation)
    const handleCommentAt = (index: number) => {
        const logId = visibleHistory[index].id;
        const globalIndex = state.world.history.findIndex(l => l.id === logId);

        if (openWindow) {
            openWindow('review', {
                logIndex: globalIndex,
                onRegenerate: (idx: number) => {
                    // This callback shouldn't really be called in comment mode, but pass it for type safety
                    onRegenerate(idx);
                },
                mode: 'comment' // Set mode to comment
            });
            setFocusedLogIndex(null);
        }
    };

    const togglePause = () => {
        updateState(s => ({...s, round: {...s.round, isPaused: !s.round.isPaused}}));
    };

    const handleStopRound = () => {
        onStopExecution();
    };

    const handleAutoRoundClick = () => {
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
                    isPaused: false
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

    const handleLogClick = (index: number, e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('textarea')) {
            return;
        }
        if (isUnveilMode) {
            const next = new Set(selectedUnveilIndices);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            setSelectedUnveilIndices(next);
            return;
        }
        if (focusedLogIndex === index) {
            setFocusedLogIndex(null);
        } else {
            setFocusedLogIndex(index);
        }
    };

    const handleImageUpdate = (newImage: GameImage) => {
        if (!editingImageInfo) return;
        const { logIndex } = editingImageInfo;
        const logId = visibleHistory[logIndex].id;

        updateState(prev => {
            const newHistory = prev.world.history.map(l => {
                if (l.id === logId) {
                    const updatedImages = l.images ? l.images.map(img => img.id === newImage.id ? newImage : img) : [];
                    return { ...l, images: updatedImages };
                }
                return l;
            });
            return { ...prev, world: { ...prev.world, history: newHistory } };
        });
        setEditingImageInfo(null);
    };

    const enterUnveilMode = (index: number) => {
        setIsUnveilMode(true);
        setSelectedUnveilIndices(new Set([index]));
        setFocusedLogIndex(null);
    };

    const handleUnveilConfirm = (charIds: string[], intent: string) => {
        setShowCharSelector(false);
        setIsUnveilMode(false);
        
        // Map local indices to content strings
        const logs = (Array.from(selectedUnveilIndices) as number[])
            .sort((a: number, b: number) => a - b)
            .map((i: number) => visibleHistory[i]?.content)
            .filter((s): s is string => !!s);
            
        if (onUnveil) onUnveil(logs, charIds, intent);
        setSelectedUnveilIndices(new Set());
    };
    
    const handleMultiDelete = () => {
        if (!multiDeleteConfirm) {
            setMultiDeleteConfirm(true);
            setTimeout(() => setMultiDeleteConfirm(false), 2000);
            return;
        }
        
        const idsToDelete = new Set<string>();
        selectedUnveilIndices.forEach(idx => {
            if (visibleHistory[idx]) idsToDelete.add(visibleHistory[idx].id);
        });

        updateState(prev => ({
            ...prev,
            world: {
                ...prev.world,
                history: prev.world.history.filter(l => !idsToDelete.has(l.id))
            }
        }));
        setIsUnveilMode(false);
        setSelectedUnveilIndices(new Set());
        setMultiDeleteConfirm(false);
    };

    const enrichAndParseText = (text: string, applyIndent: boolean = false) => {
        let enriched = text;
        enriched = enriched.replace("text-slate-400 italic", "italic");
        enriched = enriched.replace(/([^\n])\n(- |\* |\d+\. )/g, '$1\n\n$2');
        
        // Escape tilde to prevent markdown strikethrough interpretation
        enriched = enriched.replace(/~/g, '&#126;');

        // Characters matching
        const showAvatarsInLog = state.appSettings.showAvatarsInLog;
        const matchingChars = (Object.values(state.characters) as Character[])
            .filter(char => enriched.includes(char.name) && (showAvatarsInLog ? char.avatarUrl !== undefined : true));
        matchingChars.sort((a, b) => b.name.length - a.name.length);

        if (matchingChars.length > 0) {
            const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Change regex to capture the optional @ so we can preserve it
            const pattern = new RegExp(`(@?)(${matchingChars.map(c => escapeRegExp(c.name)).join('|')})`, 'g');
            enriched = enriched.replace(pattern, (match, atSymbol, charName) => {
                const char = matchingChars.find(c => c.name === charName);
                if (char) {
                    if (showAvatarsInLog && char.avatarUrl) {
                        return `<span class="inline-flex items-center align-bottom" style="color: var(--dopamine-log)">${atSymbol}<img src="${char.avatarUrl}" class="w-4 h-4 rounded-sm object-cover mx-0.5 opacity-80 bg-black/50"/>${char.name}</span>`;
                    } else {
                        // Return with @ preserved
                        return `<span style="color: var(--dopamine-log)">${atSymbol}${char.name}</span>`;
                    }
                }
                return match; // fallback
            });
        }

        const allCards = [...state.cardPool];
        (Object.values(state.characters) as Character[]).forEach(c => allCards.push(...c.skills));
        const uniqueCards = Array.from(new Set(allCards.map(c => c.name))).map(name => {
            return allCards.find(c => c.name === name);
        });
        uniqueCards.forEach(card => {
            if (!card || !card.imageUrl) return;
            if (enriched.includes(`[${card.name}]`)) {
                const imgTag = `[<span class="inline-flex items-center align-bottom mx-0.5"><img src="${card.imageUrl}" class="w-4 h-4 rounded-sm object-cover mr-1 opacity-80 bg-black/50"/>${card.name}</span>]`;
                enriched = enriched.split(`[${card.name}]`).join(imgTag);
            }
            if (enriched.includes(`「${card.name}」`)) {
                const imgTag = `「<span class="inline-flex items-center align-bottom mx-0.5"><img src="${card.imageUrl}" class="w-4 h-4 rounded-sm object-cover mr-1 opacity-80 bg-black/50"/>${card.name}</span>」`;
                enriched = enriched.split(`「${card.name}」`).join(imgTag);
            }
        });

        try {
             let html = marked.parse(enriched, { breaks: true, gfm: true }) as string;
             if (applyIndent && html) {
                 html = html.replace(/<p>/g, '<p>&nbsp;&nbsp;&nbsp;&nbsp;');
                 html = html.replace(/<br\s*\/?>/g, '<br/>&nbsp;&nbsp;&nbsp;&nbsp;');
                 // Add for blockquotes if they also start a line
                 html = html.replace(/<blockquote>/g, '<blockquote>&nbsp;&nbsp;&nbsp;&nbsp;');
             }
             if (!html) return enriched;
             return html;
        } catch (e) {
             return enriched;
        }
    };

    const isSystemEntry = (entry: LogEntry) => {
        const line = entry.content;
        // Fix: Use strict check or start match. 
        // includes('---') was too aggressive and matched markdown tables.
        return entry.type === 'system' || 
               !!line.match(/^\[.*?\]\s*系统[:\s]/) || 
               line.trim().startsWith('---');
    };

    // --- Grouping Logic applied to Visible History ---
    interface GroupedLogs { type: 'single' | 'group'; id: string; items: Array<{ entry: LogEntry, index: number }>; }
    const groupedHistory = useMemo(() => {
        const result: GroupedLogs[] = [];
        let currentGroup: Array<{ entry: LogEntry, index: number }> = [];

        visibleHistory.forEach((entry, i) => {
            const isSystem = isSystemEntry(entry);
            if (isSystem) {
                currentGroup.push({ entry, index: i });
            } else {
                if (currentGroup.length > 0) {
                    result.push({ type: 'group', id: `${currentGroup[0].entry.id}-${currentGroup[0].index}`, items: currentGroup });
                    currentGroup = [];
                }
                result.push({ type: 'single', id: `${entry.id}-${i}`, items: [{ entry, index: i }] });
            }
        });
        if (currentGroup.length > 0) {
            result.push({ type: 'group', id: `${currentGroup[0].entry.id}-${currentGroup[0].index}`, items: currentGroup });
        }
        return result;
    }, [visibleHistory]);

    const toggleGroup = (groupId: string) => {
        const next = new Set(expandedSystemGroups);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        setExpandedSystemGroups(next);
    };

    const renderLogItem = (entry: LogEntry, i: number, isGrouped: boolean = false, extraClass: string = '', expandButton?: React.ReactNode) => {
        const line = entry.content;
        const isSystemLog = isSystemEntry(entry);
        const isQuoteLog = line.trim().startsWith('>');
        const isCompactLayout = isSystemLog || isQuoteLog;
        const systemTagMatch = line.match(/^\[(.*?)\]/);
        const systemTag = systemTagMatch ? systemTagMatch[0] : "";
        let displayContent = (systemTag ? line.substring(systemTag.length) : line).trim();

        // --- HIDDEN ROUND MASKING ---
        if (entry.snapshot?.isHiddenRound) {
             const isPlayerInvolved = (entry.snapshot.currentOrder || []).some(id => {
                 const char = state.characters[id];
                 return char && char.isPlayer;
             });
             
             const showContent = state.appSettings.showHiddenRoundContent;
             
             if (!isPlayerInvolved && !showContent) {
                 // Replace all non-whitespace characters with block char
                 displayContent = displayContent.replace(/[^\s\n]/g, '█');
                 // Add a small hint if content exists
                 if (displayContent.length > 0) {
                     displayContent += " (被隐藏)";
                 }
             }
        }

        const textClass = isSystemLog ? 'text-muted italic py-0' : ''; 
        const isFocused = focusedLogIndex === i;
        const isSelectedForUnveil = selectedUnveilIndices.has(i);

        const isOrderLog = line.includes("系统: 本轮行动顺序") || 
                           line.includes("系统: 手动设定轮次顺序") ||
                           (line.includes("--- 第") && line.includes("轮 开始 ---"));

        // Check if this log is the start of a character's action output (including Environment)
        let isActionStart = !isSystemLog;
        
        if (isActionStart) {
            for (let k = i - 1; k >= 0; k--) {
                const pLog = visibleHistory[k];
                if (!pLog) break;
                
                // If previous log has different round or turn, then this IS the start (relative to this turn)
                if (pLog.round !== entry.round || pLog.turnIndex !== entry.turnIndex) {
                    break;
                }

                // If previous log is same turn AND not system, then current is NOT start (it's a continuation)
                if (pLog.type !== 'system') {
                    isActionStart = false;
                    break;
                }
            }
        }

        const isBranchablePoint = isOrderLog || isActionStart;
        const domId = entry.id || `log-item-${i}`;

        return (
            <div 
                id={domId}
                key={`${entry.id || i}-${i}`} 
                className={`
                    relative animate-in fade-in slide-in-from-bottom-1 duration-300 transition-colors rounded ${textClass} pr-2
                    ${isFocused ? 'bg-primary/10 ring-1 ring-primary/20' : ''}
                    ${isSelectedForUnveil ? 'bg-primary/10 ring-1 ring-primary/40' : ''}
                    ${isUnveilMode ? 'cursor-pointer hover:bg-white/5' : ''}
                    ${extraClass}
                `}
                onClick={(e) => handleLogClick(i, e)}
            >
                {editingLogIndex === i ? (
                    <div className="relative">
                        <TextArea 
                            autoFocus
                            value={editLogValue}
                            onChange={e => setEditLogValue(e.target.value)}
                            className="w-full resize-y bg-surface-light border border-primary/50 rounded focus:border-primary focus:ring-1 focus:ring-primary p-2"
                            style={{ 
                                minHeight: editLogHeight ? `${Math.max(editLogHeight, 40)}px` : '100px',
                                fontSize: isCompactLayout ? 'calc(var(--story-font-size) * 0.70)' : 'var(--story-font-size)',
                                fontWeight: 'var(--story-font-weight)',
                                lineHeight: 'inherit'
                            }}
                        />
                        <div className="absolute right-0 -top-8 z-20 flex gap-1 bg-surface-highlight border border-border shadow-xl px-2 py-1 rounded-t-lg rounded-bl-lg items-center animate-in slide-in-from-bottom-2 fade-in">
                            <button 
                                onClick={(e) => { e.stopPropagation(); setEditingLogIndex(null); }}
                                className="text-muted hover:text-dopamine p-1 rounded hover:bg-surface transition-colors"
                                title="取消"
                            >
                                <X size={14}/>
                            </button>
                            <div className="w-px h-3 bg-border mx-0.5"></div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleLogEdit(i, editLogValue); }}
                                className="text-muted hover:text-dopamine p-1 rounded hover:bg-surface transition-colors"
                                title="保存"
                            >
                                <Check size={14}/>
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {isFocused && !isUnveilMode && (
                            <div className="absolute right-0 -top-8 z-20 flex gap-1 bg-surface-highlight border border-border shadow-xl px-2 py-1 rounded-t-lg rounded-bl-lg items-center animate-in slide-in-from-bottom-2 fade-in">
                                {isBranchablePoint && (
                                    <>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleRegenerateAt(i); }} 
                                            className="text-muted hover:text-dopamine p-1 rounded hover:bg-surface transition-colors" 
                                            title="分支/审阅"
                                        >
                                            <Scissors size={14}/>
                                        </button>
                                        <div className="w-px h-3 bg-border mx-0.5"></div>
                                    </>
                                )}
                                {/* Comment Button (Always visible) */}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleCommentAt(i); }} 
                                    className="text-muted hover:text-accent-teal p-1 rounded hover:bg-surface transition-colors"
                                    title="批注 (仅评论)"
                                >
                                    <MessageSquare size={14}/>
                                </button>
                                <div className="w-px h-3 bg-border mx-0.5"></div>
                                
                                <button 
                                    onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setEditingLogIndex(i); 
                                        setEditLogValue(line);
                                        const el = document.getElementById(domId);
                                        if (el) setEditLogHeight(el.offsetHeight);
                                    }} 
                                    className="text-muted hover:text-dopamine p-1 rounded hover:bg-surface transition-colors"
                                    title="编辑内容"
                                >
                                    <Edit2 size={14}/>
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleLogDelete(i); }} 
                                    className="text-muted hover:text-dopamine p-1 rounded hover:bg-surface transition-colors"
                                    title="删除此条"
                                >
                                    <Trash2 size={14}/>
                                </button>
                                <div className="w-px h-3 bg-border mx-0.5"></div>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); enterUnveilMode(i); }} 
                                    className="text-muted hover:text-dopamine p-1 rounded hover:bg-surface transition-colors"
                                    title="揭露"
                                >
                                    <Book size={14}/>
                                </button>
                            </div>
                        )}

                        <div className={`flex gap-2 ${isCompactLayout ? 'items-center' : ''}`}>
                            {isUnveilMode && (
                                <div className={`${isCompactLayout ? '' : 'mt-1'} w-4 h-4 border rounded flex items-center justify-center shrink-0 ${isSelectedForUnveil ? 'bg-primary border-primary' : 'border-highlight'}`}>
                                    {isSelectedForUnveil && <div className="text-white text-[10px]">✓</div>}
                                </div>
                            )}
                            {expandButton && (
                                <div className={`shrink-0 flex -ml-1 ${isCompactLayout ? 'items-center' : 'items-start mt-0.5'}`}>
                                    {expandButton}
                                </div>
                            )}
                            <div className={`flex-1 min-w-0 ${isSystemLog ? 'border-l-2 border-border pl-2' : ''}`}>
                                <div>
                                    {systemTag && (
                                        <span className="opacity-30 text-[10px] mr-3 select-none font-mono text-muted">
                                            {systemTag}
                                            {state.devMode && entry.locationId && <span className="ml-1 text-[8px] opacity-50">[{entry.locationId.substring(0,8)}]</span>}
                                            {state.devMode && <span className="ml-1 text-[8px] opacity-30">T:{entry.turnIndex}</span>}
                                        </span>
                                    )}
                                    <StreamAwareMarkdown 
                                        logId={entry.id}
                                        initialContent={displayContent}
                                        isCompactLayout={isCompactLayout}
                                        parseFn={enrichAndParseText}
                                    />
                                </div>
                                
                                {entry.images && entry.images.length > 0 && (
                                    <div className="flex flex-wrap gap-3 mt-3">
                                        {entry.images.map((img, idx) => (
                                            <div 
                                                key={idx} 
                                                className="relative group w-48 md:w-64 border border-border rounded-lg overflow-hidden bg-black/20 flex flex-col cursor-pointer hover:border-primary transition-colors shadow-sm"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingImageInfo({ logIndex: i, image: img });
                                                }}
                                            >
                                                <div className="w-full relative bg-black/50 flex items-center justify-center">
                                                    <img 
                                                        src={img.base64} 
                                                        alt={img.description} 
                                                        className="w-full h-auto max-h-96 object-contain"
                                                    />
                                                </div>
                                                <div className="bg-surface-light/80 p-2 text-xs text-body border-t border-border/50 text-center">
                                                    {img.description || "无描述"}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        );
    };

    const getNextCharText = () => {
        const { currentOrder, turnIndex } = state.round;
        const nextIndex = turnIndex + 1;
        if (nextIndex >= currentOrder.length) {
            return "下轮";
        }
        const nextCharId = currentOrder[nextIndex];
        if (nextCharId.startsWith('env_')) {
            return "环境";
        }
        return state.characters[nextCharId]?.name || "未知";
    };
    const nextCharText = getNextCharText();

    const activeCharId = state.round.currentOrder[state.round.turnIndex];
    const activeChar = state.characters[activeCharId];
    const isPlayerTurn = activeChar?.isPlayer && state.round.phase === 'char_acting';

    const handleNextAction = () => {
        if (!isPlayerTurn) return;
        if (onSkipPlayerTurn) {
            onSkipPlayerTurn();
        }
    };

    return (
      <div 
        className="flex-1 flex flex-col min-w-0 relative transition-colors duration-500 font-medium"
        style={{ backgroundColor: 'var(--bg-story)', color: 'var(--text-story)' }}
      >
          <div className={`absolute inset-0 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')] ${isLightMode ? 'opacity-25' : 'opacity-100'}`} />

          {showCharSelector && (
              <CharacterSelectorModal 
                  state={state} 
                  onConfirm={handleUnveilConfirm} 
                  onCancel={() => setShowCharSelector(false)} 
              />
          )}

          {editingImageInfo && (
              <ImageUploadModal 
                  initialImage={editingImageInfo.image}
                  onClose={() => setEditingImageInfo(null)}
                  onConfirm={handleImageUpdate}
              />
          )}

          <ProcessVisualizer state={state} onClearError={clearError} openWindow={openWindow} getTopVisibleLogId={getTopVisibleLogId} />
          <LocationBar state={state} openWindow={openWindow} />

          <div className="flex-1 relative group">
            <ModelQueueIndicator />

            <div 
                ref={scrollRef} 
                className="absolute inset-0 overflow-y-auto p-4 md:p-6 font-serif leading-relaxed pt-14 flex flex-col"
                onScroll={handleScroll}
            >
                {/* Loader Indicator when paging available */}
                {historyLimit < (state.world.history[state.world.history.length - 1]?.round || 0) && (
                    <div className="text-center text-xs text-muted py-2 opacity-50 shrink-0">
                        下滑以加载更多...
                    </div>
                )}
                
                {groupedHistory.map((group, currentIdx) => {
                    let spaceTop = currentIdx === 0 ? "mt-0" : "mt-1";
                    
                    if (group.type === 'single') {
                        return renderLogItem(group.items[0].entry, group.items[0].index, false, spaceTop);
                    }
                    const isExpanded = expandedSystemGroups.has(group.id);
                    const firstItem = group.items[0];
                    const expandBtn = group.items.length > 1 ? (
                        <button 
                            onClick={(e) => { e.stopPropagation(); toggleGroup(group.id); }}
                            className="text-muted opacity-50 hover:opacity-100 p-0.5 hover:bg-surface-highlight rounded transition-all"
                            title={isExpanded ? "收起" : `展开 (${group.items.length - 1} 条更多)`}
                        >
                            {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                        </button>
                    ) : undefined;

                    return (
                        <div key={group.id} className={`relative group/system flex flex-col ${spaceTop}`}>
                             <div className="relative shrink-0">
                                {renderLogItem(firstItem.entry, firstItem.index, true, '', expandBtn)}
                             </div>
                             {isExpanded && group.items.length > 1 && (
                                 <div className="pl-6 border-l border-border/30 animate-in slide-in-from-top-1 fade-in duration-200 shrink-0">
                                     {group.items.slice(1).map((item) => (
                                         renderLogItem(item.entry, item.index, true)
                                     ))}
                                 </div>
                             )}
                        </div>
                    );
                })}
                {state.world.history.length <= 1 && <div className="text-faint italic text-center mt-20 shrink-0">创建角色并解除暂停以开始故事...</div>}
            </div>

            <div className="absolute bottom-4 right-6 z-40 flex items-center justify-end gap-2 animate-bounce pointer-events-none">
                <button
                    onClick={handleNextAction}
                    disabled={!isPlayerTurn}
                    className={`bg-app/80 backdrop-blur-md border border-border text-primary rounded-full px-4 py-2 shadow-lg transition-colors flex items-center justify-center pointer-events-auto ${isPlayerTurn ? 'hover:bg-surface-highlight cursor-pointer' : 'cursor-not-allowed'}`}
                    title={isPlayerTurn ? "跳过回合 / 下一位" : "当前为非玩家回合"}
                >
                    <span className="text-sm font-bold whitespace-nowrap">{nextCharText}</span>
                </button>
                {showScrollBottom && (
                    <button
                        onClick={scrollToBottom}
                        className="bg-app/80 backdrop-blur-md border border-border text-primary rounded-full p-2 shadow-lg hover:bg-surface-highlight transition-colors flex items-center justify-center pointer-events-auto"
                        title="跳转至最新"
                    >
                        <ArrowDown size={20} />
                    </button>
                )}
            </div>

            {isUnveilMode && (
                <div className="absolute top-10 left-0 w-full flex justify-center pointer-events-none z-[60] animate-in slide-in-from-top-2 fade-in">
                    <div className="glass-panel !rounded-full !shadow-lg flex items-center gap-3 px-4 py-2 border-primary/30 pointer-events-auto">
                        <span className="text-xs font-bold text-body hidden sm:block whitespace-nowrap">已选择 {selectedUnveilIndices.size} 条记录</span>
                        <button 
                            onClick={() => setShowCharSelector(true)}
                            className="bg-primary hover:bg-primary-hover text-primary-fg px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 transition-colors whitespace-nowrap shadow-sm"
                            disabled={selectedUnveilIndices.size === 0}
                        >
                            <BookOpen size={14}/> 揭露 {selectedUnveilIndices.size > 0 && <span className="sm:hidden">({selectedUnveilIndices.size})</span>}
                        </button>
                        
                        <div className="w-px h-4 bg-primary/30"></div>
                        <button
                            onClick={handleMultiDelete}
                            className={`px-3 py-1 rounded-full flex items-center justify-center transition-all shadow-sm ${multiDeleteConfirm ? 'bg-danger text-white' : 'bg-surface hover:bg-danger/20 text-muted hover:text-danger-fg'}`}
                            title="删除选中 (双击确认)"
                            disabled={selectedUnveilIndices.size === 0}
                        >
                            <Trash2 size={14} className={multiDeleteConfirm ? "animate-pulse" : ""} />
                        </button>

                        <div className="w-px h-4 bg-primary/30"></div>
                        <button 
                            onClick={() => { setIsUnveilMode(false); setSelectedUnveilIndices(new Set()); setMultiDeleteConfirm(false); }}
                            className="text-muted hover:text-body transition-colors"
                        >
                            <X size={16}/>
                        </button>
                    </div>
                </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border bg-surface p-2 flex items-center gap-2 z-30 relative">
              {showAutoInput && (
                  <>
                      <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setShowAutoInput(false)} />
                      <div className="absolute bottom-16 right-0 mr-2 bg-surface-highlight border border-highlight p-3 rounded shadow-xl flex flex-col gap-2 w-auto min-w-[180px] animate-in slide-in-from-bottom-2 z-50">
                          <div className="text-xs font-bold text-body">设置自动轮次数量</div>
                          <div className="flex gap-2">
                              <Input 
                                  type="number" 
                                  value={autoRoundInput} 
                                  onChange={e => setAutoRoundInput(e.target.value)}
                                  className="h-8 text-xs w-20"
                                  autoFocus
                              />
                              <Button size="sm" onClick={confirmAutoRounds} className="flex-1">确认</Button>
                          </div>
                          <div className="text-[10px] text-muted">结束后自动暂停</div>
                      </div>
                  </>
              )}

              <button 
                  onClick={togglePause} 
                  className="flex-1 h-10 flex items-center justify-center gap-2 text-sm font-bold bg-surface border border-border text-muted hover:text-highlight hover:bg-surface-highlight rounded transition-all"
                  title={state.round.isPaused ? "继续游戏" : "暂停游戏"}
              >
                  {!state.round.isPaused ? (
                      <><Pause size={18}/> 暂停</>
                  ) : (
                      <><Play size={18}/> 继续</>
                  )}
              </button>

              <button 
                  onClick={() => updateState(s => ({ ...s, round: { ...s.round, autoReaction: !s.round.autoReaction } }))}
                  className={`w-24 h-10 flex items-center justify-center gap-1 border rounded transition-all hover:bg-surface-highlight hover:text-highlight ${state.round.autoReaction ? 'text-primary font-bold border-primary bg-surface' : 'text-muted border-border bg-surface'}`}
                  title={state.round.autoReaction ? "玩家角色将自动使用AI反应" : "玩家角色需手动输入反应"}
              >
                  <Zap size={16} className="text-primary"/>
                  <span className="text-xs">{state.round.autoReaction ? "自动反应" : "手动反应"}</span>
              </button>

              <button 
                  onClick={handleAutoRoundClick}
                  className={`w-24 h-10 flex items-center justify-center gap-1 border rounded transition-all hover:bg-surface-highlight ${state.round.autoAdvanceCount && state.round.autoAdvanceCount > 0 ? 'bg-primary/20 text-primary border-primary' : 'text-muted border-border bg-surface'}`}
                  title="自动进行多轮"
              >
                  {state.round.autoAdvanceCount && state.round.autoAdvanceCount > 0 ? (
                      <span className="font-mono font-bold animate-pulse text-primary">{state.round.autoAdvanceCount} 轮</span>
                  ) : (
                      <><FastForward size={18}/> 自动</>
                  )}
              </button>

              <button 
                  onClick={handleStopRound} 
                  className="w-16 h-10 flex items-center justify-center rounded bg-surface border border-border text-muted hover:text-highlight hover:bg-surface-highlight transition-all"
                  title="中止本轮 / 丢弃正在进行的AI请求"
              >
                  <Square size={18} className="fill-current"/>
              </button>
          </div>
      </div>
    );
};
