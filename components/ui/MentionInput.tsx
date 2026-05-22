import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Character } from '../../types';
import { SelectionPopover, SelectionItem } from './SelectionPopover';

interface MentionInputProps {
    value: string;
    onChange: (value: string) => void;
    characters: Record<string, Character>;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    onPaste?: (e: React.ClipboardEvent) => void;
    topResizable?: boolean;
    minHeight?: number;
    maxHeight?: number;
}

export const MentionInput: React.FC<MentionInputProps> = ({
    value,
    onChange,
    characters,
    placeholder,
    disabled = false,
    className = "",
    onKeyDown,
    onPaste,
    topResizable = false,
    minHeight = 40,
    maxHeight = 300
}) => {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const [isFocused, setIsFocused] = useState(false);
    
    // Popover state
    const [popover, setPopover] = useState<{isOpen: boolean, rect: DOMRect | null, filter: string, anchorNode: Node | null, anchorOffset: number}>({
        isOpen: false, rect: null, filter: '', anchorNode: null, anchorOffset: 0
    });

    const handleResizeMouseDown = (e: React.MouseEvent) => {
        if (!topResizable) return;
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = wrapperRef.current?.getBoundingClientRect().height || minHeight;

        const handleMouseMove = (e: MouseEvent) => {
            if (!wrapperRef.current) return;
            const deltaY = startY - e.clientY; // Upward drag increases height
            const newHeight = Math.min(Math.max(startHeight + deltaY, minHeight), maxHeight);
            wrapperRef.current.style.height = `${newHeight}px`;
        };

        const handleMouseUp = () => {
             document.removeEventListener('mousemove', handleMouseMove);
             document.removeEventListener('mouseup', handleMouseUp);
             document.body.style.cursor = 'default';
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'ns-resize';
    };

    // Helper: Convert internal value (with @charID) to HTML
    const valueToHtml = useCallback((val: string) => {
        // Regex to find @charXXX patterns where XXX is alphanumeric
        const regex = /@(char[a-zA-Z0-9_\-]+)/g;
        let html = val.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        
        let match;
        const matches: { id: string, name: string, token: string }[] = [];
        
        // Reset lastIndex because regex is global
        regex.lastIndex = 0;
        let p;
        while ((p = regex.exec(val)) !== null) {
            const id = p[1];
            if (characters[id]) {
                matches.push({ id, name: characters[id].name, token: p[0] });
            }
        }
        
        // Replace in HTML
        matches.forEach(m => {
            const spanHtml = `<span class="mention inline-flex items-center gap-1 bg-dopamine/15 text-dopamine border border-dopamine/30 px-1.5 py-0.5 rounded text-[10px] font-bold select-none cursor-default mx-0.5 align-middle" data-id="${m.id}" contenteditable="false">@${m.name}</span> `;
            html = html.replace(m.token, spanHtml);
        });

        return html;
    }, [characters]);

    // Initialize content only when value changes externally (e.g. cleared)
    const prevValueRef = useRef(value);
    useEffect(() => {
        if (editorRef.current && value !== prevValueRef.current) {
            // Need to update html
            const currentHtml = editorRef.current.innerHTML;
            const expectedValue = htmlToValue(currentHtml);
            if (value !== expectedValue) {
                editorRef.current.innerHTML = valueToHtml(value);
            }
        }
        prevValueRef.current = value;
    }, [value, valueToHtml]);

    // Initial render
    useEffect(() => {
        if (editorRef.current && !editorRef.current.innerHTML && value) {
            editorRef.current.innerHTML = valueToHtml(value);
        }
    }, []);

    // Helper: Convert HTML to internal value
    const htmlToValue = (html: string) => {
        if (!editorRef.current) return '';
        
        // Create a temporary div to parse HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // Replace <br> with newlines
        tempDiv.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        
        // Replace divs with newlines (Chrome wrap lines in divs)
        tempDiv.querySelectorAll('div').forEach(div => {
            div.replaceWith('\n' + div.innerHTML);
        });
        
        // Replace mentions with @charID
        tempDiv.querySelectorAll('.mention').forEach(span => {
            const id = span.getAttribute('data-id');
            if (id) {
                span.replaceWith(`@${id}`);
            }
        });
        
        // Unescape entities and return text content
        return tempDiv.textContent || '';
    };

    const handleInput = () => {
        if (!editorRef.current) return;
        const html = editorRef.current.innerHTML;
        const newValue = htmlToValue(html);
        
        let foundTrigger = false;
        try {
            // Check for '@' trigger
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const node = range.startContainer;
                const offset = range.startOffset;

                if (node.nodeType === Node.TEXT_NODE) {
                    const textBeforeCursor = node.textContent?.substring(0, offset) || '';
                    const lastAtMatch = textBeforeCursor.match(/@([^\s]{0,20})$/);
                    
                    if (lastAtMatch) {
                        foundTrigger = true;
                        // Open popover
                        const rect = range.getBoundingClientRect();
                        // We need a stable react rect to avoid jumping
                        setPopover({
                            isOpen: true,
                            rect: rect,
                            filter: lastAtMatch[1],
                            anchorNode: node,
                            anchorOffset: offset - lastAtMatch[0].length // position right before @
                        });
                    }
                }
            }

            // If we reach here, we check if no trigger was found
            if (!foundTrigger && popover.isOpen) {
                setPopover(p => ({ ...p, isOpen: false }));
            }
        } catch (e) {
            // Safety
            if (popover.isOpen) {
                setPopover(p => ({ ...p, isOpen: false }));
            }
        }
        
        if (newValue !== value) {
            onChange(newValue);
            prevValueRef.current = newValue;
        }
    };

    const handleMentionSelect = (charId: string) => {
        const char = characters[charId];
        if (!char || !popover.anchorNode) return;

        // Perform asynchronously to prevent Chromium IME swallowed first character bugs
        // modifying DOM and Selection immediately inside a KeyboardEvent handler can break next composition
        setTimeout(() => {
            const selection = window.getSelection();
            if (!selection) return;

            const range = document.createRange();
            range.setStart(popover.anchorNode!, popover.anchorOffset);
            
            // End of the typed "@filter"
            const endOffset = popover.anchorNode!.nodeType === Node.TEXT_NODE ? 
                Math.min(popover.anchorOffset + 1 + popover.filter.length, popover.anchorNode!.textContent?.length || 0) : 
                popover.anchorOffset;
                
            range.setEnd(popover.anchorNode!, endOffset);
            
            // Delete the typed text
            range.deleteContents();
            
            // Create mention span
            const span = document.createElement('span');
            span.className = "mention inline-flex items-center gap-1 bg-dopamine/15 text-dopamine border border-dopamine/30 px-1.5 py-0.5 rounded text-[10px] font-bold select-none cursor-default mx-0.5 align-middle";
            span.setAttribute('data-id', charId);
            span.contentEditable = "false";
            span.innerHTML = `@${char.name}`;
            
            // Insert
            range.insertNode(span);
            
            // Insert a normal space after, so user can continue typing normally
            const space = document.createTextNode(' ');
            range.setStartAfter(span);
            range.insertNode(space);
            
            range.setStartAfter(space);
            range.collapse(true);
            
            selection.removeAllRanges();
            selection.addRange(range);
            
            setPopover(p => ({ ...p, isOpen: false }));
            handleInput(); // Trigger update
        }, 0);
    };

    const handleInternalKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Stop default behavior to prevent deleting part of span, Chrome handles contenteditable="false" mostly fine, 
        // but backspace on the space after might need custom logic.
        
        // Pass to top level if listening
        if (onKeyDown && !popover.isOpen) {
            onKeyDown(e);
        }
    };
    
    // Keyboard navigation handlers will be attached to window/document while popover is open
    // Since SelectionPopover handles arrow keys to some extent, we'll let it or we implement it here?
    // Wait, SelectionPopover might not handle window keydown.
    
    const getTargetItems = (): SelectionItem[] => {
        const items: SelectionItem[] = [];
        Object.values(characters).forEach(char => {
            if ((char.id.startsWith('char') || char.id.startsWith('env_')) && (popover.filter === '' || char.name.includes(popover.filter))) {
                items.push({
                    id: char.id,
                    name: char.name,
                    icon: char.avatarUrl || "👤",
                    description: char.description?.substring(0, 30),
                    dataRef: char
                });
            }
        });
        
        items.sort((a, b) => {
            const charA = a.dataRef as Character;
            const charB = b.dataRef as Character;
            
            // Environment character first
            if (charA.id.startsWith('env_') && !charB.id.startsWith('env_')) return -1;
            if (!charA.id.startsWith('env_') && charB.id.startsWith('env_')) return 1;
            
            // Then by attributes.act (活跃)
            const actA = Number(charA.attributes?.act?.value || 0);
            const actB = Number(charB.attributes?.act?.value || 0);
            if (actB !== actA) return actB - actA;
            
            // Then by attributes.fit (体能)
            const fitA = Number(charA.attributes?.fit?.value || 0);
            const fitB = Number(charB.attributes?.fit?.value || 0);
            return fitB - fitA;
        });
        
        return items;
    };

    const isEmpty = !value || value.trim() === '';

    return (
        <div 
            ref={wrapperRef}
            className={`relative flex flex-col w-full cursor-text ${className}`}
            onClick={(e) => {
                if (e.target === e.currentTarget && editorRef.current && document.activeElement !== editorRef.current) {
                    editorRef.current.focus();
                    
                    // place caret at the end if focusing via wrapper click
                    try {
                        const sel = window.getSelection();
                        if (sel && editorRef.current.childNodes.length > 0) {
                            const range = document.createRange();
                            range.selectNodeContents(editorRef.current);
                            range.collapse(false);
                            sel.removeAllRanges();
                            sel.addRange(range);
                        }
                    } catch (err) {}
                }
            }}
            style={topResizable ? { height: minHeight } : undefined}
        >
             {topResizable && (
                <div 
                    className="absolute top-0 right-0 w-4 h-4 cursor-ns-resize opacity-50 hover:opacity-100 flex items-start justify-end p-[3px] rounded-tr z-10"
                    onMouseDown={handleResizeMouseDown}
                    title="向上拖动缩放"
                >
                    <svg width="8" height="8" viewBox="0 0 10 10" className="text-muted-foreground mr-[1px] mt-[1px]">
                        <path d="M 8,0 L 10,2 M 5,0 L 10,5 M 2,0 L 10,8" stroke="currentColor" strokeWidth="1" fill="none" />
                    </svg>
                </div>
            )}
             <div
                ref={editorRef}
                contentEditable={!disabled}
                onInput={handleInput}
                onKeyDown={handleInternalKeyDown}
                onPaste={onPaste}
                onFocus={() => setIsFocused(true)}
                onBlur={() => {
                    setIsFocused(false);
                    // delay closing so click can register
                    setTimeout(() => setPopover(p => ({...p, isOpen: false})), 200);
                }}
                className={`w-full flex-1 h-full text-xs outline-none bg-transparent overflow-y-auto ${topResizable ? 'pr-3 pt-1' : ''} ${isEmpty ? 'before:content-[attr(data-placeholder)] before:text-faint before:absolute before:pointer-events-none' : ''}`}
                data-placeholder={placeholder}
                style={{
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap'
                }}
            />
            {popover.isOpen && popover.rect && (
                <SelectionPopover
                    title="选择目标"
                    items={getTargetItems()}
                    anchorRect={popover.rect}
                    onSelect={handleMentionSelect}
                    onClose={() => setPopover(p => ({ ...p, isOpen: false }))}
                    keyboardTargetRef={editorRef} 
                    // keyboardTargetRef allows popover to listen to events from the editor or we inject them
                />
            )}
        </div>
    );
};

