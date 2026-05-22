
import React, { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { GameState, LogEntry, Character, GameImage } from '../../types';
import { Window } from '../ui/Window';
import { BookOpen, FileText, Edit, Loader2, Download } from 'lucide-react';
import { marked } from 'marked';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

interface ReadingModeWindowProps {
    winId: number;
    state: GameState;
    closeWindow: (id: number) => void;
    openWindow: (type: any, data?: any) => void;
    data?: {
        title: string;
        content: string | LogEntry[];
        type: 'history' | 'memory';
        initialLogId?: string; // New: Optional ID to scroll to
    };
}

export const ReadingModeWindow: React.FC<ReadingModeWindowProps> = ({ 
    winId, state, closeWindow, openWindow, data 
}) => {
    const isLightMode = state.appSettings.storyLogLightMode;
    const scrollRef = useRef<HTMLDivElement>(null);
    const previousScrollHeightRef = useRef<number>(0);

    const [historyLimit, setHistoryLimit] = useState(() => {
        if (data?.type === 'history' && data.initialLogId) {
            const rawLogs = data.content as LogEntry[];
            const targetLog = rawLogs.find(l => l.id === data.initialLogId);
            if (targetLog && rawLogs.length > 0) {
                const currentRound = rawLogs[rawLogs.length - 1]?.round || 0;
                const requiredRounds = currentRound - targetLog.round + 1;
                return Math.max(10, requiredRounds);
            }
        }
        return 10;
    });

    const contentData = useMemo(() => {
        if (!data) return [];
        
        if (data.type === 'memory') {
             // Memory is a single string
             return [{
                 id: 'memory',
                 content: data.content as string,
                 type: 'narrative',
                 round: 0,
                 turnIndex: 0,
                 timestamp: Date.now()
             } as LogEntry];
        }

        // History: Filter logic
        // 1. Exclude type='system'
        // 2. Exclude content starting with "系统:" or "[系统]"
        // EXCEPTION: Keep "Round Start" system messages to act as anchors for jump
        const logs = (data.content as LogEntry[]).filter(l => {
            if (l.type === 'system') {
                if (l.content.includes("--- 第") && l.content.includes("轮 开始 ---")) return true;
                return false;
            }
            const text = l.content.trim();
            if (text.startsWith('系统:') || text.startsWith('[系统]')) return false;
            return true;
        });
        
        if (logs.length === 0) return [];
        
        const currentRound = logs[logs.length - 1].round;
        const minRound = Math.max(1, currentRound - historyLimit + 1);
        
        return logs.filter(l => l.round >= minRound);
    }, [data, historyLimit]);

    // Duplicated from StoryLog to ensure consistent rendering style
    // Added disableMarkdown param
    const enrichAndParseText = (text: string, disableMarkdown: boolean = false, applyIndent: boolean = false) => {
        let enriched = text;
        
        if (!disableMarkdown) {
            enriched = enriched.replace("text-slate-400 italic", "italic");
            enriched = enriched.replace(/([^\n])\n(- |\* |\d+\. )/g, '$1\n\n$2');
        }

        // Escape tilde to prevent markdown strikethrough interpretation
        enriched = enriched.replace(/~/g, '&#126;');

        const showAvatarsInLog = state.appSettings.showAvatarsInLog;
        const matchingChars = (Object.values(state.characters) as Character[])
            .filter(char => enriched.includes(char.name) && (showAvatarsInLog ? char.avatarUrl !== undefined : true));
        matchingChars.sort((a, b) => b.name.length - a.name.length);

        if (matchingChars.length > 0) {
            const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Match optional @ directly before the character name 
            const pattern = new RegExp(`@?(${matchingChars.map(c => escapeRegExp(c.name)).join('|')})`, 'g');
            enriched = enriched.replace(pattern, (match, charName) => {
                const char = matchingChars.find(c => c.name === charName);
                if (char) {
                    if (showAvatarsInLog && char.avatarUrl) {
                        return `<span class="inline-flex items-center align-bottom mx-1" style="color: var(--dopamine-log)"><img src="${char.avatarUrl}" class="w-4 h-4 rounded-sm object-cover mr-1 opacity-80 bg-black/50"/>${char.name}</span>`;
                    } else {
                        // Return without @
                        return `<span style="color: var(--dopamine-log)">${char.name}</span>`;
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

        if (disableMarkdown) {
            // For memory: Preserve newlines as breaks, skip markdown parsing
            let result = enriched.replace(/\n/g, '<br/>');
            if (applyIndent) {
                result = '&nbsp;&nbsp;&nbsp;&nbsp;' + result.replace(/<br\/>/g, '<br/>&nbsp;&nbsp;&nbsp;&nbsp;');
            }
            return result;
        }

        try {
             let html = marked.parse(enriched, { breaks: true, gfm: true }) as string;
             if (applyIndent && html) {
                 html = html.replace(/<p>/g, '<p>&nbsp;&nbsp;&nbsp;&nbsp;');
                 html = html.replace(/<br\s*\/?>/g, '<br/>&nbsp;&nbsp;&nbsp;&nbsp;');
                 html = html.replace(/<blockquote>/g, '<blockquote>&nbsp;&nbsp;&nbsp;&nbsp;');
             }
             if (!html) return enriched;
             return html;
        } catch (e) {
             return enriched;
        }
    };

    // Auto-scroll logic based on type and initialLogId
    const hasInitialScrolled = useRef(false);
    const prevInitialLogIdRef = useRef<string | undefined>(data?.initialLogId);

    useEffect(() => {
        if (data?.initialLogId !== prevInitialLogIdRef.current) {
            hasInitialScrolled.current = false;
            prevInitialLogIdRef.current = data?.initialLogId;
        }
    }, [data?.initialLogId]);

    useLayoutEffect(() => {
        if (!scrollRef.current) return;
        const container = scrollRef.current;

        // 1. Maintain Scroll Position after "Load More"
        if (previousScrollHeightRef.current > 0) {
            const newScrollHeight = container.scrollHeight;
            const diff = newScrollHeight - previousScrollHeightRef.current;
            if (diff > 0) {
                container.scrollTop += diff;
            }
            previousScrollHeightRef.current = 0; // Reset after adjustment
            return;
        }

        if (data?.type === 'memory') {
            // Case 1: Memory -> Scroll to Bottom
            if (!hasInitialScrolled.current) {
                container.scrollTop = container.scrollHeight;
                hasInitialScrolled.current = true;
            }
        } else if (data?.initialLogId && !hasInitialScrolled.current) {
            // Case 2: History with specified ID -> Scroll to Element
            const targetId = `reading-${data.initialLogId}`;
            
            // Wait slightly for DOM and marked parsing, then scroll
            setTimeout(() => {
                const targetEl = document.getElementById(targetId);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'auto', block: 'start' }); 
                    targetEl.classList.add('bg-primary/20', 'transition-colors', 'duration-1000');
                    setTimeout(() => targetEl.classList.remove('bg-primary/20'), 1000);
                    hasInitialScrolled.current = true;
                } else {
                    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    hasInitialScrolled.current = true;
                }
            }, 100);
        } else if (!hasInitialScrolled.current) {
            // Case 3: History without ID -> Scroll to Bottom
            container.scrollTop = container.scrollHeight;
            hasInitialScrolled.current = true;
        }
    }, [contentData, data]);

    const handleScroll = () => {
        if (!scrollRef.current) return;
        if (data?.type !== 'history') return;

        const container = scrollRef.current;
        if (container.scrollTop < 50) {
            const rawLogs = data.content as LogEntry[];
            const totalRounds = rawLogs.length > 0 ? rawLogs[rawLogs.length - 1].round : 0;
            if (historyLimit < totalRounds) {
                previousScrollHeightRef.current = container.scrollHeight;
                setHistoryLimit(prev => prev + 10);
            }
        }
    };

    // --- EVENT LISTENER FOR JUMP ---
    useEffect(() => {
        const handleJump = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail && detail.round && contentData) {
                // Find first log entry of that round
                const targetEntry = contentData.find(l => l.round === detail.round);
                if (targetEntry) {
                    const elId = `reading-${targetEntry.id}`;
                    const el = document.getElementById(elId);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // Add highlight effect
                        el.classList.add('bg-primary/20', 'transition-colors', 'duration-1000');
                        setTimeout(() => {
                            el.classList.remove('bg-primary/20');
                        }, 2000);
                    }
                }
            }
        };
        
        window.addEventListener('reading_jump_to_round', handleJump);
        return () => window.removeEventListener('reading_jump_to_round', handleJump);
    }, [contentData]);

    const handleExport = async () => {
        if (!data) return;

        let textToExport = "";

        let fullLogs: LogEntry[] = [];
        if (data.type === 'memory') {
            fullLogs = [{
                id: 'memory',
                content: data.content as string,
                type: 'narrative',
                round: 0,
                turnIndex: 0,
                timestamp: Date.now()
            } as LogEntry];
        } else if (data.type === 'history') {
            fullLogs = (data.content as LogEntry[]).filter(l => {
                if (l.type === 'system') {
                    if (l.content.includes("--- 第") && l.content.includes("轮 开始 ---")) return true;
                    return false;
                }
                const text = l.content.trim();
                if (text.startsWith('系统:') || text.startsWith('[系统]')) return false;
                return true;
            });
        }

        fullLogs.forEach(entry => {
            const isSystem = entry.type === 'system';
            const isQuoteLog = entry.content.trim().startsWith('>');
            const isCompactLayout = isSystem || isQuoteLog;
            
            let html = enrichAndParseText(entry.content, data.type === 'memory', !isCompactLayout);
            
            let text = html;
            // 1. Convert <br/>, </p>, and </blockquote> to simple newlines
            text = text.replace(/<br\s*\/?>/gi, '\n');
            text = text.replace(/<\/p>/gi, '\n');
            text = text.replace(/<\/blockquote>/gi, '\n');
            
            // 2. Strip all remaining HTML tags
            text = text.replace(/<[^>]+>/g, '');
            
            // 3. Decode HTML entities safely
            text = text.replace(/&nbsp;/gi, ' ');
            text = text.replace(/&#126;/gi, '~');
            text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            text = text.replace(/&quot;/g, '"').replace(/&#39;/g, "'");

            // Strip trailing newlines/spaces from this chunk, but PRESERVE leading indents
            text = text.trimEnd();

            // Append with a single newline if it's a tight system combo, else a double newline for paragraph spacing
            textToExport += text + (isSystem ? "\n" : "\n\n");
        });

        // Finally, clean up any triple+ newlines globally that might have been formed
        textToExport = textToExport.replace(/\n{3,}/g, '\n\n');
        textToExport = textToExport.trim();

        const date = new Date();
        const timeStr = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${data.title || 'Export'}_${timeStr}.txt`;

        if (Capacitor.isNativePlatform()) {
            try {
                const targetDir = Directory.Documents;
                const targetFolder = 'Huahai Aetheria';
                
                try {
                    await Filesystem.mkdir({
                        path: targetFolder,
                        directory: targetDir,
                        recursive: true
                    });
                } catch (e) {
                    // Ignore if exists
                }

                await Filesystem.writeFile({
                    path: `${targetFolder}/${filename}`,
                    data: textToExport,
                    directory: targetDir,
                    encoding: Encoding.UTF8
                });

                alert(`导出成功！\n位置: 取决于您的系统设置，通常在 内部存储/Documents/${targetFolder}/${filename}`);
                return; 
            } catch (e: any) {
                console.error("Native save failed, falling back to browser download:", e);
            }
        }

        const blob = new Blob([textToExport], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <Window
            title={data?.title || "阅读模式"}
            icon={data?.type === 'memory' ? <FileText size={18}/> : <BookOpen size={18}/>}
            onClose={() => closeWindow(winId)}
            // Fullscreen settings
            fullScreen={true} // Enable true fullscreen (removes outer padding)
            maxWidth="max-w-none" 
            height="h-full"
            zIndex={250}
            noPadding={true}
            // Add safe area padding to the window container to push header down on Android
            className="pt-[env(safe-area-inset-top)]"
            headerActions={
                <div className="flex items-center gap-2">
                    {data?.type === 'history' && (
                        <button 
                            onClick={() => openWindow('story_edit')} 
                            className="flex items-center gap-1 text-xs text-muted hover:text-primary px-2 py-1 rounded hover:bg-surface-light transition-colors"
                            title="编辑/删除故事记录"
                        >
                            <Edit size={14}/> <span>编辑故事</span>
                        </button>
                    )}
                    <button 
                        onClick={handleExport} 
                        className="flex items-center gap-1 text-xs text-muted hover:text-primary px-2 py-1 rounded hover:bg-surface-light transition-colors"
                        title="导出内容"
                    >
                        <Download size={14}/> <span>导出</span>
                    </button>
                </div>
            }
        >
            <div 
                className="relative h-full w-full flex flex-col min-w-0 transition-colors duration-500 font-medium"
                style={{ backgroundColor: 'var(--bg-story)', color: 'var(--text-story)' }}
            >
                {/* Background Pattern Removed for better screenshots */}

                {/* Content Container - Scrollable */}
                <div 
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="relative z-10 flex-1 overflow-y-auto custom-scrollbar h-full w-full"
                >
                    {/* Inner centered content wrapper */}
                    <div 
                        className="relative p-6 md:p-10 max-w-4xl mx-auto w-full font-serif leading-relaxed"
                        style={{ fontSize: 'var(--story-font-size)', fontWeight: 'var(--story-font-weight)' }}
                    >
                        {data?.type === 'history' && historyLimit < (data.content.length > 0 ? (data.content as LogEntry[])[(data.content as LogEntry[]).length - 1].round : 0) && (
                            <div className="text-center py-4 text-muted/50 text-xs flex justify-center items-center">
                                <Loader2 size={12} className="animate-spin mr-1"/> 上滑加载更多内容
                            </div>
                        )}
                        {contentData.length === 0 && (
                            <div className="text-center text-muted italic py-10">暂无内容。</div>
                        )}
                        
                        {contentData.map((entry, idx) => {
                            const isSystem = entry.type === 'system';
                            const isQuoteLog = entry.content.trim().startsWith('>');
                            const isCompactLayout = isSystem || isQuoteLog;
                            return (
                                <div 
                                    key={idx} 
                                    id={`reading-${entry.id}`} // Assign ID for scroll anchor
                                    className={`animate-in fade-in slide-in-from-bottom-2 duration-500 ${isSystem ? 'text-sm text-center text-muted my-6 font-sans opacity-50 border-t border-b border-border py-1' : ''}`}
                                >
                                    {/* Content */}
                                    <div 
                                        className={`markdown-content w-full mb-1 ${isCompactLayout ? '[&_p]:!m-0 [&_blockquote]:!m-0' : 'inline-block align-top'}`} 
                                        style={{ 
                                            fontSize: isCompactLayout ? 'calc(var(--story-font-size) * 0.70)' : 'var(--story-font-size)', 
                                        }}
                                        dangerouslySetInnerHTML={{__html: enrichAndParseText(entry.content, data?.type === 'memory', !isCompactLayout)}}
                                    ></div>
                                    
                                    {/* Images */}
                                    {entry.images && entry.images.length > 0 && (
                                        <div className="flex flex-wrap gap-4 my-4 justify-center">
                                            {entry.images.map((img, i) => (
                                                <div key={i} className="relative group max-w-sm rounded-lg overflow-hidden border border-border bg-black/20 shadow-lg">
                                                    <img 
                                                        src={img.base64} 
                                                        alt={img.description} 
                                                        className="w-full h-auto object-contain"
                                                    />
                                                    {img.description && (
                                                        <div className="bg-black/60 p-2 text-xs text-white text-center">
                                                            {img.description}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        
                        {/* Footer padding for screenshots/overscroll */}
                        <div className="h-32"></div>
                    </div>
                </div>
            </div>
        </Window>
    );
};
