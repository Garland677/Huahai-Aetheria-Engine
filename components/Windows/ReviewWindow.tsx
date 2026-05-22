
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { GameState, LogEntry, Character, AIConfig } from '../../types';
import { Window } from '../ui/Window';
import { Button, Input, TextArea } from '../ui/Button';
import { RefreshCw, Trash2, X, MessageSquare, Edit3, ShieldAlert, Check, MousePointerClick, RefreshCcw, Scissors, FileEdit } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ReviewWindowProps {
    winId: number;
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    closeWindow: (id: number) => void;
    data: {
        logIndex: number;
        onRegenerate: (index: number) => void;
        mode?: 'branch' | 'comment'; // New Mode Prop
    };
}

interface Annotation {
    id: string;
    text: string;     // The selected text
    type: 'avoid' | 'replace' | 'comment';
    content: string;  // The user input (for comment only)
    startIndex: number;
    endIndex: number;
    colorHue: number; // Random hue for background
}

export const ReviewWindow: React.FC<ReviewWindowProps> = ({ winId, state, updateState, closeWindow, data }) => {
    const { logIndex, onRegenerate, mode = 'branch' } = data;
    
    // 1. Logic to gather content for selection
    const fullTurnContent = useMemo(() => {
        const history = state.world.history;
        const targetLog = history[logIndex];
        if (!targetLog) return { raw: "", tokens: [] as string[] };

        let textToProcess = "";

        if (mode === 'comment') {
            // Comment Mode: Extract EXACTLY the content of the selected log
            // We strip HTML tags to ensure text tokenization aligns with visual selection,
            // but we keep everything else (names, punctuation) intact.
            let text = targetLog.content;
            text = text.replace(/<[^>]*>?/gm, ''); 
            textToProcess = text;
        } else {
            // Branch Mode: Extract context for AI regeneration (Legacy Logic)
            // Finds all logs belonging to the same round and turnIndex, excluding system logs
            const relevantLogs = history
                .map((l, idx) => ({ ...l, originalIndex: idx }))
                .filter(l => 
                    l.round === targetLog.round && 
                    l.turnIndex === targetLog.turnIndex && 
                    l.type !== 'system' &&
                    !l.content.startsWith('系统') &&
                    !l.content.startsWith('[系统]')
                )
                .sort((a, b) => a.originalIndex - b.originalIndex);

            // Combine content
            relevantLogs.forEach(l => {
                let text = l.content;
                // Strip HTML tags
                text = text.replace(/<[^>]*>?/gm, '');
                
                // Strip prefix if it looks like a Name (Only for Branch mode to avoid AI repetition)
                if (l.type === 'action' || l.type === 'narrative' || text.match(/^.{1,8}[:：]/)) {
                     text = text.replace(/^[^：:]{1,10}[:：]\s*/, '');
                }
                
                textToProcess += text + "\n";
            });
        }

        // Tokenize for selection (Shared logic)
        // Splits by words, newlines, or non-alphanumeric chars to make selection granular
        const regex = /[a-zA-Z0-9]+|[\n\r]|[^a-zA-Z0-9\n\r]/g;
        const result: string[] = [];
        let match;
        while ((match = regex.exec(textToProcess)) !== null) {
            result.push(match[0]);
        }
        
        return { raw: textToProcess.trim(), tokens: result };
    }, [state.world.history, logIndex, mode]);

    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [selectionRange, setSelectionRange] = useState<{start: number, end: number} | null>(null);
    const [popupPosition, setPopupPosition] = useState<{top: number, left: number} | null>(null);
    
    // Touch Logic State
    const isTouchSelecting = useRef(false);
    const touchStartIndex = useRef<number>(-1);
    
    // Mouse Logic State
    const isMouseDown = useRef(false);

    // Popup Input State
    const [popupMode, setPopupMode] = useState<'menu' | 'input'>('menu');
    const [popupComment, setPopupComment] = useState("");

    const textContainerRef = useRef<HTMLDivElement>(null);

    // Helper to find closest span with data-idx
    const findTokenIdx = (target: EventTarget | null): number => {
        let curr = target as HTMLElement;
        while (curr && curr !== textContainerRef.current) {
            if (curr.dataset && curr.dataset.idx !== undefined) {
                return parseInt(curr.dataset.idx);
            }
            curr = curr.parentElement as HTMLElement;
        }
        return -1;
    };

    // --- MOUSE SELECTION HANDLING ---
    
    // 1. Sync React state with Native Selection (Real-time highlight)
    const updateSelectionFromNative = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        // Check if selection is within our container
        if (!textContainerRef.current?.contains(selection.anchorNode)) return;

        const startIdx = findTokenIdx(selection.anchorNode);
        const focusIdx = findTokenIdx(selection.focusNode); // Use focusNode for dynamic end

        if (startIdx !== -1 && focusIdx !== -1) {
             const actualStart = Math.min(startIdx, focusIdx);
             const actualEnd = Math.max(startIdx, focusIdx);
             // Only update state if it changed to prevent excessive re-renders
             setSelectionRange(prev => {
                 if (prev && prev.start === actualStart && prev.end === actualEnd) return prev;
                 return { start: actualStart, end: actualEnd };
             });
        }
    };

    const handleMouseDown = () => {
        isMouseDown.current = true;
        setPopupPosition(null); // Hide popup
        setSelectionRange(null); // Clear previous visual selection
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        // Only update if mouse is held down
        if (isMouseDown.current && e.buttons === 1) {
            updateSelectionFromNative();
        } else {
            isMouseDown.current = false;
        }
    };

    const handleMouseUp = () => {
        isMouseDown.current = false;
        
        // Finalize
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        if (!textContainerRef.current?.contains(selection.anchorNode)) return;

        const startIdx = findTokenIdx(selection.anchorNode);
        const endIdx = findTokenIdx(selection.focusNode);

        if (startIdx !== -1 && endIdx !== -1) {
            finalizeSelection(startIdx, endIdx);
        }
    };

    // --- TOUCH SELECTION HANDLING ---
    const handleTouchStart = (e: React.TouchEvent) => {
        const idx = findTokenIdx(e.target);
        
        // Only start custom selection if touching a text token.
        // If touching padding/margin, allow native scroll.
        if (idx !== -1) {
            e.preventDefault(); // Stop scrolling
            isTouchSelecting.current = true;
            touchStartIndex.current = idx;
            setSelectionRange({ start: idx, end: idx });
            setPopupPosition(null); // Hide popup while dragging
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isTouchSelecting.current) return;
        
        // Find element under finger
        const touch = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const currentIdx = findTokenIdx(target);

        if (currentIdx !== -1) {
            const start = Math.min(touchStartIndex.current, currentIdx);
            const end = Math.max(touchStartIndex.current, currentIdx);
            setSelectionRange({ start, end });
        }
    };

    const handleTouchEnd = () => {
        if (isTouchSelecting.current) {
            isTouchSelecting.current = false;
            // If we have a valid range, calculate popup position
            if (selectionRange) {
                finalizeSelection(selectionRange.start, selectionRange.end);
            }
        }
    };

    // Common logic to finalize selection and show popup
    const finalizeSelection = (startIdx: number, endIdx: number) => {
        const actualStart = Math.min(startIdx, endIdx);
        const actualEnd = Math.max(startIdx, endIdx);
        
        setSelectionRange({ start: actualStart, end: actualEnd });
        setPopupMode('menu');
        setPopupComment("");

        // Calculate Popup Position based on the LAST selected token
        // Use DOM query because we need the visual position
        const endTokenEl = textContainerRef.current?.querySelector(`[data-idx="${actualEnd}"]`);
        if (endTokenEl) {
            const rect = endTokenEl.getBoundingClientRect();
            // Position: Centered horizontally relative to the last word, Above the word
            // Clamp to screen edges
            const top = Math.max(10, rect.top - 60);
            const left = Math.min(window.innerWidth - 250, Math.max(10, rect.left - 100)); // Approx center alignment
            
            setPopupPosition({ top, left });
        }
    };

    // Add Annotation Logic
    const confirmAnnotation = (type: 'avoid' | 'replace' | 'comment', content: string = "") => {
        if (!selectionRange) return;

        // Get selected text from tokens
        const selectedText = fullTurnContent.tokens.slice(selectionRange.start, selectionRange.end + 1).join("");
        
        const newAnn: Annotation = {
            id: `ann_${Date.now()}`,
            text: selectedText,
            type,
            content,
            startIndex: selectionRange.start,
            endIndex: selectionRange.end,
            colorHue: Math.floor(Math.random() * 360)
        };

        setAnnotations(prev => [...prev, newAnn]);
        
        // Cleanup
        window.getSelection()?.removeAllRanges();
        setSelectionRange(null);
        setPopupPosition(null);
        setPopupComment("");
        setPopupMode('menu');
    };

    // Helper: Identify which config to update based on acting character
    const getTargetConfigUpdate = (gameState: GameState): { charId?: string, isOverride: boolean } => {
        const targetLog = gameState.world.history[logIndex];
        const actingCharId = targetLog?.actingCharId;
        const char = actingCharId ? gameState.characters[actingCharId] : null;
        
        if (char && char.useAiOverride && char.aiConfig) {
            return { charId: char.id, isOverride: true };
        }
        return { isOverride: false };
    };

    // 1. Branch Regenerate (Standard)
    const confirmRegenerate = () => {
        if (annotations.length > 0) {
            // Flatten context: Remove newlines to make it a single paragraph
            const flattenedContext = fullTurnContent.raw.replace(/[\r\n]+/g, '');
            // Structure: [Quote] + Header + Opinions
            let commentsBlock = `[${flattenedContext}]\n读者对这段话的意见：\n`;
            
            annotations.forEach(ann => {
                // Flatten annotation text too to match context style
                const flatText = ann.text.replace(/[\r\n]+/g, '');
                if (ann.type === 'avoid') {
                    commentsBlock += `"${flatText}"读者要求避免\n`;
                } else if (ann.type === 'replace') {
                    commentsBlock += `"${flatText}"读者要求更换\n`;
                } else {
                    commentsBlock += `"${flatText}"读者要求：${ann.content}\n`;
                }
            });

            updateState(prev => {
                const targetInfo = getTargetConfigUpdate(prev);
                let newConfig: AIConfig;
                let newChars = prev.characters;

                if (targetInfo.isOverride && targetInfo.charId) {
                    // Update Character Config
                    const char = newChars[targetInfo.charId];
                    if (char && char.aiConfig) {
                        const currentComments = char.aiConfig.readerComments || [];
                        let newComments = [...currentComments];
                        newComments.push(commentsBlock.trim());
                        if (newComments.length > 3) newComments.shift();
                        
                        newChars = {
                            ...newChars,
                            [char.id]: {
                                ...char,
                                aiConfig: { ...char.aiConfig, readerComments: newComments }
                            }
                        };
                        return { ...prev, characters: newChars };
                    }
                } 
                
                // Fallback / Default: Update Global Behavior Config
                const currentConfig = prev.charBehaviorConfig || prev.judgeConfig; // Should exist
                if (currentConfig) {
                    const currentComments = currentConfig.readerComments || [];
                    let newComments = [...currentComments];
                    newComments.push(commentsBlock.trim());
                    if (newComments.length > 3) newComments.shift();
                    
                    return {
                        ...prev,
                        charBehaviorConfig: { ...currentConfig, readerComments: newComments }
                    };
                }

                return prev;
            });
        }
        onRegenerate(logIndex);
        closeWindow(winId);
    };

    // 2. Pure Comment (No Regenerate)
    const handlePureComment = () => {
        if (annotations.length === 0) {
            alert("请先选择文本并添加批注。");
            return;
        }

        const newComments: string[] = [];

        annotations.forEach(ann => {
            const flatText = ann.text.replace(/[\r\n]+/g, '');
            let line = "";
            if (ann.type === 'avoid') {
                line += `"${flatText}"->避免`;
            } else if (ann.type === 'replace') {
                line += `"${flatText}"->更换`;
            } else {
                line += `"${flatText}"->${ann.content}`;
            }
            newComments.push(line);
        });

        updateState(prev => {
            const targetInfo = getTargetConfigUpdate(prev);
            let newChars = prev.characters;

            if (targetInfo.isOverride && targetInfo.charId) {
                // Update Character Config
                const char = newChars[targetInfo.charId];
                if (char && char.aiConfig) {
                    const currentPure = char.aiConfig.pureComments || [];
                    let updatedList = [...currentPure, ...newComments];
                    if (updatedList.length > 20) updatedList = updatedList.slice(updatedList.length - 20);
                    
                    newChars = {
                        ...newChars,
                        [char.id]: {
                            ...char,
                            aiConfig: { ...char.aiConfig, pureComments: updatedList }
                        }
                    };
                    return { ...prev, characters: newChars };
                }
            } 
            
            // Fallback: Global Behavior
            const currentConfig = prev.charBehaviorConfig || prev.judgeConfig;
            if (currentConfig) {
                const currentPure = currentConfig.pureComments || [];
                let updatedList = [...currentPure, ...newComments];
                if (updatedList.length > 20) updatedList = updatedList.slice(updatedList.length - 20);

                return {
                    ...prev,
                    charBehaviorConfig: { ...currentConfig, pureComments: updatedList }
                };
            }
            return prev;
        });

        closeWindow(winId);
    };

    const handleBackgroundClick = () => {
        // Only clear if we are not interacting with the popup
        // The popup is in a Portal, so bubbling might be tricky, but basic click on container clears
        if (!isTouchSelecting.current) {
             // For mouse: Clear if native selection is empty (clicked outside)
             // For touch: Just clear if no popup interaction
             if (!window.getSelection()?.toString()) {
                 setPopupPosition(null);
                 setSelectionRange(null);
             }
        }
    };

    return (
        <Window
            title={mode === 'comment' ? "批注" : "分支与批注"}
            icon={mode === 'comment' ? <MessageSquare size={18}/> : <Scissors size={18}/>}
            onClose={() => closeWindow(winId)}
            maxWidth="max-w-4xl"
            height="h-[85vh]"
            zIndex={200}
            noPadding={true}
            footer={
                <div className="flex justify-between items-center w-full px-1 gap-1">
                    <div className="text-[10px] text-muted hidden sm:block">
                        已添加 <span className="font-bold text-primary">{annotations.length}</span> 条
                    </div>
                    
                    <div className="flex gap-1 flex-1 justify-end">
                         <Button variant="secondary" onClick={() => closeWindow(winId)} size="sm" className="h-7 px-2 text-[10px]">取消</Button>
                         
                         {/* Dynamic Primary Button based on Mode */}
                         {mode === 'comment' ? (
                             <Button 
                                onClick={handlePureComment} 
                                size="sm"
                                className="bg-accent-teal hover:bg-teal-500 text-white font-bold h-7 px-2 text-[10px]"
                                disabled={annotations.length === 0}
                             >
                                <FileEdit size={12} className="mr-1"/> 提交批注
                             </Button>
                         ) : (
                             <Button 
                                onClick={confirmRegenerate} 
                                size="sm" 
                                className="bg-primary hover:bg-primary-hover text-primary-fg font-bold h-7 px-2 text-[10px]"
                             >
                                <Scissors size={12} className="mr-1"/> 提交分支
                             </Button>
                         )}
                    </div>
                </div>
            }
        >
            <div className="flex flex-col h-full bg-surface" onClick={handleBackgroundClick}>
                {/* 1. Instruction Header */}
                <div className="p-3 bg-surface border-b border-border text-xs text-muted shrink-0">
                    <p className="font-bold text-primary mb-1">
                        {mode === 'comment' 
                            ? "仅添加评论供 AI 学习，不影响当前故事。" 
                            : "添加评论并重新生成当前故事分支。"
                        }
                        长按或划选文字添加批注。
                    </p>
                </div>

                {/* 2. Text Area - Scrollable Container */}
                <div 
                    className="flex-1 overflow-y-auto relative custom-scrollbar bg-surface"
                    style={{ padding: '0' }}
                >
                    {/* Centered Text Block - Only this handles selection events */}
                    {/* Added selection:bg-transparent to hide native browser blue highlight */}
                    <div 
                        ref={textContainerRef}
                        className="font-serif text-lg leading-loose text-body whitespace-pre-wrap relative max-w-3xl mx-auto select-text px-8 md:px-16 py-8 selection:bg-transparent selection:text-current"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                    >
                        {/* Text Tokens */}
                        {fullTurnContent.tokens.map((token, idx) => {
                            // Check saved annotations
                            const relevantanns = annotations.filter(a => idx >= a.startIndex && idx <= a.endIndex);
                            
                            // Check active selection range
                            const isSelecting = selectionRange && idx >= selectionRange.start && idx <= selectionRange.end;

                            // Visual Style
                            let style: React.CSSProperties = {};
                            let className = "relative rounded-sm transition-colors duration-75 ";
                            
                            // Highlighting Logic
                            if (isSelecting) {
                                className += "bg-primary text-primary-fg ";
                            } else if (relevantanns.length > 0) {
                                // Stack backgrounds for overlap
                                const bgLayers = relevantanns.map(ann => {
                                    const color = `hsla(${ann.colorHue}, 70%, 50%, 0.3)`;
                                    return `linear-gradient(${color}, ${color})`;
                                });
                                style = {
                                    backgroundImage: bgLayers.join(', '),
                                    borderBottom: `2px solid hsla(${relevantanns[relevantanns.length-1].colorHue}, 70%, 50%, 1)`,
                                };
                            }

                            return (
                                <span 
                                    key={idx} 
                                    data-idx={idx} 
                                    className={className}
                                    style={style}
                                >
                                    {token}
                                </span>
                            );
                        })}
                    </div>

                    {/* Interaction Popup (Portal) */}
                    {popupPosition && createPortal(
                        <div 
                            className="fixed z-[9999] glass-panel p-2 animate-in fade-in zoom-in-95 flex flex-col gap-2 min-w-[240px] shadow-2xl border border-border"
                            style={{ 
                                top: popupPosition.top,
                                left: popupPosition.left
                            }}
                            onPointerDown={(e) => e.stopPropagation()} // Prevent triggering selection logic
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()} // Important: Stop React bubble to background
                        >
                            {popupMode === 'menu' ? (
                                <div className="flex gap-2 justify-between">
                                    <button 
                                        onClick={() => confirmAnnotation('avoid')}
                                        className="flex-1 flex flex-col items-center gap-1 p-2 hover:bg-dopamine/20 rounded text-dopamine transition-colors group"
                                    >
                                        <ShieldAlert size={18} className="group-hover:scale-110 transition-transform"/>
                                        <span className="text-[10px] font-bold uppercase tracking-wider">避免</span>
                                    </button>
                                    <div className="w-px bg-border/50 my-1"></div>
                                    <button 
                                        onClick={() => confirmAnnotation('replace')}
                                        className="flex-1 flex flex-col items-center gap-1 p-2 hover:bg-dopamine/20 rounded text-dopamine transition-colors group"
                                    >
                                        <RefreshCcw size={18} className="group-hover:rotate-180 transition-transform"/>
                                        <span className="text-[10px] font-bold uppercase tracking-wider">更换</span>
                                    </button>
                                    <div className="w-px bg-border/50 my-1"></div>
                                    <button 
                                        onClick={() => setPopupMode('input')}
                                        className="flex-1 flex flex-col items-center gap-1 p-2 hover:bg-dopamine/20 rounded text-dopamine transition-colors group"
                                    >
                                        <MessageSquare size={18} className="group-hover:-translate-y-1 transition-transform"/>
                                        <span className="text-[10px] font-bold uppercase tracking-wider">批注</span>
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <div className="text-xs font-bold text-primary mb-1 ml-1">输入批注内容:</div>
                                    <TextArea 
                                        autoFocus
                                        placeholder="例如：我不喜欢这种风格..."
                                        value={popupComment}
                                        onChange={e => setPopupComment(e.target.value)}
                                        className="text-xs min-h-[60px] resize-none bg-black/20 border-border focus:border-primary"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                confirmAnnotation('comment', popupComment);
                                            }
                                        }}
                                    />
                                    <div className="flex justify-end gap-2">
                                        <Button size="sm" variant="secondary" onClick={() => setPopupMode('menu')} className="h-7 text-xs">返回</Button>
                                        <Button size="sm" onClick={() => confirmAnnotation('comment', popupComment)} className="h-7 text-xs bg-primary text-primary-fg hover:bg-primary-hover">
                                            <Check size={12} className="mr-1"/> 确定
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>,
                        document.body
                    )}
                </div>

                {/* 3. Annotation List */}
                <div className="h-48 border-t border-border bg-surface-highlight/10 flex flex-col shrink-0">
                    <div className="p-2 border-b border-border/50 text-xs font-bold text-muted uppercase bg-surface/50 flex justify-between items-center">
                        <span>批注列表 ({annotations.length})</span>
                        <span className="text-[9px] text-faint">提交后生效</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar bg-surface/30">
                        {annotations.length === 0 && <div className="text-center text-muted text-xs italic py-6">暂无批注，请在上方选中文字进行操作。</div>}
                        
                        {annotations.map((ann) => (
                            <div key={ann.id} className="flex items-start gap-2 bg-surface p-2 rounded border border-border group hover:border-highlight transition-colors">
                                <div 
                                    className="w-1.5 h-full min-h-[24px] rounded-full shrink-0 self-stretch" 
                                    style={{ backgroundColor: `hsl(${ann.colorHue}, 70%, 60%)` }}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-muted truncate mb-1 italic font-serif">
                                        "{ann.text}"
                                    </div>
                                    <div className="flex items-start gap-2">
                                        {/* Dopamine Colors for badges */}
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 bg-dopamine/10 text-dopamine border-dopamine/30`}>
                                            {ann.type === 'avoid' ? '避免' : ann.type === 'replace' ? '更换' : '批注'}
                                        </span>
                                        {ann.type === 'comment' && (
                                            <span className="text-xs text-body break-words font-medium">
                                                {ann.content}
                                            </span>
                                        )}
                                        {ann.type !== 'comment' && (
                                            <span className="text-[10px] text-faint">
                                                (标记为{ann.type === 'avoid' ? '避免' : '更换'})
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setAnnotations(prev => prev.filter(a => a.id !== ann.id))}
                                    className="p-1.5 text-muted hover:text-danger-fg rounded hover:bg-surface-highlight opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="删除此批注"
                                >
                                    <Trash2 size={14}/>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </Window>
    );
};
