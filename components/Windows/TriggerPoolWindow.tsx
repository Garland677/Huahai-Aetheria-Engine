
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GameState, Trigger, TriggerCondition, ConditionType, Character, MapLocation, TriggerPhase, TriggerEffect, Card, TriggerGroup } from '../../types';
import { Button, Input, TextArea, Label } from '../ui/Button';
import { X, Plus, Trash2, Edit2, Save, Activity, ArrowRight, Filter, Zap, CheckCircle, AlertTriangle, ChevronDown, ChevronRight, Hash, Clock, Copy, RefreshCcw, Power, ShieldAlert, FileText, ListPlus, Wand2, Package, Globe, ToggleRight, Folder, FolderOpen, MoreVertical, LayoutGrid, ChevronUp } from 'lucide-react';
import { WorldTimePicker } from '../ui/WorldTimePicker';
import { Window } from '../ui/Window';
import { generateTriggerGroupId, generateTriggerId, generateConditionId, generateEffectId } from '../../services/idUtils';

interface TriggerPoolWindowProps {
    winId: number;
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    closeWindow: (id: number) => void;
    addLog: (text: string) => void;
}

const CONDITION_TYPES: { value: ConditionType, label: string }[] = [
    { value: 'char_attr', label: '角色属性' },
    { value: 'char_card', label: '角色卡牌' },
    { value: 'world_time', label: '世界时间' },
    { value: 'world_attr', label: '世界属性' },
    { value: 'char_name', label: '角色名存在' },
    { value: 'loc_name', label: '地点名存在' },
    { value: 'region_name', label: '区域名存在' },
    { value: 'history', label: '近期故事检查 (轮)' },
    { value: 'natural_language', label: '自然语言条件 (可影响性能)' },
    { value: 'specific_round_type', label: '特定轮次类型' },
    { value: 'current_location', label: '当前地点检查' },
];

const COMPARATORS = ['>', '>=', '=', '!=', '<', '<='];
const STR_COMPARATORS = [
    { value: 'exists', label: '存在' },
    { value: 'not_exists', label: '不存在' },
    { value: 'contains', label: '包含' },
    { value: 'exact', label: '完全匹配' },
];

const PHASES: TriggerPhase[] = [
    'determineCharacterAction',
    'determineCharacterReaction',
    'determineTurnOrder', // Now purely a logic trigger, not AI
    'hidden_round_1',
    'hidden_round_2',
    'hidden_round_3',
    'hidden_round_4',
    'hidden_round_5',
    'checkConditionsBatch',
    'generateCharacter',
    'generateLocationDetails',
    'analyzeSettlement',
    'generateLife',
    'generateUnveil',
    'observation', // Updated name
    'storysuggest' // Updated name
];

// Internal Component: Trigger Selection Modal
const TriggerSelectionModal: React.FC<{
    triggers: Trigger[];
    selectedIds: string[];
    onConfirm: (ids: string[]) => void;
    onClose: () => void;
}> = ({ triggers, selectedIds, onConfirm, onClose }) => {
    const [currentSelection, setCurrentSelection] = useState<Set<string>>(new Set(selectedIds));

    const toggle = (id: string) => {
        const next = new Set(currentSelection);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setCurrentSelection(next);
    };

    return createPortal(
        <div className="fixed inset-0 z-[300] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-surface border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-3 border-b border-border font-bold text-sm bg-surface-highlight flex justify-between items-center">
                    <span className="flex items-center gap-2"><ToggleRight size={16}/> 选择触发器 (多选)</span>
                    <button onClick={onClose}><X size={16}/></button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {triggers.map(t => {
                        const isSelected = currentSelection.has(t.id);
                        return (
                            <div 
                                key={t.id} 
                                onClick={() => toggle(t.id)}
                                className={`p-2 rounded border cursor-pointer flex justify-between items-center ${isSelected ? 'bg-primary/20 border-primary' : 'bg-surface border-border hover:bg-surface-highlight'}`}
                            >
                                <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-bold truncate">{t.name}</span>
                                    <span className="text-[10px] text-muted font-mono">{t.id}</span>
                                </div>
                                {isSelected && <CheckCircle size={14} className="text-primary"/>}
                            </div>
                        )
                    })}
                </div>
                <div className="p-3 border-t border-border flex justify-end gap-2 bg-surface-highlight">
                    <Button variant="secondary" onClick={onClose} size="sm">取消</Button>
                    <Button onClick={() => onConfirm(Array.from(currentSelection))} size="sm">确认选择 ({currentSelection.size})</Button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export const TriggerPoolWindow: React.FC<TriggerPoolWindowProps> = ({ winId, state, updateState, closeWindow, addLog }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    
    // Group State - Changed to single string for accordion style
    const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
    const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
    const [tempGroupName, setTempGroupName] = useState("");
    const [deleteGroupConfirmId, setDeleteGroupConfirmId] = useState<string | null>(null);
    
    // Time Picker State
    const [timePickerTarget, setTimePickerTarget] = useState<{ triggerId: string, condId: string, value: string, isDisableCond: boolean } | null>(null);

    // Card Selector State for Effect Editor
    const [cardSelector, setCardSelector] = useState<{ triggerId: string, effectId: string } | null>(null);

    // Trigger Selector State for Effect Editor
    const [triggerSelector, setTriggerSelector] = useState<{ triggerId: string, effectId: string } | null>(null);

    const triggers = Object.values(state.triggers || {}) as Trigger[];
    const triggerGroups = Object.values(state.triggerGroups || {}) as TriggerGroup[];
    
    const locations = Object.values(state.map.locations) as MapLocation[];
    const characters = Object.values(state.characters) as Character[];
    const cardPool = state.cardPool || [];

    // Grouping Logic
    const groupedTriggers = useMemo(() => {
        const groups: Record<string, Trigger[]> = {};
        const ungrouped: Trigger[] = [];
        
        // Initialize groups
        triggerGroups.forEach(g => {
            groups[g.id] = [];
        });
        
        triggers.forEach(t => {
            if (t.groupId && groups[t.groupId]) {
                groups[t.groupId].push(t);
            } else {
                ungrouped.push(t);
            }
        });
        
        return { groups, ungrouped };
    }, [triggers, triggerGroups]);

    // Helpers for unique ID collection across the entire state
    const collectAllConditionIds = () => {
        const ids = new Set<string>();
        triggers.forEach(t => {
            t.conditions.forEach(c => ids.add(c.id));
            t.disableConditions?.forEach(c => ids.add(c.id));
        });
        return ids;
    };

    const collectAllEffectIds = () => {
        const ids = new Set<string>();
        triggers.forEach(t => {
            t.effects?.forEach(e => ids.add(e.id));
        });
        return ids;
    };

    // --- Group Actions ---
    const handleCreateGroup = () => {
        const newId = generateTriggerGroupId(state.triggerGroups || {});
        const newGroup: TriggerGroup = {
            id: newId,
            name: "新触发组",
            description: ""
        };
        updateState(prev => ({
            ...prev,
            triggerGroups: { ...(prev.triggerGroups || {}), [newId]: newGroup }
        }));
        // Auto expand
        setExpandedGroupId(newId);
        
        // Auto start renaming
        setRenamingGroupId(newId);
        setTempGroupName("新触发组");
    };

    const handleDeleteGroup = (groupId: string) => {
        if (deleteGroupConfirmId === groupId) {
            updateState(prev => {
                const nextGroups = { ...(prev.triggerGroups || {}) };
                delete nextGroups[groupId];
                
                // Cascade delete triggers in this group
                const nextTriggers = { ...prev.triggers };
                Object.keys(nextTriggers).forEach(tid => {
                    if (nextTriggers[tid].groupId === groupId) {
                        delete nextTriggers[tid];
                    }
                });

                return { ...prev, triggerGroups: nextGroups, triggers: nextTriggers };
            });
            setDeleteGroupConfirmId(null);
            addLog(`系统: 分组及其包含的触发器已删除。`);
        } else {
            setDeleteGroupConfirmId(groupId);
            setTimeout(() => setDeleteGroupConfirmId(null), 3000);
        }
    };

    const handleRenameGroupStart = (group: TriggerGroup) => {
        setRenamingGroupId(group.id);
        setTempGroupName(group.name);
    };

    const handleRenameGroupSave = () => {
        if (renamingGroupId) {
            updateState(prev => ({
                ...prev,
                triggerGroups: {
                    ...prev.triggerGroups,
                    [renamingGroupId]: { ...prev.triggerGroups[renamingGroupId], name: tempGroupName }
                }
            }));
            setRenamingGroupId(null);
        }
    };
    
    const handleCopyGroup = (group: TriggerGroup) => {
        const newGroupId = generateTriggerGroupId(state.triggerGroups || {});
        const newGroup: TriggerGroup = {
            ...group,
            id: newGroupId,
            name: `${group.name} (复制)`
        };
        
        // Copy triggers
        const triggersToCopy = groupedTriggers.groups[group.id] || [];
        const newTriggers: Record<string, Trigger> = {};
        
        // Prepare ID Sets
        const usedTrigIds = new Set(Object.keys(state.triggers));
        const usedCondIds = collectAllConditionIds();
        const usedEffIds = collectAllEffectIds();

        triggersToCopy.forEach(t => {
            const newTId = generateTriggerId(usedTrigIds);
            usedTrigIds.add(newTId);

            newTriggers[newTId] = {
                ...t,
                id: newTId,
                groupId: newGroupId,
                // Regenerate inner IDs
                conditions: t.conditions.map(c => {
                    const cid = generateConditionId(usedCondIds);
                    usedCondIds.add(cid);
                    return { ...c, id: cid };
                }),
                disableConditions: (t.disableConditions || []).map(c => {
                    const cid = generateConditionId(usedCondIds);
                    usedCondIds.add(cid);
                    return { ...c, id: cid };
                }),
                effects: (t.effects || []).map(e => {
                    const eid = generateEffectId(usedEffIds);
                    usedEffIds.add(eid);
                    return { ...e, id: eid };
                }),
                narrativeLogs: t.narrativeLogs ? [...t.narrativeLogs] : [t.systemLog]
            };
        });

        updateState(prev => ({
            ...prev,
            triggerGroups: { ...(prev.triggerGroups || {}), [newGroupId]: newGroup },
            triggers: { ...prev.triggers, ...newTriggers }
        }));
        
        setExpandedGroupId(newGroupId);
        addLog(`系统: 已复制分组 [${group.name}] 及 ${triggersToCopy.length} 个触发器。`);
    };

    const toggleGroupExpand = (groupId: string) => {
        setExpandedGroupId(prev => prev === groupId ? null : groupId);
    };

    // --- Trigger Actions ---
    const handleCreateTrigger = (targetGroupId?: string) => {
        const newId = generateTriggerId(Object.keys(state.triggers || {}));
        const newTrigger: Trigger = {
            id: newId,
            name: "新触发器",
            groupId: targetGroupId, // Assign group if provided
            phase: ['determineCharacterAction'],
            conditions: [],
            disableConditions: [],
            urgentRequirement: "",
            isUrgent: false,
            effects: [],
            systemLog: "",
            narrativeLogs: [], 
            enabled: true,
            maxTriggers: -1
        };
        updateState(prev => ({
            ...prev,
            triggers: { ...(prev.triggers || {}), [newId]: newTrigger }
        }));
        setExpandedId(newId);
        
        // If created in a group, insure group is expanded
        if (targetGroupId) {
            setExpandedGroupId(targetGroupId);
        }
    };
    
    const handleDuplicateTrigger = (original: Trigger) => {
        const newId = generateTriggerId(Object.keys(state.triggers || {}));
        
        // Prepare ID Sets
        const usedCondIds = collectAllConditionIds();
        const usedEffIds = collectAllEffectIds();

        const newTrigger: Trigger = {
            ...original,
            id: newId,
            name: `${original.name} (复制)`,
            // Regenerate condition IDs to avoid shared reference issues
            conditions: original.conditions.map(c => {
                const cid = generateConditionId(usedCondIds);
                usedCondIds.add(cid);
                return { ...c, id: cid };
            }),
            disableConditions: (original.disableConditions || []).map(c => {
                const cid = generateConditionId(usedCondIds);
                usedCondIds.add(cid);
                return { ...c, id: cid };
            }),
            effects: (original.effects || []).map(e => {
                const eid = generateEffectId(usedEffIds);
                usedEffIds.add(eid);
                return { ...e, id: eid };
            }),
            narrativeLogs: original.narrativeLogs ? [...original.narrativeLogs] : [original.systemLog] // Clone logs
        };
        updateState(prev => ({
            ...prev,
            triggers: { ...(prev.triggers || {}), [newId]: newTrigger }
        }));
        setExpandedId(newId);
        addLog(`系统: 已复制触发器 [${original.name}]`);
    };

    const handleUpdateTrigger = (id: string, updates: Partial<Trigger>) => {
        updateState(prev => ({
            ...prev,
            triggers: {
                ...prev.triggers,
                [id]: { ...prev.triggers[id], ...updates }
            }
        }));
    };

    // Narrative Log List Management
    const handleAddNarrativeLog = (triggerId: string) => {
        const trigger = state.triggers[triggerId];
        if (!trigger) return;
        
        const currentLogs = trigger.narrativeLogs || (trigger.systemLog ? [trigger.systemLog] : []);
        const newLogs = [...currentLogs, ""];
        
        handleUpdateTrigger(triggerId, { 
            narrativeLogs: newLogs,
            systemLog: newLogs[0] || ""
        });
    };

    const handleUpdateNarrativeLog = (triggerId: string, idx: number, val: string) => {
        const trigger = state.triggers[triggerId];
        if (!trigger) return;
        
        const currentLogs = [...(trigger.narrativeLogs || (trigger.systemLog ? [trigger.systemLog] : [""]))];
        currentLogs[idx] = val;
        
        handleUpdateTrigger(triggerId, { 
            narrativeLogs: currentLogs,
            systemLog: currentLogs[0] || "" 
        });
    };

    const handleDeleteNarrativeLog = (triggerId: string, idx: number) => {
        const trigger = state.triggers[triggerId];
        if (!trigger) return;
        
        const currentLogs = [...(trigger.narrativeLogs || [])];
        currentLogs.splice(idx, 1);
        
        handleUpdateTrigger(triggerId, { 
            narrativeLogs: currentLogs,
            systemLog: currentLogs[0] || "" 
        });
    };

    const handleDeleteTrigger = (id: string) => {
        if (deleteConfirmId === id) {
            updateState(prev => {
                const next = { ...prev.triggers };
                delete next[id];
                return { ...prev, triggers: next };
            });
            setDeleteConfirmId(null);
        } else {
            setDeleteConfirmId(id);
            setTimeout(() => setDeleteConfirmId(null), 3000);
        }
    };
    
    const handleResetActiveConditions = () => {
        updateState(prev => ({
            ...prev,
            world: {
                ...prev.world,
                activeLanguageConditions: []
            }
        }));
        addLog("系统: 已重置所有活跃的自然语言条件状态。");
    };

    // --- CONDITION MANAGEMENT ---
    const handleAddCondition = (triggerId: string, isDisable: boolean = false) => {
        const allCondIds = collectAllConditionIds();
        const newCondId = generateConditionId(allCondIds);
        
        const newCond: TriggerCondition = {
            id: newCondId,
            type: 'char_attr',
            comparator: '>',
            value: 0
        };
        const trigger = state.triggers[triggerId];
        if (trigger) {
            if (isDisable) {
                handleUpdateTrigger(triggerId, { disableConditions: [...(trigger.disableConditions || []), newCond] });
            } else {
                handleUpdateTrigger(triggerId, { conditions: [...trigger.conditions, newCond] });
            }
        }
    };

    const handleUpdateCondition = (triggerId: string, condId: string, updates: Partial<TriggerCondition>, isDisable: boolean = false) => {
        const trigger = state.triggers[triggerId];
        if (!trigger) return;
        
        if (isDisable) {
             const newConditions = (trigger.disableConditions || []).map(c => c.id === condId ? { ...c, ...updates } : c);
             handleUpdateTrigger(triggerId, { disableConditions: newConditions });
        } else {
             const newConditions = trigger.conditions.map(c => c.id === condId ? { ...c, ...updates } : c);
             handleUpdateTrigger(triggerId, { conditions: newConditions });
        }
    };

    const handleRemoveCondition = (triggerId: string, condId: string, isDisable: boolean = false) => {
        const trigger = state.triggers[triggerId];
        if (!trigger) return;
        
        if (isDisable) {
            const newConditions = (trigger.disableConditions || []).filter(c => c.id !== condId);
            handleUpdateTrigger(triggerId, { disableConditions: newConditions });
        } else {
            const newConditions = trigger.conditions.filter(c => c.id !== condId);
            handleUpdateTrigger(triggerId, { conditions: newConditions });
        }
    };

    // --- EFFECT MANAGEMENT ---
    const handleAddEffect = (triggerId: string) => {
        const allEffIds = collectAllEffectIds();
        const newEffId = generateEffectId(allEffIds);

        const newEff: TriggerEffect = {
            id: newEffId,
            type: 'char_attr',
            targetName: '健康',
            operation: 'set',
            value: '0'
        };
        const trigger = state.triggers[triggerId];
        if (trigger) {
            handleUpdateTrigger(triggerId, { effects: [...(trigger.effects || []), newEff] });
        }
    };

    const handleUpdateEffect = (triggerId: string, effectId: string, updates: Partial<TriggerEffect>) => {
        const trigger = state.triggers[triggerId];
        if (!trigger) return;
        const newEffects = (trigger.effects || []).map(e => e.id === effectId ? { ...e, ...updates } : e);
        handleUpdateTrigger(triggerId, { effects: newEffects });
    };

    const handleRemoveEffect = (triggerId: string, effectId: string) => {
        const trigger = state.triggers[triggerId];
        if (!trigger) return;
        const newEffects = (trigger.effects || []).filter(e => e.id !== effectId);
        handleUpdateTrigger(triggerId, { effects: newEffects });
    };

    const handleCardSelection = (cardIds: string[]) => {
        if (!cardSelector) return;
        // Format as JSON string for storage
        handleUpdateEffect(cardSelector.triggerId, cardSelector.effectId, { cardValue: JSON.stringify(cardIds) });
        setCardSelector(null);
    };
    
    const handleTriggerSelection = (triggerIds: string[]) => {
        if (!triggerSelector) return;
        handleUpdateEffect(triggerSelector.triggerId, triggerSelector.effectId, { targetTriggerIds: triggerIds });
        setTriggerSelector(null);
    };

    // Helper to render character options with grouping
    const renderCharacterOptions = (filterLocId: string | undefined) => {
        const allChars = characters;
        let local: Character[] = [];
        let others: Character[] = [];

        if (!filterLocId || filterLocId === 'all') {
            others = allChars;
        } else {
            allChars.forEach(c => {
                const pos = state.map.charPositions[c.id];
                if (pos && pos.locationId === filterLocId) {
                    local.push(c);
                } else {
                    others.push(c);
                }
            });
        }

        return (
            <>
                <option value="all">所有角色 (All Characters)</option>
                <option value="current" className="text-primary font-bold">★ 当前角色 (Context/Active)</option>
                
                {local.length > 0 && (
                    <optgroup label="当前地点角色">
                        {local.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                )}
                
                {others.length > 0 && (
                    <optgroup label={local.length > 0 ? "世界其他角色" : "世界角色列表"}>
                        {others.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                )}
            </>
        );
    };

    // --- RENDERERS ---

    const renderConditionEditor = (tId: string, cond: TriggerCondition, index: number, isDisable: boolean = false) => {
        return (
            <div key={cond.id} className={`p-2 mb-2 flex flex-col gap-2 border rounded ${isDisable ? 'bg-black/10 border-muted' : 'bg-surface-light border-border'}`}>
                <div className="flex justify-between items-center border-b border-border/50 pb-1">
                    <span className={`text-xs font-bold flex items-center gap-2 ${isDisable ? 'text-muted' : 'text-primary'}`}>
                        {isDisable ? "禁用条件" : "触发条件"} #{index + 1} 
                        <span className="text-[9px] font-mono text-muted bg-surface/50 px-1 rounded border border-border/50">ID: {cond.id}</span>
                        {!isDisable && <span className="text-[9px] text-faint opacity-70">(Macro: {`{{condition ${index + 1}}`})</span>}
                    </span>
                    <button onClick={() => handleRemoveCondition(tId, cond.id, isDisable)} className="text-muted hover:text-danger-fg"><Trash2 size={12}/></button>
                </div>
                
                <div className="flex gap-2">
                    <select 
                        className="flex-1 bg-surface border border-border rounded text-xs p-1 text-body"
                        value={cond.type}
                        onChange={e => handleUpdateCondition(tId, cond.id, { type: e.target.value as ConditionType }, isDisable)}
                    >
                        {CONDITION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>

                <div className="flex flex-col gap-2">
                    {cond.type === 'natural_language' && (
                        <div>
                             <TextArea 
                                className="w-full h-16 text-xs resize-none"
                                placeholder="描述条件，例如：当任意角色试图攻击平民时..."
                                value={cond.targetName || ""} 
                                onChange={e => handleUpdateCondition(tId, cond.id, { targetName: e.target.value }, isDisable)}
                            />
                            <p className="text-[9px] text-muted mt-1">
                                {isDisable 
                                    ? "若AI结算时满足此描述，触发器将被禁用。" 
                                    : "AI 将在每轮结算时根据故事发展判断此条件是否满足。"}
                            </p>
                        </div>
                    )}
                    
                    {(cond.type === 'char_attr' || cond.type === 'char_card') && (
                        <>
                            <div className="flex gap-2">
                                <select 
                                    className="flex-1 bg-surface border border-border rounded text-xs p-1 text-body"
                                    value={cond.locationId || 'all'}
                                    onChange={e => handleUpdateCondition(tId, cond.id, { locationId: e.target.value }, isDisable)}
                                >
                                    <option value="all">所有地点 (All Locations)</option>
                                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                                </select>
                                <select 
                                    className="flex-1 bg-surface border border-border rounded text-xs p-1 text-body"
                                    value={cond.characterId || 'all'}
                                    onChange={e => handleUpdateCondition(tId, cond.id, { characterId: e.target.value }, isDisable)}
                                >
                                    {renderCharacterOptions(cond.locationId)}
                                </select>
                            </div>
                            <Input 
                                className="text-xs h-7" 
                                placeholder={cond.type === 'char_attr' ? "属性名称 (Attribute Name)" : "卡牌名称 (Card Name)"}
                                value={cond.targetName || ""}
                                onChange={e => handleUpdateCondition(tId, cond.id, { targetName: e.target.value }, isDisable)}
                            />
                        </>
                    )}

                    {(cond.type === 'char_name' || cond.type === 'loc_name' || cond.type === 'region_name' || cond.type === 'world_attr') && (
                        <Input 
                            className="text-xs h-7" 
                            placeholder="名称 / 键名 (Name/Key)"
                            value={cond.targetName || ""}
                            onChange={e => handleUpdateCondition(tId, cond.id, { targetName: e.target.value }, isDisable)}
                        />
                    )}

                    {cond.type === 'history' && (
                        <div className="flex items-center gap-2">
                            <Label>检查最近</Label>
                            <Input 
                                type="number" 
                                className="w-12 h-7 text-xs text-center" 
                                value={cond.historyRounds || 5}
                                onChange={e => handleUpdateCondition(tId, cond.id, { historyRounds: parseInt(e.target.value) }, isDisable)}
                            />
                            <Label>轮</Label>
                        </div>
                    )}

                    {cond.type === 'specific_round_type' && (
                        <div className="flex flex-col gap-1 bg-surface border border-border rounded p-2">
                            <Label className="text-[10px] text-muted mb-1">选择生效的轮次类型 (多选)</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { val: 'normal', label: '普通轮次 (Normal)' },
                                    { val: 'hidden_1', label: '隐藏轮次 1' },
                                    { val: 'hidden_2', label: '隐藏轮次 2' },
                                    { val: 'hidden_3', label: '隐藏轮次 3' },
                                    { val: 'hidden_4', label: '隐藏轮次 4' },
                                    { val: 'hidden_5', label: '隐藏轮次 5' },
                                ].map(opt => {
                                    const isSelected = (cond.targetRoundTypes || []).includes(opt.val);
                                    return (
                                        <label key={opt.val} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-highlight rounded p-1">
                                            <input 
                                                type="checkbox" 
                                                checked={isSelected}
                                                onChange={() => {
                                                    const current = new Set(cond.targetRoundTypes || []);
                                                    if (current.has(opt.val)) current.delete(opt.val);
                                                    else current.add(opt.val);
                                                    handleUpdateCondition(tId, cond.id, { targetRoundTypes: Array.from(current) }, isDisable);
                                                }}
                                                className="accent-primary"
                                            />
                                            {opt.label}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {cond.type === 'current_location' && (
                        <div className="flex flex-col gap-1 bg-surface border border-border rounded p-2">
                            <Label className="text-[10px] text-muted mb-1">选择生效的地点 (多选)</Label>
                            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                                {locations
                                    .filter(l => l.name !== '未知地点')
                                    .map(l => {
                                        const isSelected = (cond.targetLocationNames || []).includes(l.name);
                                        return (
                                            <label key={l.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-highlight rounded p-1">
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected}
                                                    onChange={() => {
                                                        const current = new Set(cond.targetLocationNames || []);
                                                        if (current.has(l.name)) current.delete(l.name);
                                                        else current.add(l.name);
                                                        handleUpdateCondition(tId, cond.id, { targetLocationNames: Array.from(current) }, isDisable);
                                                    }}
                                                    className="accent-primary"
                                                />
                                                <span className="truncate" title={l.name}>{l.name}</span>
                                            </label>
                                        );
                                    })}
                            </div>
                        </div>
                    )}

                    {cond.type !== 'natural_language' && cond.type !== 'specific_round_type' && cond.type !== 'current_location' && (
                        <div className="flex gap-2">
                            <select 
                                className="w-24 bg-surface border border-border rounded text-xs p-1 text-body"
                                value={cond.comparator}
                                onChange={e => handleUpdateCondition(tId, cond.id, { comparator: e.target.value as any }, isDisable)}
                            >
                                {(cond.type === 'char_attr' || cond.type === 'world_time' || cond.type === 'world_attr') ? (
                                    COMPARATORS.map(c => <option key={c} value={c}>{c}</option>)
                                ) : (
                                    STR_COMPARATORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)
                                )}
                            </select>
                            
                            {['exists', 'not_exists'].includes(cond.comparator) ? (
                                <div className="flex-1 bg-surface-highlight rounded flex items-center px-2 text-xs text-muted italic border border-border">
                                    (无需数值)
                                </div>
                            ) : cond.type === 'world_time' ? (
                                <Button 
                                    variant="secondary" 
                                    className="flex-1 h-7 text-xs flex items-center gap-2 justify-start font-mono"
                                    onClick={() => setTimePickerTarget({ 
                                        triggerId: tId, 
                                        condId: cond.id, 
                                        value: String(cond.value || state.world.attributes.worldTime?.value || "2077:01:01:00:00:00"),
                                        isDisableCond: isDisable
                                    })}
                                >
                                    <Clock size={12}/> {String(cond.value || "设定时间")}
                                </Button>
                            ) : (
                                <Input 
                                    className="flex-1 text-xs h-7" 
                                    placeholder="比较值 (Value)"
                                    value={cond.value}
                                    onChange={e => handleUpdateCondition(tId, cond.id, { value: e.target.value }, isDisable)}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderEffectEditor = (tId: string, eff: TriggerEffect, index: number) => {
        return (
            <div key={eff.id} className="p-2 mb-2 flex flex-col gap-2 border rounded bg-surface-light border-border">
                <div className="flex justify-between items-center border-b border-border/50 pb-1">
                    <span className="text-xs font-bold flex items-center gap-2 text-success-fg">
                        <Activity size={12}/> 效果 #{index + 1}
                        <span className="text-[9px] font-mono text-muted bg-surface/50 px-1 rounded border border-border/50">ID: {eff.id}</span>
                    </span>
                    <button onClick={() => handleRemoveEffect(tId, eff.id)} className="text-muted hover:text-danger-fg"><Trash2 size={12}/></button>
                </div>

                {/* Effect Type */}
                <div className="flex gap-2">
                    <select 
                        className="flex-1 bg-surface border border-border rounded text-xs p-1 text-body"
                        value={eff.type}
                        onChange={e => handleUpdateEffect(tId, eff.id, { type: e.target.value as any })}
                    >
                        <option value="char_attr">角色属性 (Character Attribute)</option>
                        <option value="char_card">角色卡牌 (Character Card)</option>
                        <option value="world_attr">世界属性 (World Attribute)</option>
                        <option value="trigger_toggle">触发器开关 (Trigger Toggle)</option>
                    </select>
                </div>

                {eff.type !== 'world_attr' && eff.type !== 'trigger_toggle' && (
                    <div className="flex gap-2">
                        <select 
                            className="flex-1 bg-surface border border-border rounded text-xs p-1 text-body"
                            value={eff.locationId || 'all'}
                            onChange={e => handleUpdateEffect(tId, eff.id, { locationId: e.target.value })}
                        >
                            <option value="all">所有地点 (All Locs)</option>
                            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <select 
                            className="flex-1 bg-surface border border-border rounded text-xs p-1 text-body"
                            value={eff.characterId || 'current'}
                            onChange={e => handleUpdateEffect(tId, eff.id, { characterId: e.target.value })}
                        >
                            {renderCharacterOptions(eff.locationId)}
                        </select>
                    </div>
                )}

                {(eff.type === 'char_attr' || eff.type === 'world_attr') && (
                    <div className="flex gap-2 items-center">
                        {eff.type === 'world_attr' && <Globe size={16} className="text-muted shrink-0"/>}
                        <Input 
                            className="text-xs h-7 flex-1" 
                            placeholder="属性名 (e.g. 健康)"
                            value={eff.targetName || ""}
                            onChange={e => handleUpdateEffect(tId, eff.id, { targetName: e.target.value })}
                        />
                        <span className="text-xs">=</span>
                        <Input 
                            className="text-xs h-7 flex-1" 
                            placeholder="值/表达式 (e.g. 2a+5)"
                            value={eff.value || ""}
                            onChange={e => handleUpdateEffect(tId, eff.id, { value: e.target.value })}
                        />
                        <span className="text-[9px] text-muted whitespace-nowrap" title="a代表当前值, 若属性不存在则默认为50">a=Current/50</span>
                    </div>
                )}
                
                {eff.type === 'trigger_toggle' && (
                    <div className="flex flex-col gap-2">
                        <div className="flex gap-4 items-center">
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                                <input 
                                    type="radio" 
                                    checked={eff.triggerOperation === 'enable'} 
                                    onChange={() => handleUpdateEffect(tId, eff.id, { triggerOperation: 'enable' })}
                                    className="accent-success-fg"
                                />
                                启用 (Enable)
                            </label>
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                                <input 
                                    type="radio" 
                                    checked={eff.triggerOperation === 'disable'} 
                                    onChange={() => handleUpdateEffect(tId, eff.id, { triggerOperation: 'disable' })}
                                    className="accent-danger-fg"
                                />
                                禁用 (Disable)
                            </label>
                        </div>
                        
                        <div className="bg-surface border border-border rounded p-2 text-xs">
                            <div className="flex justify-between items-center mb-1">
                                <span>目标触发器 ({eff.targetTriggerIds?.length || 0})</span>
                                <Button size="sm" variant="secondary" onClick={() => setTriggerSelector({ triggerId: tId, effectId: eff.id })} className="h-6 text-[10px]">
                                    <ListPlus size={10} className="mr-1"/> 选择...
                                </Button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {(eff.targetTriggerIds || []).map(trigId => {
                                    const t = triggers.find(tr => tr.id === trigId);
                                    return (
                                        <span key={trigId} className="px-1.5 py-0.5 bg-warning-base/20 rounded border border-warning-base/30 text-[9px] truncate max-w-[150px] text-warning-fg">
                                            {t ? t.name : trigId}
                                        </span>
                                    );
                                })}
                                {(eff.targetTriggerIds || []).length === 0 && <span className="text-[9px] text-muted italic">未选择触发器</span>}
                            </div>
                        </div>
                    </div>
                )}

                {eff.type === 'char_card' && (
                    <div className="flex flex-col gap-2">
                        <div className="flex gap-4 items-center">
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                                <input 
                                    type="radio" 
                                    checked={eff.cardOperation !== 'remove'} 
                                    onChange={() => handleUpdateEffect(tId, eff.id, { cardOperation: 'add', cardValue: '[]' })}
                                    className="accent-primary"
                                />
                                添加卡牌
                            </label>
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                                <input 
                                    type="radio" 
                                    checked={eff.cardOperation === 'remove'} 
                                    onChange={() => handleUpdateEffect(tId, eff.id, { cardOperation: 'remove', cardValue: '' })}
                                    className="accent-danger-fg"
                                />
                                移除卡牌
                            </label>
                        </div>
                        
                        {eff.cardOperation === 'remove' ? (
                            <Input 
                                className="text-xs h-7" 
                                placeholder="卡牌名称关键字 (逗号分隔)"
                                value={eff.cardValue || ""}
                                onChange={e => handleUpdateEffect(tId, eff.id, { cardValue: e.target.value })}
                            />
                        ) : (
                            <div className="bg-surface border border-border rounded p-2 text-xs">
                                <div className="flex justify-between items-center mb-1">
                                    <span>已选卡牌 ({(JSON.parse(eff.cardValue || "[]") as string[]).length})</span>
                                    <Button size="sm" variant="secondary" onClick={() => setCardSelector({ triggerId: tId, effectId: eff.id })} className="h-6 text-[10px]">
                                        <Package size={10} className="mr-1"/> 选择...
                                    </Button>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {(JSON.parse(eff.cardValue || "[]") as string[]).map(cid => {
                                        const c = cardPool.find(p => p.id === cid);
                                        return (
                                            <span key={cid} className="px-1.5 py-0.5 bg-primary/20 rounded border border-primary/30 text-[9px] truncate max-w-[100px]">
                                                {c ? c.name : cid}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderTrigger = (trigger: Trigger) => {
        const tPhases = Array.isArray(trigger.phase) ? trigger.phase : [trigger.phase];
        
        return (
        <div key={trigger.id} className={`bg-surface border ${trigger.enabled ? 'border-border' : 'border-border/50 opacity-80'} rounded-lg overflow-hidden transition-all shadow-sm`}>
            {/* Header Row */}
            <div 
                className={`p-3 flex items-center justify-between cursor-pointer hover:bg-surface-highlight ${expandedId === trigger.id ? 'bg-surface-highlight border-b border-border' : ''}`}
                onClick={() => setExpandedId(expandedId === trigger.id ? null : trigger.id)}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="cursor-pointer shrink-0" title={trigger.enabled ? "已启用" : "已禁用"}>
                        {trigger.enabled ? <CheckCircle size={18} className="text-success-fg"/> : <div className="w-[18px] h-[18px] rounded-full border-2 border-muted"/>}
                    </div>
                    <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                            <span className={`font-bold text-sm truncate ${trigger.enabled ? 'text-body' : 'text-muted line-through'}`}>{trigger.name}</span>
                            {trigger.isUrgent && <span className="text-[9px] bg-red-600 text-white px-1.5 rounded font-bold">紧急</span>}
                        </div>
                    </div>
                    
                    <div className="flex gap-1 overflow-hidden hidden sm:flex">
                        {tPhases.map(p => (
                            <span key={p} className="text-[9px] bg-surface-light px-1.5 py-0.5 rounded text-muted font-mono border border-border truncate max-w-[80px]">{p}</span>
                        ))}
                    </div>
                    
                    {trigger.maxTriggers !== undefined && trigger.maxTriggers > -1 && (
                        <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded border border-primary/30 flex items-center gap-1 shrink-0">
                            <Hash size={10}/> {trigger.maxTriggers}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={(e) => { e.stopPropagation(); handleUpdateTrigger(trigger.id, { enabled: !trigger.enabled }); }}
                        className={`p-1.5 rounded transition-all ${trigger.enabled ? 'text-success-fg hover:bg-success-base/20' : 'text-muted hover:bg-surface-light'}`}
                    >
                        <Power size={14}/>
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleDuplicateTrigger(trigger); }} 
                        className="p-1.5 rounded transition-all text-muted hover:text-body hover:bg-surface-light"
                    >
                        <Copy size={14}/>
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteTrigger(trigger.id); }} 
                        className={`p-1.5 rounded transition-all flex items-center justify-center ${deleteConfirmId === trigger.id ? 'text-white bg-danger' : 'text-muted hover:text-danger-fg hover:bg-surface-light'}`}
                    >
                        <Trash2 size={14} className={deleteConfirmId === trigger.id ? "animate-pulse" : ""}/>
                    </button>
                    {expandedId === trigger.id ? <ChevronUp size={16} className="text-muted"/> : <ChevronDown size={16} className="text-muted"/>}
                </div>
            </div>

            {/* Expanded Content */}
            {expandedId === trigger.id && (
                <div className="p-4 bg-surface-light/50 animate-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left Column: Logic */}
                        <div className="space-y-4">
                            <div>
                                <Label>触发器名称</Label>
                                <Input value={trigger.name} onChange={e => handleUpdateTrigger(trigger.id, { name: e.target.value })} />
                            </div>
                            
                            <div>
                                <Label>所属分组</Label>
                                <select 
                                    className="w-full bg-surface border border-border rounded px-2 py-2 text-xs text-body"
                                    value={trigger.groupId || ""}
                                    onChange={e => handleUpdateTrigger(trigger.id, { groupId: e.target.value || undefined })}
                                >
                                    <option value="">(无分组)</option>
                                    {triggerGroups.map(g => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                            </div>
                            
                            <div>
                                <Label>生效阶段 (Phases)</Label>
                                <div className="flex flex-col gap-1 mt-1 bg-surface p-2 rounded border border-border max-h-40 overflow-y-auto custom-scrollbar">
                                    {PHASES.map(p => {
                                        const currentPhases = Array.isArray(trigger.phase) ? trigger.phase : [trigger.phase];
                                        const isSelected = currentPhases.includes(p);
                                        return (
                                            <label key={p} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-highlight p-1 rounded">
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected}
                                                    onChange={(e) => {
                                                        let newPhases = [...currentPhases];
                                                        if (e.target.checked) newPhases.push(p);
                                                        else newPhases = newPhases.filter(ph => ph !== p);
                                                        handleUpdateTrigger(trigger.id, { phase: newPhases });
                                                    }}
                                                    className="accent-primary"
                                                />
                                                <span className={isSelected ? "text-primary font-bold" : "text-muted"}>{p}</span>
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>

                            <div>
                                <Label>自动禁用计数 (-1=无限)</Label>
                                <Input 
                                    type="number" 
                                    className="h-8 text-xs" 
                                    value={trigger.maxTriggers ?? -1} 
                                    onChange={e => handleUpdateTrigger(trigger.id, { maxTriggers: parseInt(e.target.value) })} 
                                    placeholder="-1"
                                />
                            </div>

                            {/* Disable Conditions */}
                            <div className="border-t border-border pt-2">
                                <div className="flex justify-between items-center mb-2">
                                    <Label className="text-muted flex items-center gap-1"><ShieldAlert size={12}/> 禁用条件 (Disable Conditions)</Label>
                                    <Button size="sm" variant="secondary" onClick={() => handleAddCondition(trigger.id, true)} className="h-6 text-xs opacity-80 hover:opacity-100">
                                        <Plus size={12}/> 添加禁用
                                    </Button>
                                </div>
                                <div className="space-y-2 mb-4">
                                     {(trigger.disableConditions || []).length === 0 && <div className="text-xs text-muted italic opacity-50">无禁用条件</div>}
                                     {(trigger.disableConditions || []).map((c, i) => renderConditionEditor(trigger.id, c, i, true))}
                                </div>
                            </div>

                            {/* Trigger Conditions */}
                            <div className="border-t border-border pt-2">
                                <div className="flex justify-between items-center mb-2">
                                    <Label className="text-primary flex items-center gap-1"><Zap size={12}/> 触发条件 (Trigger Conditions)</Label>
                                    <Button size="sm" variant="secondary" onClick={() => handleAddCondition(trigger.id, false)} className="h-6 text-xs">
                                        <Plus size={12}/> 添加触发
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {trigger.conditions.length === 0 && <div className="text-xs text-muted italic opacity-50">无条件 (总是触发)</div>}
                                    {trigger.conditions.map((c, i) => renderConditionEditor(trigger.id, c, i, false))}
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Outcomes */}
                        <div className="space-y-4 border-l-0 border-t lg:border-t-0 lg:border-l border-border pl-0 pt-4 lg:pt-0 lg:pl-6">
                            
                            {/* Requirement Section */}
                            <div className="bg-surface-light p-3 rounded border border-border">
                                <div className="flex justify-between items-center mb-2">
                                    <Label className="flex items-center gap-2">
                                        <Wand2 size={12}/> 需求 (Requirement)
                                    </Label>
                                    <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
                                        <span className={trigger.isUrgent ? "text-red-500 font-bold" : "text-muted"}>紧急模式</span>
                                        <input 
                                            type="checkbox" 
                                            checked={trigger.isUrgent || false} 
                                            onChange={e => handleUpdateTrigger(trigger.id, { isUrgent: e.target.checked })}
                                            className="accent-red-500"
                                        />
                                    </label>
                                </div>
                                <p className="text-[10px] text-muted mb-1">
                                    {trigger.isUrgent 
                                        ? "⚠️ 紧急模式效果强大但会影响系统稳定性。"
                                        : "追加到导演指令后。"
                                    }
                                </p>
                                <TextArea 
                                    className={`h-24 resize-none text-xs font-mono ${trigger.isUrgent ? "border-red-500/50 bg-red-900/10 focus:border-red-500" : ""}`}
                                    placeholder="例如: 你的{{condition 1}}过低，必须描述濒死状态..."
                                    value={trigger.urgentRequirement}
                                    onChange={e => handleUpdateTrigger(trigger.id, { urgentRequirement: e.target.value })}
                                />
                            </div>

                            {/* Narrative Logs */}
                            <div className="bg-surface-light p-3 rounded border border-border">
                                <div className="flex justify-between items-center mb-1">
                                    <Label className="flex items-center gap-1"><FileText size={12}/> 剧情日志 (Narrative Log)</Label>
                                    <Button size="sm" variant="ghost" onClick={() => handleAddNarrativeLog(trigger.id)} className="h-6 text-xs">
                                        <ListPlus size={12}/>
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {(trigger.narrativeLogs || [trigger.systemLog]).map((log, logIdx) => (
                                        <div key={logIdx} className="flex gap-2 items-start">
                                            <TextArea 
                                                className="h-16 resize-none text-xs flex-1" 
                                                placeholder="例如: [{{char_name}}] 突然感到一阵寒意..."
                                                value={log}
                                                onChange={e => handleUpdateNarrativeLog(trigger.id, logIdx, e.target.value)}
                                            />
                                            {(trigger.narrativeLogs || []).length > 1 && (
                                                <button 
                                                    onClick={() => handleDeleteNarrativeLog(trigger.id, logIdx)} 
                                                    className="text-muted hover:text-danger-fg pt-1"
                                                >
                                                    <Trash2 size={14}/>
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Effects Section */}
                            <div className="bg-surface-light p-3 rounded border border-border">
                                <div className="flex justify-between items-center mb-2">
                                    <Label className="text-success-fg flex items-center gap-2"><Activity size={12}/> 触发效果 (Effects)</Label>
                                    <Button size="sm" variant="secondary" onClick={() => handleAddEffect(trigger.id)} className="h-6 text-xs">
                                        <Plus size={12}/> 添加效果
                                    </Button>
                                </div>
                                <div className="space-y-2">
                                    {(trigger.effects || []).length === 0 && <div className="text-xs text-muted italic opacity-50">无效果</div>}
                                    {(trigger.effects || []).map((eff, i) => renderEffectEditor(trigger.id, eff, i))}
                                </div>
                            </div>

                            <div className="bg-primary/10 p-2 rounded border border-primary/30 text-[10px] text-primary">
                                <strong>可用宏 (Macros):</strong> <code>{'{{condition N}}'}</code> 获取第N个条件值。<br/>
                                <strong>效果公式:</strong> 属性值支持 <code>2a+5</code> (a=当前值)。
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
        );
    };

    return (
        <Window
            title={<span className="flex items-center gap-2"><Zap size={18} className="text-warning-fg"/> 触发器管理 (Trigger System)</span>}
            onClose={() => closeWindow(winId)}
            maxWidth="max-w-6xl"
            height="h-[90vh]"
            disableContentScroll={true}
            noPadding={true}
            headerActions={
                <Button size="sm" variant="ghost" onClick={handleResetActiveConditions} className="h-6 text-xs text-danger-fg hover:bg-danger/10" title="清空所有已激活的自然语言条件状态">
                    <RefreshCcw size={12} className="mr-1"/> 重置状态
                </Button>
            }
        >
            {timePickerTarget && createPortal(
                <WorldTimePicker
                    initialTime={timePickerTarget.value}
                    onCancel={() => setTimePickerTarget(null)}
                    onConfirm={(val) => {
                        handleUpdateCondition(timePickerTarget.triggerId, timePickerTarget.condId, { value: val }, timePickerTarget.isDisableCond);
                        setTimePickerTarget(null);
                    }}
                />,
                document.body
            )}
            
            {/* Card Selection Modal */}
            {cardSelector && createPortal(
                <div className="fixed inset-0 z-[300] bg-overlay flex items-center justify-center p-4" onClick={() => setCardSelector(null)}>
                    <div className="bg-surface border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-3 border-b border-border font-bold text-sm bg-surface-highlight flex justify-between">
                            <span>选择要添加的卡牌 (多选)</span>
                            <button onClick={() => setCardSelector(null)}><X size={16}/></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                            {cardPool.map(card => {
                                const currentIds = JSON.parse(state.triggers[cardSelector.triggerId].effects?.find(e => e.id === cardSelector.effectId)?.cardValue || "[]");
                                const isSelected = currentIds.includes(card.id);
                                return (
                                    <div 
                                        key={card.id} 
                                        onClick={() => {
                                            const newIds = isSelected 
                                                ? currentIds.filter((id: string) => id !== card.id)
                                                : [...currentIds, card.id];
                                            handleCardSelection(newIds);
                                        }}
                                        className={`p-2 rounded border cursor-pointer flex justify-between items-center ${isSelected ? 'bg-primary/20 border-primary' : 'bg-surface border-border hover:bg-surface-highlight'}`}
                                    >
                                        <span className="text-xs font-bold">{card.name}</span>
                                        <span className="text-[10px] text-muted">{card.itemType}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            {/* Trigger Selection Modal */}
            {triggerSelector && (
                <TriggerSelectionModal 
                    triggers={triggers}
                    selectedIds={state.triggers[triggerSelector.triggerId].effects?.find(e => e.id === triggerSelector.effectId)?.targetTriggerIds || []}
                    onClose={() => setTriggerSelector(null)}
                    onConfirm={handleTriggerSelection}
                />
            )}

            <div className="flex flex-col h-full overflow-hidden">
                {/* Toolbar */}
                <div className="p-2 border-b border-border bg-surface-highlight shrink-0 flex justify-between items-center">
                    <div className="flex gap-2">
                         <Button size="sm" variant="secondary" onClick={() => handleCreateTrigger()} className="flex items-center gap-1 shrink-0">
                             <Plus size={14}/> 触发器
                         </Button>
                         <Button size="sm" variant="secondary" onClick={handleCreateGroup} className="flex items-center gap-1 shrink-0">
                             <FolderOpen size={14}/> 触发组
                         </Button>
                    </div>
                </div>

                {/* Main List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-surface/30 custom-scrollbar">
                    {/* Render Groups */}
                    {triggerGroups.map(group => {
                         const isExpanded = expandedGroupId === group.id; // Changed to single select check
                         const isRenaming = renamingGroupId === group.id;
                         const groupTriggers = groupedTriggers.groups[group.id] || [];

                         return (
                             <div key={group.id} className="border border-border rounded-lg bg-surface/50 overflow-hidden shadow-sm">
                                 {/* Group Header */}
                                 <div 
                                     className="flex items-center justify-between p-3 bg-surface-highlight border-b border-border cursor-pointer select-none group"
                                     onClick={() => toggleGroupExpand(group.id)}
                                 >
                                     <div className="flex items-center gap-2">
                                         <div className="text-muted transition-transform duration-200">
                                             {isExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                                         </div>
                                         <Folder size={16} className="text-primary"/>
                                         
                                         {isRenaming ? (
                                             <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                 <Input 
                                                     autoFocus
                                                     value={tempGroupName}
                                                     onChange={e => setTempGroupName(e.target.value)}
                                                     className="h-6 w-40 text-xs font-bold"
                                                     onKeyDown={e => { if(e.key === 'Enter') handleRenameGroupSave(); }}
                                                 />
                                                 <button onClick={handleRenameGroupSave} className="p-1 rounded hover:bg-success-base/20 text-success-fg"><CheckCircle size={14}/></button>
                                             </div>
                                         ) : (
                                             <span className="font-bold text-sm text-body">{group.name}</span>
                                         )}
                                         <span className="text-xs text-muted">({groupTriggers.length})</span>
                                     </div>
                                     
                                     <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                         {!isRenaming && (
                                             <button onClick={() => handleRenameGroupStart(group)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-primary" title="重命名">
                                                 <Edit2 size={14}/>
                                             </button>
                                         )}
                                         <button onClick={() => handleCreateTrigger(group.id)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-success-fg" title="在此分组添加触发器">
                                             <Plus size={14}/>
                                         </button>
                                         <button onClick={() => handleCopyGroup(group)} className="p-1.5 rounded hover:bg-surface text-muted hover:text-body" title="复制分组">
                                             <Copy size={14}/>
                                         </button>
                                         <button 
                                             onClick={() => handleDeleteGroup(group.id)} 
                                             className={`p-1.5 rounded transition-all ${deleteGroupConfirmId === group.id ? 'bg-danger text-white animate-pulse' : 'text-muted hover:text-danger-fg hover:bg-surface'}`} 
                                             title="删除分组 (包含触发器)"
                                         >
                                             <Trash2 size={14}/>
                                         </button>
                                     </div>
                                 </div>
                                 
                                 {/* Group Content */}
                                 {isExpanded && (
                                     <div className="p-2 space-y-2">
                                         {groupTriggers.length === 0 && <div className="text-center text-xs text-muted italic py-2">暂无触发器</div>}
                                         {groupTriggers.map(t => renderTrigger(t))}
                                     </div>
                                 )}
                             </div>
                         );
                    })}

                    {/* Render Ungrouped */}
                    {groupedTriggers.ungrouped.length > 0 && (
                        <div className="mt-6 border-t border-border pt-4">
                            <div className="flex items-center gap-2 mb-2 px-2 text-muted text-xs uppercase font-bold tracking-wider">
                                <LayoutGrid size={14}/> 未分组触发器 ({groupedTriggers.ungrouped.length})
                            </div>
                            <div className="space-y-2">
                                {groupedTriggers.ungrouped.map(t => renderTrigger(t))}
                            </div>
                        </div>
                    )}
                    
                    {triggers.length === 0 && (
                        <div className="text-center text-muted italic py-10">暂无触发器。点击上方新建。</div>
                    )}
                </div>
            </div>
        </Window>
    );
};
