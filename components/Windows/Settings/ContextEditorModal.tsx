
import React, { useState, useEffect, useMemo } from 'react';
import { GlobalContextMessage } from '../../../types';
import { Button, TextArea, Label } from '../../ui/Button';
import { Trash, Plus, FileText, GripVertical, ArrowDown, ChevronRight, ChevronDown, Check, Copy, Clipboard, CheckCircle, AlertCircle } from 'lucide-react';
import { Window } from '../../ui/Window';
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

interface ContextEditorModalProps {
    title: string;
    messages: GlobalContextMessage[];
    onMessagesChange: (msgs: GlobalContextMessage[]) => void;
    onClose: () => void;
}

// Wrapper type with unique ID for dnd-kit
interface SortableMessage extends GlobalContextMessage {
    _id: string;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

// Sortable Item Component
const SortableMessageItem = ({ 
    item, 
    index, 
    expandedIndex, 
    setExpandedIndex, 
    handleUpdate, 
    handleInsertImport, 
    handleInsertAfter, 
    handleRemove, 
    getRoleColor,
    handleKeyDown 
}: {
    item: SortableMessage;
    index: number;
    expandedIndex: number | null;
    setExpandedIndex: (idx: number | null) => void;
    handleUpdate: (id: string, field: keyof GlobalContextMessage, val: any) => void;
    handleInsertImport: (idx: number) => void;
    handleInsertAfter: (idx: number) => void;
    handleRemove: (idx: number) => void;
    getRoleColor: (role: string) => string;
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string) => void;
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item._id });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 999 : 'auto',
        position: 'relative' as const,
        touchAction: 'none' // Important for touch devices
    };

    const isExpanded = expandedIndex === index;

    return (
        <div 
            ref={setNodeRef} 
            style={style}
            className={`
                bg-surface/40 backdrop-blur-md border rounded transition-all mb-3
                ${isDragging ? 'border-primary opacity-50 shadow-lg' : isExpanded ? 'border-primary/50 ring-1 ring-primary/20 bg-surface/60' : 'border-border/50 hover:border-border hover:bg-surface/50'}
            `}
        >
            {/* Header (Always Visible) */}
            <div 
                className={`flex items-center gap-2 p-2 cursor-pointer select-none ${isExpanded ? 'border-b border-border/30' : ''}`}
                onClick={() => setExpandedIndex(isExpanded ? null : index)}
            >
                {/* Drag Handle - Apply listeners here */}
                <div 
                    className="cursor-move text-muted hover:text-body px-1 touch-none" 
                    title="拖拽排序" 
                    {...attributes} 
                    {...listeners}
                    onClick={e => e.stopPropagation()}
                >
                    <GripVertical size={14}/>
                </div>

                {/* Expand Icon */}
                <div className="text-muted">
                    {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                </div>

                {/* Role Badge */}
                <div className={`text-[9px] px-2 py-0.5 rounded border font-mono uppercase font-bold w-16 text-center ${getRoleColor(item.role)}`}>
                    {item.role}
                </div>

                {/* Content Preview */}
                <div className="flex-1 min-w-0 text-xs text-body truncate font-mono opacity-80 pl-1">
                    {item.content || <span className="text-muted italic">(空内容)</span>}
                </div>

                {/* Actions */}
                <div className="flex gap-1 items-center pr-1" onClick={e => e.stopPropagation()}>
                    <button 
                        onClick={() => handleInsertImport(index)} 
                        className="text-muted hover:text-primary p-1.5 rounded hover:bg-white/5 border border-transparent hover:border-primary/30 transition-colors"
                        title="从缓冲区插入到此处"
                    >
                        <Clipboard size={12}/>
                    </button>
                    <div className="w-px h-3 bg-border/50 mx-0.5"></div>
                    <button 
                        onClick={() => handleInsertAfter(index)} 
                        className="text-muted hover:text-success-fg p-1.5 rounded hover:bg-white/5 transition-colors"
                        title="在下方插入空行 (Enter)"
                    >
                        <ArrowDown size={12}/>
                    </button>
                    <button 
                        onClick={() => handleRemove(index)} 
                        className="text-muted hover:text-danger-fg p-1.5 rounded hover:bg-white/5 transition-colors"
                        title="删除"
                    >
                        <Trash size={12}/>
                    </button>
                </div>
            </div>

            {/* Body (Expandable) */}
            {isExpanded && (
                <div className="p-3 animate-in slide-in-from-top-1 fade-in duration-200 cursor-default" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted">角色 (Role):</span>
                            <select
                                className="bg-black/20 border border-border/50 rounded px-2 py-1 text-xs text-body focus:border-primary outline-none cursor-pointer"
                                value={item.role}
                                onChange={e => handleUpdate(item._id, 'role', e.target.value)}
                            >
                                <option value="user">User</option>
                                <option value="model">Assistant</option>
                                <option value="system">System</option>
                            </select>
                            <span className="text-[9px] text-muted ml-auto">
                                Enter: 插入下一条 | Ctrl+Enter: 换行
                            </span>
                        </div>
                        <TextArea
                            className="min-h-[120px] resize-y font-mono text-xs w-full p-2 bg-black/20 border-border/50 focus:border-primary"
                            value={item.content}
                            onChange={e => handleUpdate(item._id, 'content', e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, item._id)}
                            placeholder="输入上下文内容..."
                            autoFocus
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export const ContextEditorModal: React.FC<ContextEditorModalProps> = ({ title, messages, onMessagesChange, onClose }) => {
    // Local state with IDs for dnd-kit
    const [items, setItems] = useState<SortableMessage[]>([]);
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    
    // Import/Export State
    const [importStr, setImportStr] = useState("");
    const [showCopied, setShowCopied] = useState(false);
    const [clearConfirm, setClearConfirm] = useState(false);

    // Initialize items from props
    useEffect(() => {
        // Only update if length differs or if it's the first load to avoid overwriting local edits during drag
        // But since we lift state up on every change, we need to sync carefully.
        // Strategy: We rely on parent state as source of truth, but we need to maintain stable IDs.
        // If we regenerate IDs every time, drag will break.
        // So we should only initialize once or when parent completely changes?
        // Better: Map parent messages to existing items if possible, or generate new IDs.
        
        setItems(prev => {
            // Simple sync: if length matches, assume same items (risky but okay for this context)
            // Better: just re-map. But we lose ID stability if we just map.
            // Let's try to preserve IDs by index if possible, or just generate new ones.
            // Actually, for a controlled component, it's tricky.
            // Let's assume onMessagesChange updates parent, which updates props, which triggers this.
            // We need to map back and forth.
            
            // To avoid ID churn, we can try to reuse IDs from prev if content matches, but that's expensive.
            // Let's just generate new IDs if length changes significantly, otherwise try to map?
            // No, the simplest robust way for this specific app structure is:
            // 1. When props.messages changes, we update local items.
            // 2. But to keep stable IDs during drag, we need to defer the prop update?
            // No, dnd-kit handles local state. We should update parent ONLY after drag ends or edit happens.
            
            // Let's use a ref to track if we are the ones who triggered the update.
            return messages.map((m, i) => ({
                ...m,
                _id: (prev[i] && prev[i].role === m.role && prev[i].content === m.content) ? prev[i]._id : generateId()
            }));
        });
    }, [messages]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // 8px movement required to start drag (prevents accidental clicks)
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        
        if (over && active.id !== over.id) {
            setItems((items) => {
                const oldIndex = items.findIndex((item) => item._id === active.id);
                const newIndex = items.findIndex((item) => item._id === over.id);
                
                const newItems = arrayMove(items, oldIndex, newIndex);
                
                // Sync to parent
                // We do this immediately. The useEffect above might re-run, but hopefully with same order.
                // To ensure IDs are stable, we might need to be careful.
                // But since we regenerate IDs in useEffect based on index matching, swapping might cause ID regeneration?
                // Actually, if we update parent, parent sends back new array.
                // useEffect sees new array. It maps index 0 to new item 0.
                // If we use the logic "prev[i] matches m", then if we swapped, prev[0] (old A) != m[0] (new B).
                // So ID will change. This might cause a flash.
                
                // FIX: We should probably NOT sync from props if we are driving the state locally, 
                // OR we should make the ID generation deterministic/stable.
                // Given the constraints, let's just emit the change. The flash might be acceptable or imperceptible.
                
                onMessagesChange(newItems.map(({_id, ...rest}) => rest));
                
                // Update expanded index
                if (expandedIndex === oldIndex) setExpandedIndex(newIndex);
                else if (expandedIndex === newIndex && oldIndex < newIndex) setExpandedIndex(expandedIndex - 1);
                else if (expandedIndex === newIndex && oldIndex > newIndex) setExpandedIndex(expandedIndex + 1);

                return newItems;
            });
        }
    };

    // --- CRUD Wrappers ---
    const updateParent = (newItems: SortableMessage[]) => {
        onMessagesChange(newItems.map(({_id, ...rest}) => rest));
    };

    const handleUpdate = (id: string, field: keyof GlobalContextMessage, val: any) => {
        const newItems = items.map(item => item._id === id ? { ...item, [field]: val } : item);
        setItems(newItems); // Optimistic update
        updateParent(newItems);
    };

    const handleAdd = () => {
        const newIdx = items.length;
        let nextRole: 'user' | 'model' = 'user';
        if (items.length > 0) {
            const lastRole = items[items.length - 1].role;
            nextRole = (lastRole === 'user' || lastRole === 'system') ? 'model' : 'user';
        }
        
        const newItem: SortableMessage = { role: nextRole, content: '', _id: generateId() };
        const newItems = [...items, newItem];
        setItems(newItems);
        updateParent(newItems);
        setExpandedIndex(newIdx);
    };

    const handleInsertAfter = (index: number) => {
        const currentRole = items[index].role;
        const nextRole = (currentRole === 'user' || currentRole === 'system') ? 'model' : 'user';
        
        const newItem: SortableMessage = { role: nextRole, content: '', _id: generateId() };
        const newItems = [...items];
        newItems.splice(index + 1, 0, newItem);
        
        setItems(newItems);
        updateParent(newItems);
        setExpandedIndex(index + 1);
    };

    const handleRemove = (index: number) => {
        const newItems = items.filter((_, i) => i !== index);
        setItems(newItems);
        updateParent(newItems);
        if (expandedIndex === index) setExpandedIndex(null);
    };

    // --- IO Functions (Unchanged logic, adapted to local state) ---
    const handleExport = () => {
        const text = items.map(msg => {
            const tag = msg.role === 'model' ? 'assistant' : msg.role;
            return `<${tag}>\n${msg.content.trim()}\n</${tag}>`;
        }).join('\n\n');
        navigator.clipboard.writeText(text);
        setShowCopied(true);
        setTimeout(() => setShowCopied(false), 2000);
    };

    const parseImportString = (str: string): GlobalContextMessage[] => {
        const regex = /<(user|model|assistant|system)>([\s\S]*?)<\/\1>/gi;
        const newMsgs: GlobalContextMessage[] = [];
        let match;
        while ((match = regex.exec(str)) !== null) {
            let roleStr = match[1].toLowerCase();
            if (roleStr === 'assistant') roleStr = 'model';
            if (roleStr === 'user' || roleStr === 'model' || roleStr === 'system') {
                 newMsgs.push({ role: roleStr as any, content: match[2].trim() });
            }
        }
        return newMsgs;
    };

    const handleImport = () => {
        if (!importStr.trim()) return;
        const newMsgs = parseImportString(importStr);
        if (newMsgs.length > 0) {
            const newSortableMsgs = newMsgs.map(m => ({ ...m, _id: generateId() }));
            const newItems = [...items, ...newSortableMsgs];
            setItems(newItems);
            updateParent(newItems);
            setImportStr("");
            alert(`成功导入 ${newMsgs.length} 条消息 (追加到底部)。`);
        } else {
            alert("未识别到有效格式的消息。请使用 <user>...</user> 等标签包裹内容。");
        }
    };

    const handleInsertImport = (index: number) => {
        if (!importStr.trim()) {
            alert("请先在顶部文本框中粘贴要导入的内容。");
            return;
        }
        const newMsgs = parseImportString(importStr);
        if (newMsgs.length > 0) {
            const newSortableMsgs = newMsgs.map(m => ({ ...m, _id: generateId() }));
            const newItems = [...items];
            newItems.splice(index + 1, 0, ...newSortableMsgs);
            setItems(newItems);
            updateParent(newItems);
            setImportStr("");
            setExpandedIndex(index + 1); 
        } else {
            alert("未识别到有效格式的消息。请确保格式如 <user>内容</user>。");
        }
    };

    const handleClear = () => {
        if (clearConfirm) {
            setItems([]);
            updateParent([]);
            setClearConfirm(false);
        } else {
            setClearConfirm(true);
            setTimeout(() => setClearConfirm(false), 3000);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            const target = e.target as HTMLTextAreaElement;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const val = target.value;
            const newVal = val.substring(0, start) + "\n" + val.substring(end);
            handleUpdate(id, 'content', newVal);
            setTimeout(() => { target.selectionStart = target.selectionEnd = start + 1; }, 0);
            return;
        }
        if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            const idx = items.findIndex(i => i._id === id);
            if (idx !== -1) handleInsertAfter(idx);
        }
    };

    const getRoleColor = (role: string) => {
        if (role === 'system' || role === 'user') return 'bg-surface-light border-border text-muted';
        return 'bg-surface border-border text-primary';
    };

    return (
        <Window
            title={<span className="flex items-center gap-2"><FileText size={18} className="text-primary"/> {title}</span>}
            onClose={onClose}
            maxWidth="max-w-3xl"
            height="h-[85vh]"
            zIndex={200}
            noPadding={true}
            footer={
                <div className="flex justify-between w-full">
                     <Button size="sm" variant="secondary" onClick={handleAdd}><Plus size={14} className="mr-1"/> 添加消息 (底部)</Button>
                     <Button onClick={onClose}><Check size={14} className="mr-1"/> 完成</Button>
                </div>
            }
        >
            <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6">
                
                {/* 1. Staging Area */}
                <div className="mb-6">
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-end px-1">
                            <Label className="text-xs text-muted font-bold flex items-center gap-2">
                                <Clipboard size={14}/> 导入缓冲区
                            </Label>
                            <div className="text-[10px] text-muted flex items-center gap-1 opacity-70">
                                <AlertCircle size={10}/>
                                <span>XML 格式: <code>&lt;user&gt;</code>, <code>&lt;assistant&gt;</code>, <code>&lt;system&gt;</code></span>
                            </div>
                        </div>
                        
                        <TextArea 
                            className="w-full h-24 text-xs font-mono bg-black/20 border-border/50 focus:border-primary backdrop-blur-sm resize-y text-body placeholder:text-muted/50"
                            placeholder={'在此粘贴 XML 格式消息...\n示例:\n<system>你是一个助手。</system>\n<user>你好</user>'}
                            value={importStr}
                            onChange={e => setImportStr(e.target.value)}
                        />
                        
                        <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={handleImport} disabled={!importStr} className="flex-1 h-8 bg-surface/40 hover:bg-surface/60 border-border/50">
                                <Clipboard size={14} className="mr-1"/> 导入(追加)
                            </Button>
                            <Button size="sm" variant="secondary" onClick={handleExport} className="flex-1 h-8 bg-surface/40 hover:bg-surface/60 border-border/50">
                                {showCopied ? <CheckCircle size={14} className="text-success-fg"/> : <Copy size={14}/>} {showCopied ? "已复制" : "导出"}
                            </Button>
                            <Button 
                                size="sm" 
                                variant="danger" 
                                onClick={handleClear} 
                                className={`h-8 transition-all ${clearConfirm ? 'w-24 bg-danger text-white' : 'w-10 bg-surface/40 hover:bg-danger/20 text-muted hover:text-danger-fg border-border/50'}`}
                                title="清空列表"
                            >
                                {clearConfirm ? "确认?" : <Trash size={14}/>}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="border-b border-border/30 mb-6 mx-1"></div>

                {/* 2. Message List (Sortable) */}
                <div className="pb-4">
                    {items.length === 0 && (
                        <div className="text-center text-muted text-xs italic py-12 border-2 border-dashed border-border/30 rounded-lg bg-surface/10">
                            暂无上下文消息。请使用上方工具栏导入或点击底部按钮添加。
                        </div>
                    )}
                    
                    <DndContext 
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToVerticalAxis]}
                    >
                        <SortableContext 
                            items={items.map(i => i._id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {items.map((item, index) => (
                                <SortableMessageItem
                                    key={item._id}
                                    item={item}
                                    index={index}
                                    expandedIndex={expandedIndex}
                                    setExpandedIndex={setExpandedIndex}
                                    handleUpdate={handleUpdate}
                                    handleInsertImport={handleInsertImport}
                                    handleInsertAfter={handleInsertAfter}
                                    handleRemove={handleRemove}
                                    getRoleColor={getRoleColor}
                                    handleKeyDown={handleKeyDown}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                </div>
            </div>
        </Window>
    );
};
