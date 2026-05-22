
import React, { useState, useEffect } from 'react';
import { GameState, Character } from '../../types';
import { Button } from '../ui/Button';
import { ListOrdered, Trash2, Plus, Check, GripVertical } from 'lucide-react';
import { Window } from '../ui/Window';
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

interface ManualOrderModalProps {
    isOpen: boolean;
    state: GameState;
    onConfirm: (order: string[]) => void;
    onCancel: () => void;
    addLog: (msg: string) => void;
}

interface SortableOrderItemData {
    uniqueId: string;
    charId: string;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

const SortableOrderItem = ({ 
    item, 
    index, 
    charName, 
    onRemove 
}: { 
    item: SortableOrderItemData; 
    index: number; 
    charName: string; 
    onRemove: (id: string) => void;
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.uniqueId });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        zIndex: isDragging ? 999 : 'auto',
        position: 'relative' as const,
        touchAction: 'none'
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            className={`flex items-center bg-surface p-2 rounded border gap-2 group transition-colors mb-2 ${isDragging ? 'border-primary/50 shadow-lg opacity-50' : 'border-border hover:border-primary/50'}`}
        >
            <div 
                className="cursor-move text-muted hover:text-body px-1 touch-none" 
                {...attributes} 
                {...listeners}
            >
                <GripVertical size={14}/>
            </div>
            <span className="text-muted font-mono w-6 text-center text-xs">{index + 1}</span>
            <div className="flex-1 font-bold text-body text-sm truncate">{charName}</div>
            <div className="flex gap-1 shrink-0">
                <button 
                    onClick={() => onRemove(item.uniqueId)} 
                    className="p-1 hover:bg-danger/20 rounded text-muted hover:text-danger-fg"
                >
                    <Trash2 size={14}/>
                </button>
            </div>
        </div>
    );
};

export const ManualOrderModal: React.FC<ManualOrderModalProps> = ({ isOpen, state, onConfirm, onCancel, addLog }) => {
    const [items, setItems] = useState<SortableOrderItemData[]>([]);
    const [charToAdd, setCharToAdd] = useState("");

    // Sync Manual List when modal opens
    useEffect(() => {
        if (isOpen) {
            // Fetch current location characters
            const locId = state.map.activeLocationId;
            const locChars = (Object.values(state.characters) as Character[]).filter(c => {
                const pos = state.map.charPositions[c.id];
                return pos && pos.locationId === locId;
            }).map(c => c.id);
            
            // Sort: Non-Environment first, then Environment at the end
            const envChars = locChars.filter(id => id.startsWith('env_'));
            const nonEnv = locChars.filter(id => !id.startsWith('env_'));
            
            const initialList = [...nonEnv, ...envChars];
            setItems(initialList.map(charId => ({ uniqueId: generateId(), charId })));
        }
    }, [isOpen, state.map.activeLocationId, state.map.charPositions, state.characters]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
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
                const oldIndex = items.findIndex((item) => item.uniqueId === active.id);
                const newIndex = items.findIndex((item) => item.uniqueId === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const removeOrderItem = (uniqueId: string) => {
        setItems(items => items.filter(i => i.uniqueId !== uniqueId));
    };

    const handleConfirm = () => {
        const finalOrder = items.map(i => i.charId);
        onConfirm(finalOrder);
        addLog(`系统: 手动设定轮次顺序: [${finalOrder.map(id => state.characters[id]?.name || id).join(', ')}]`);
    };

    // Get available characters for manual add
    const availableChars = (Object.values(state.characters) as Character[]).filter(c => {
        const pos = state.map.charPositions[c.id];
        return pos && pos.locationId === state.map.activeLocationId;
    });

    if (!isOpen) return null;

    return (
        <Window
            title={<span className="flex items-center gap-2"><ListOrdered size={18}/> 手动轮次判定</span>}
            onClose={onCancel}
            maxWidth="max-w-md"
            height="h-[80vh]"
            zIndex={150}
            noPadding={true}
            footer={
                <div className="flex gap-3 w-full">
                    <Button variant="secondary" onClick={onCancel} className="flex-1">取消/暂停</Button>
                    <Button onClick={handleConfirm} className="flex-1">
                        <Check size={16} className="mr-1"/> 确认并开始
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col h-full p-4 bg-surface/30">
                <p className="text-xs text-muted mb-4 shrink-0">
                    请调整本轮角色的行动顺序。您可以增加或删除任意角色（包括重复）。
                </p>
                
                <div className="flex-1 overflow-y-auto pr-1 mb-4 bg-surface-highlight/50 p-2 rounded border border-border custom-scrollbar">
                    {items.length === 0 ? (
                        <div className="text-center text-muted italic py-4">列表为空</div>
                    ) : (
                        <DndContext 
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                            modifiers={[restrictToVerticalAxis]}
                        >
                            <SortableContext 
                                items={items.map(i => i.uniqueId)}
                                strategy={verticalListSortingStrategy}
                            >
                                {items.map((item, index) => {
                                    const char = state.characters[item.charId];
                                    if (!char) return null;
                                    return (
                                        <SortableOrderItem
                                            key={item.uniqueId}
                                            item={item}
                                            index={index}
                                            charName={char.name}
                                            onRemove={removeOrderItem}
                                        />
                                    );
                                })}
                            </SortableContext>
                        </DndContext>
                    )}
                </div>

                <div className="flex gap-2 shrink-0 border-t border-border pt-4">
                    <select 
                        className="flex-1 bg-surface-light border border-border rounded px-2 py-1 text-sm text-body"
                        value={charToAdd}
                        onChange={e => setCharToAdd(e.target.value)}
                    >
                        <option value="">-- 选择角色添加 --</option>
                        {availableChars.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <Button 
                        size="sm" 
                        disabled={!charToAdd}
                        onClick={() => {
                            if (charToAdd) {
                                setItems([...items, { uniqueId: generateId(), charId: charToAdd }]);
                                setCharToAdd("");
                            }
                        }}
                    >
                        <Plus size={14}/> 添加
                    </Button>
                </div>
            </div>
        </Window>
    );
};
