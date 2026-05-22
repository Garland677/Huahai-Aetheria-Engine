import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GameState, WindowState, GameAttribute, Conflict, MapLocation, MapRegion, Character, GameImage, StoryTag, AttributeType, AttributeVisibility, Trigger } from '../../types';
import { Edit2, X, Globe, Wind, MapPin, Clock, Zap, Sun, Navigation, Compass, Footprints, AlertTriangle, Map, Users, RefreshCw, History, Lock, Check, Save, Hand, UserPlus, Trash2, Telescope, Loader2, Info, Sparkles, Tag, Plus } from 'lucide-react';
import { MapVisualizer } from './MapVisualizer/index';
import { Button, TextArea, Label, Input } from '../ui/Button';
import { getTerrainHeight, isPointInPolygon, findSuitableLocation, checkMapExpansion } from '../../services/mapUtils';
import { generateRandomFlagAvatar } from '../../assets/imageLibrary';
import { AiGenWindow } from '../Windows/Pools/AiGenWindow';
// (Add new component)
import { getNaturalTimeDelta } from '../../services/timeUtils';

const WorldTimeVisualizer = React.memo(({ worldTimeStr, worldStatusText, onEdit, locked }: { worldTimeStr: string, worldStatusText: string, onEdit: () => void, locked: boolean }) => {
    const { month, day, hours, minutes } = useMemo(() => {
        const parts = worldTimeStr.split(/[:\-\/ ]/).map(s => parseInt(s, 10));
        let mo = parts[1] || 1;
        let d = parts[2] || 1;
        let h = parts[3] || 0;
        let m = parts[4] || 0;
        return { month: mo, day: d, hours: h, minutes: m };
    }, [worldTimeStr]);

    const totalHours = hours + minutes / 60;
    
    const [rotateDeg, setRotateDeg] = useState(180 + (totalHours / 24) * 360);
    
    useEffect(() => {
        setRotateDeg(prev => {
            const targetMod = (180 + (totalHours / 24) * 360) % 360;
            let currentMod = prev % 360;
            if (currentMod < 0) currentMod += 360;
            
            let delta = targetMod - currentMod;
            // Shortest clockwise rotation, allow a tiny negative drift for precision errors
            if (delta < -0.1) delta += 360;
            
            return prev + delta;
        });
    }, [totalHours]);
    
    let ratio = 1; // 1 = Dopamine (day), 0 = Oxytocin (night)
    if (totalHours >= 0 && totalHours < 8) {
        ratio = totalHours / 8; // 0:00 to 8:00 transition
    } else if (totalHours >= 8 && totalHours < 18) {
        ratio = 1; // 8:00 to 18:00 dopamine
    } else if (totalHours >= 18 && totalHours <= 24) {
        ratio = 1 - ((totalHours - 18) / 6); // 18:00 to 24:00 transition
    } else {
        ratio = 0;
    }

    return (
        <div className="relative w-full flex justify-between py-1 min-h-[80px] h-[80px] items-center @container">
            {/* Left Box (Month) */}
            <div className="flex-1 flex justify-end items-center pr-2 min-w-[50px] h-full">
                <span className="font-bold text-primary whitespace-nowrap tracking-tighter" style={{ fontSize: 'clamp(0.875rem, calc((100cqw - 76px) / 2 * 0.35), 1.5rem)' }}>{month}月</span>
            </div>

            {/* Circular Track */}
            <div className="relative shrink-0 w-[76px] h-[76px] rounded-full border-2 border-primary flex items-center justify-center box-border">
                 <span className="text-xs font-bold text-primary text-center leading-tight truncate px-2 max-w-[70px]">{worldStatusText}</span>
                 
                 {/* Rotating Sun */}
                <div 
                    className="absolute w-[76px] h-[76px] pointer-events-none transition-transform duration-1000 ease-linear shadow-none"
                    style={{ transform: `rotate(${rotateDeg}deg)` }}
                >
                    <div 
                       className="absolute top-[-7px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full"
                       style={{ 
                            backgroundColor: `color-mix(in srgb, var(--dopamine-base) ${ratio * 100}%, var(--oxytocin-base))`,
                            boxShadow: `0 0 6px color-mix(in srgb, var(--dopamine-base) ${ratio * 100}%, var(--oxytocin-base))`
                        }}
                    />
                </div>
            </div>

            {/* Right Box (Day) */}
            <div className="flex-1 flex justify-start items-center pl-2 min-w-[50px] h-full">
                <span className="font-bold text-primary whitespace-nowrap tracking-tighter" style={{ fontSize: 'clamp(0.875rem, calc((100cqw - 76px) / 2 * 0.35), 1.5rem)' }}>{day}日</span>
            </div>
            
            {/* Edit Button */}
            <button 
                onClick={onEdit}
                disabled={locked}
                className={`absolute right-1 top-0 text-muted hover:text-primary p-1 rounded hover:bg-surface-highlight transition-colors ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="编辑世界属性"
            >
                {locked ? <Lock size={12}/> : <Edit2 size={12}/>}
            </button>
        </div>
    );
});

import { Window } from '../ui/Window';
import { ImageAttachmentList } from '../ui/ImageAttachmentList';
import { ImageUploadModal } from '../Modals/ImageUploadModal';
import { useImageAttachments } from '../../hooks/useImageAttachments';
import { generateLocationId, generateConflictId } from '../../services/idUtils';
import { generateStorySuggest } from '../../services/aiService';
import { getAttr } from '../../services/attributeUtils';

interface LeftPanelProps {
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    openWindow: (type: WindowState['type']) => void;
    addLog: (text: string, overrides?: any) => void;
    addDebugLog?: (log: any) => void;
    onResetLocation: (locationId: string, keepRegion: boolean, instructions?: string, cultureInstructions?: string, locImages?: GameImage[], charImages?: GameImage[]) => void;
    onExploreLocation?: (location: MapLocation, isManual: boolean, instructions?: string, cultureInstructions?: string, locImages?: GameImage[], charImages?: GameImage[]) => Promise<any>;
    onProcessMove?: (charId: string, destId: string, destName?: string) => void; // New Prop
}

// ... existing AttrIcon component ...
const AttrIcon = ({ id }: { id: string }) => {
    switch(id) {
        case 'weather': return <Wind size={14} />;
        case 'world_status': return <Wind size={14} />;
        case 'time': return <Clock size={14} />;
        case 'worldTime': return <Clock size={14} />;
        case 'chaos_level': return <Zap size={14} />;
        default: return <Sun size={14} />;
    }
};

export const LeftPanel: React.FC<LeftPanelProps> = ({ state, updateState, openWindow, addLog, addDebugLog, onResetLocation, onExploreLocation, onProcessMove }) => {
    // Refs for power-saving auto-scroll
    const leftPanelRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const preferenceDividerRef = useRef<HTMLDivElement>(null);

    const [viewingLocId, setViewingLocId] = useState<string | null>(null);
    const [isEditingGuidance, setIsEditingGuidance] = useState(false);
    const [guidanceTemp, setGuidanceTemp] = useState("");
    const [showConflictHistory, setShowConflictHistory] = useState(false);
    const [isManualMove, setIsManualMove] = useState(false);
    
    // Player Character Generation State
    const [showPlayerGen, setShowPlayerGen] = useState(false);
    const CREATE_CHAR_COST = 25;

    // Region Editing State
    const [isEditingRegion, setIsEditingRegion] = useState(false);
    const [tempRegion, setTempRegion] = useState({ name: "", description: "" });

    // Delete Confirmation State
    const [deleteConfirmLocId, setDeleteConfirmLocId] = useState<string | null>(null);

    const activeLocIdRef = useRef(state.map.activeLocationId);
    useEffect(() => {
        activeLocIdRef.current = state.map.activeLocationId;
    }, [state.map.activeLocationId]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            const target = e.target as HTMLElement;
            
            // Ignore if clicked inside LeftPanel
            if (leftPanelRef.current && leftPanelRef.current.contains(target)) {
                return;
            }
            
            // Ignore if clicked on an overlay/modal
            if (target.closest && target.closest('.bg-overlay')) {
                return;
            }

            // Ignore if clicked inside the MapVisualizer (expanded or normal)
            if (target.closest && target.closest('.map-visualizer-container')) {
                return;
            }
            
            // Clicked outside:
            // 1. Scroll down to hide the map and save power
            if (scrollContainerRef.current && preferenceDividerRef.current) {
                const preferenceTop = preferenceDividerRef.current.offsetTop;
                scrollContainerRef.current.scrollTo({
                    top: preferenceTop,
                    behavior: 'smooth'
                });
            }
            
            // 2. Reset viewing location to active location
            if (activeLocIdRef.current) {
                setViewingLocId(activeLocIdRef.current);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside, { passive: true });

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, []);

    // Exploration Local State
    const [exploringLocIds, setExploringLocIds] = useState<string[]>([]);
    const [showExplorationModal, setShowExplorationModal] = useState(false);
    const [explorationInput, setExplorationInput] = useState("");
    const [cultureInput, setCultureInput] = useState("");

    // Story Suggestion State
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [manualTagInput, setManualTagInput] = useState("");
    const [showTagInput, setShowTagInput] = useState(false);

    // Image Hooks for Exploration
    const locImagesHook = useImageAttachments();
    const charImagesHook = useImageAttachments();

    const locked = state.appSettings.lockedFeatures || ({} as any);

    // Reset Location Modal
    const [resetLocModal, setResetLocModal] = useState<{ isOpen: boolean, keepRegion: boolean } | null>(null);
    
    // Pending Reset State (Stores config while waiting for instructions in Exploration Modal)
    const [pendingReset, setPendingReset] = useState<{ locationId: string, keepRegion: boolean } | null>(null);

    useEffect(() => {
        const handleForceLocation = (e: CustomEvent) => {
            setViewingLocId(e.detail);
        };
        window.addEventListener('force-view-location', handleForceLocation as EventListener);
        return () => window.removeEventListener('force-view-location', handleForceLocation as EventListener);
    }, []);

    useEffect(() => {
        if (!viewingLocId && state.map.activeLocationId) {
            setViewingLocId(state.map.activeLocationId);
        }
    }, [state.map.activeLocationId]);

    const handleLocationSelect = (locId: string) => {
        setViewingLocId(locId);
        // Reset editing/delete state when changing location
        setIsEditingRegion(false);
        setDeleteConfirmLocId(null);
    };

    // ... existing handleCreateLocation, handleDeleteLocation, getCost, handleExploreClick ...

    const handleCreateLocation = (x: number, y: number) => {
        const seed = state.map.chunks['0_0']?.seed || 123;
        const z = getTerrainHeight(x, y, seed);
        
        // Use standardized ID generation
        const newId = generateLocationId(state.map.locations);

        // Check if point falls into any existing region
        let regionId: string | undefined = undefined;
        const regions = Object.values(state.map.regions || {}) as MapRegion[];
        
        for (const region of regions) {
            if (isPointInPolygon({ x, y }, region.vertices)) {
                regionId = region.id;
                break;
            }
        }
        
        const newLoc: MapLocation = {
            id: newId,
            name: "标记地点",
            description: "手动标记的未知地点。",
            coordinates: { x, y, z },
            isKnown: false,
            radius: 50,
            associatedNpcIds: [],
            regionId: regionId, // Assign discovered region
            avatarUrl: generateRandomFlagAvatar(true) // Generate blurred avatar for manual creation
        };
        
        updateState(prev => ({
            ...prev,
            map: {
                ...prev.map,
                locations: {
                    ...prev.map.locations,
                    [newId]: newLoc
                }
            }
        }));
        setViewingLocId(newId);
        addLog(`系统: 已在坐标 (${x}, ${y}) 标记新地点${regionId ? ` (隶属区域: ${state.map.regions[regionId].name})` : ""}。`);
    };

    const handleDeleteLocation = () => {
        // ... (rest of handleDeleteLocation unchanged) ...
        if (!viewingLocId) return;

        if (deleteConfirmLocId === viewingLocId) {
            // Execute Delete
            const locName = state.map.locations[viewingLocId]?.name || "未知地点";
            
            updateState(prev => {
                const newLocations = { ...prev.map.locations };
                delete newLocations[viewingLocId];

                const newChars = { ...prev.characters };
                const newPositions = { ...prev.map.charPositions };
                const removedChars: string[] = [];

                // Remove all characters at this location
                Object.keys(prev.map.charPositions).forEach(charId => {
                    if (newPositions[charId].locationId === viewingLocId) {
                        delete newChars[charId];
                        delete newPositions[charId];
                        removedChars.push(charId);
                    }
                });

                // Clean up turn order
                let newCurrentOrder = prev.round.currentOrder.filter(id => !removedChars.includes(id));
                let newDefaultOrder = prev.round.defaultOrder.filter(id => !removedChars.includes(id));

                // Handle Active Location logic if we deleted the current spot
                let newActiveLoc = prev.map.activeLocationId;
                if (newActiveLoc === viewingLocId) {
                    // Fallback to the first available location to prevent crash
                    newActiveLoc = Object.keys(newLocations)[0] || ""; 
                }

                return {
                    ...prev,
                    map: {
                        ...prev.map,
                        locations: newLocations,
                        charPositions: newPositions,
                        activeLocationId: newActiveLoc
                    },
                    characters: newChars,
                    round: {
                        ...prev.round,
                        currentOrder: newCurrentOrder,
                        defaultOrder: newDefaultOrder
                    }
                };
            });

            addLog(`系统: 地点 [${locName}] 及其所有内容已被彻底抹除。`);
            setViewingLocId(null);
            setDeleteConfirmLocId(null);
        } else {
            // Request Confirmation
            setDeleteConfirmLocId(viewingLocId);
            setTimeout(() => setDeleteConfirmLocId(null), 3000);
        }
    };

    // Calculate Travel/Explore Cost
    const getCost = (loc: MapLocation | null) => {
        // ... (getCost unchanged) ...
        if (!loc || !state.map.activeLocationId) return 0;
        const activeLoc = state.map.locations[state.map.activeLocationId];
        if (!activeLoc) return 0;
        
        const dist = Math.sqrt(Math.pow(loc.coordinates.x - activeLoc.coordinates.x, 2) + Math.pow(loc.coordinates.y - activeLoc.coordinates.y, 2));
        
        // Known locations are free to move to
        if (loc.isKnown) {
             return 0; 
        }
        
        // Unknown locations cost AP to explore
        return Math.ceil(dist / 100);
    };

    const executeExplore = async (locInstruction: string, cultInstruction: string) => {
        setShowExplorationModal(false);
        
        // Use attached images
        const locImages = locImagesHook.images;
        const charImages = charImagesHook.images;

        // --- BRANCH 1: RESET LOCATION EXECUTION ---
        if (pendingReset) {
            // Fix: Pass all arguments to reset location as well, to support full re-generation context
            onResetLocation(pendingReset.locationId, pendingReset.keepRegion, locInstruction, cultInstruction, locImages, charImages);
            setPendingReset(null);
            // Clear images
            locImagesHook.clearImages();
            charImagesHook.clearImages();
            return;
        }

        // --- BRANCH 2: NORMAL EXPLORATION EXECUTION ---
        if (!viewingLocId || !onExploreLocation) return;
        const targetLocId = viewingLocId; // Capture ID
        const loc = state.map.locations[targetLocId];
        if (!loc) return;
        
        const cost = getCost(loc);

        // Deduct AP immediately (Pre-deduction)
        updateState(prev => ({
            ...prev,
            round: { ...prev.round, actionPoints: prev.round.actionPoints - cost }
        }));
        
        setExploringLocIds(prev => [...prev, targetLocId]);
        
        if (!isManualMove) {
            addLog(`系统: 消耗 ${cost} AP，开始探索 [${loc.name || "未知地点"}] ...`);
        }
        
        try {
            // Pass both text and images
            const result = await onExploreLocation(loc, isManualMove, locInstruction, cultInstruction, locImages, charImages);
            
            // Check result. If failed or interrupted (e.g. Stop Execution), refund AP
            if (!result || !result.success) {
                 updateState(prev => ({
                    ...prev,
                    round: { ...prev.round, actionPoints: prev.round.actionPoints + cost }
                }));
                if (!isManualMove) addLog(`系统: 探索中断或失败，已返还 ${cost} AP。`);
            } else {
                // Success handled in useLocationGeneration
            }
        } catch (e) {
            console.error("Explore failed:", e);
            // Refund on error
            updateState(prev => ({
                ...prev,
                round: { ...prev.round, actionPoints: prev.round.actionPoints + cost }
            }));
            addLog(`系统: 探索发生错误，已返还 ${cost} AP。`);
        } finally {
            setExploringLocIds(prev => prev.filter(id => id !== targetLocId));
            locImagesHook.clearImages();
            charImagesHook.clearImages();
        }
    };

    const handleExploreClick = () => {
        if (!viewingLocId) return;
        const loc = state.map.locations[viewingLocId];
        if (!loc) return;

        const cost = getCost(loc);
        // Only check cost if exploring unknown
        if (!loc.isKnown && state.round.actionPoints < cost) {
            addLog(`系统: 行动点不足！需要 ${cost} AP。`);
            return;
        }

        // Clear previous state before starting
        setExplorationInput("");
        setCultureInput("");
        locImagesHook.clearImages();
        charImagesHook.clearImages();
        
        // --- PRE-FILL IF PENDING EXPLORATION DATA EXISTS ---
        if (loc.pendingExplorationData) {
            setExplorationInput(loc.pendingExplorationData.locationInstruction);
            setCultureInput(loc.pendingExplorationData.cultureInstruction);
            // We assume manual mode preference if data was AI generated for specific purpose
            // But let user choose.
        }

        // Branch based on mode
        if (isManualMove) {
            // Bypass modal and execute immediately with empty instructions
            // executeExplore will handle the 'isManualMove' flag (via state closure) correctly
            executeExplore("", "");
        } else {
            // Open Modal for instructions
            setShowExplorationModal(true);
        }
    };

    // ... existing handleTravel, handleSaveGuidance, confirmResetLocation ...
    const handleTravel = () => {
        // ... (handleTravel unchanged) ...
        if (viewingLocId && viewingLocId !== state.map.activeLocationId) {
            const loc = state.map.locations[viewingLocId];
            const currentLocId = state.map.activeLocationId;
            
            // Note: Movement AP cost has been deprecated for Fast Travel.
            
            // Log moves for each character to ensure AI awareness
            const movedCharacters: string[] = [];
            const movedCharIds: string[] = [];

            updateState(prev => {
                const nextPos = { ...prev.map.charPositions };
                const nextChars = { ...prev.characters };
                
                // Calculate ID base
                let maxId = 0;
                (Object.values(prev.characters) as Character[]).forEach(c => {
                    c.conflicts?.forEach(x => {
                        const n = parseInt(x.id);
                        if (!isNaN(n) && n > maxId) maxId = n;
                    });
                });

                // Move Followers Only (Strict check)
                (Object.values(prev.characters) as Character[]).forEach(c => {
                    // Check if follower (ignoring isPlayer status as per request)
                    if (c.isFollowing) {
                        const pos = nextPos[c.id];
                        // Only move if they are currently at the active location
                        if (pos && pos.locationId === currentLocId) {
                            nextPos[c.id] = {
                                x: loc.coordinates.x,
                                y: loc.coordinates.y,
                                locationId: viewingLocId
                            };
                            
                            movedCharacters.push(c.name);
                            movedCharIds.push(c.id);

                            // Add Conflict
                            maxId++;
                            const updatedChar = { ...nextChars[c.id] };
                            updatedChar.conflicts = [
                                ...(updatedChar.conflicts || []),
                                {
                                    id: String(maxId),
                                    desc: "刚到此地，对当地情况不熟悉",
                                    apReward: 2,
                                    solved: false
                                }
                            ];
                            nextChars[c.id] = updatedChar;
                        }
                    }
                });

                // --- IMMEDIATE SWITCH LOGIC ---
                // If round is in Init/Order/End phase (safe to switch), switch directly.
                // Otherwise (mid-turn), set pending switch to wait for settlement.
                const canSwitchImmediately = ['init', 'order', 'round_end'].includes(prev.round.phase);
                
                const nextActiveLocId = canSwitchImmediately ? viewingLocId : prev.map.activeLocationId;
                const nextPendingLocId = canSwitchImmediately ? undefined : viewingLocId;

                // --- TURN ORDER CLEANUP ---
                // Remove moved characters from current round order IF they haven't acted yet (index > current)
                // This prevents them from "appearing" again in the old location's round.
                // Note: We filter based on current turn index.
                const currentTurnIndex = prev.round.turnIndex;
                let nextCurrentOrder = [...prev.round.currentOrder];
                
                // Filter out moved chars ONLY if they are at indices > currentTurnIndex
                // This preserves history for characters who already acted, but removes future turns for those leaving.
                nextCurrentOrder = nextCurrentOrder.filter((charId, idx) => {
                    // If this char moved AND is in the future queue, remove it.
                    if (movedCharIds.includes(charId) && idx > currentTurnIndex) {
                        return false;
                    }
                    return true;
                });

                return {
                    ...prev,
                    map: { 
                        ...prev.map, 
                        activeLocationId: nextActiveLocId,
                        pendingActiveLocationId: nextPendingLocId,
                        charPositions: nextPos,
                        // Set manual flag if we are moving to unknown location and Manual Mode is checked
                        manualExplorationNext: (!loc.isKnown && isManualMove)
                    },
                    characters: nextChars,
                    round: {
                        ...prev.round,
                        currentOrder: nextCurrentOrder,
                        // [FIX] Reset Manual Order when immediate travel happens
                        // This prevents carrying over order list to new location
                        useManualTurnOrder: canSwitchImmediately ? false : prev.round.useManualTurnOrder,
                        defaultOrder: canSwitchImmediately ? [] : prev.round.defaultOrder,
                        isWaitingForManualOrder: canSwitchImmediately ? false : prev.round.isWaitingForManualOrder
                    }
                };
            });
            
            // Add specific action logs for AI context
            movedCharacters.forEach(name => {
                 // Add log as 'action' type so AI sees it in history
                 addLog(`${name} 移动前往了 [${loc.name}]。`, { type: 'action' });
            });
            
            if (['init', 'order', 'round_end'].includes(state.round.phase)) {
                addLog(`系统: 视角已立即切换至 [${loc.name}]。`);
            } else {
                addLog(`系统: 视角将在下一轮结算时切换至[${loc.name}]。`);
            }
        }
    };

    const handleSaveGuidance = () => {
        updateState(prev => ({
            ...prev,
            world: { ...prev.world, worldGuidance: guidanceTemp }
        }));
        setIsEditingGuidance(false);
        addLog("系统: 导演指令已更新。");
    };

    const confirmResetLocation = () => {
        if (viewingLocId && resetLocModal) {
            // Set pending reset config and open instructions modal instead of executing directly
            setPendingReset({
                locationId: viewingLocId,
                keepRegion: resetLocModal.keepRegion
            });
            
            // Close Warning Modal
            setResetLocModal(null);
            
            // Clear input and Open Exploration Modal for Instructions
            setExplorationInput("");
            setCultureInput("");
            locImagesHook.clearImages();
            charImagesHook.clearImages();
            setShowExplorationModal(true);
        }
    };
    
    // New: Trigger update logic
    const handleTriggerUpdate = (id: string, updates: Partial<Trigger>) => {
        updateState(prev => ({
            ...prev,
            triggers: {
                ...prev.triggers,
                [id]: { ...prev.triggers[id], ...updates }
            }
        }));
    };
    
    const handleStorySuggest = async () => {
        setIsSuggesting(true);
        addLog("系统: 正在分析剧情并生成建议...");
        
        try {
            const result = await generateStorySuggest(
                state, 
                addDebugLog, 
                (msg) => addLog(msg, { type: 'system' }),
                handleTriggerUpdate
            );
            
            if (result) {
                // Handle Location Suggestion
                // We use 'any' cast here because locationsuggest might not be in the strict return type yet,
                // but if the prompt asks for it (which it does in DefaultSettings), the result will have it.
                const locSuggest = (result as any).locationsuggest;
                
                // We need to execute location creation logic outside of updateState to handle async search
                let newLocId: string | null = null;
                let newLocName = "";
                let failureReason = "";
                
                if (locSuggest && Array.isArray(locSuggest) && locSuggest.length > 0) {
                    const suggestion = locSuggest[0];
                    const activeLocId = state.map.activeLocationId;
                    const activeLoc = activeLocId ? state.map.locations[activeLocId] : null;
                    const activeRegion = (activeLoc && activeLoc.regionId) ? state.map.regions[activeLoc.regionId] : null;
                    const seed = (Object.values(state.map.chunks) as any[])[0]?.seed || Math.random();

                    if (activeRegion) {
                        // Find suitable spot
                        // Allow multiple types: "平地/湖边" -> tries first match
                        // Fix: Normalize type to string before splitting to handle array returns from some models
                        let typeInput = suggestion.type;
                        if (Array.isArray(typeInput)) {
                            typeInput = typeInput.join(',');
                        } else {
                            typeInput = String(typeInput || "");
                        }

                        const types = typeInput.split(/[\/,]/); 
                        let foundPos: {x:number, y:number} | null = null;
                        
                        for (const type of types) {
                            foundPos = findSuitableLocation(type.trim(), activeRegion, seed + Date.now(), state.map);
                            if (foundPos) break;
                        }

                        if (foundPos) {
                            const z = getTerrainHeight(foundPos.x, foundPos.y, seed);
                            newLocId = generateLocationId(state.map.locations);
                            newLocName = suggestion.name;
                            
                            const newLoc: MapLocation = {
                                id: newLocId,
                                name: newLocName,
                                description: suggestion.description || "一个新发现的地点。",
                                coordinates: { x: foundPos.x, y: foundPos.y, z },
                                isKnown: false, // [FIX] Marked as Unknown so it must be explored to be fully revealed
                                radius: 50,
                                associatedNpcIds: [],
                                regionId: activeRegion.id,
                                avatarUrl: generateRandomFlagAvatar(true),
                                pendingExplorationData: {
                                    locationInstruction: suggestion.description || "",
                                    cultureInstruction: suggestion.newchar || ""
                                }
                            };
                            
                            // Inject into state update
                            updateState(prev => {
                                const nextMap = { 
                                    ...prev.map, 
                                    locations: { ...prev.map.locations, [newLocId!]: newLoc } 
                                };
                                return { 
                                    ...prev, 
                                    map: checkMapExpansion(foundPos!.x, foundPos!.y, nextMap, seed) // Ensure chunks exist
                                };
                            });
                            
                            addLog(`系统: 剧情建议已生效，发现新地点 [${newLocName}] (待探索)。`, { type: 'system' });
                        } else {
                            failureReason = `未在附近找到符合 [${suggestion.type}] 特征的地形。`;
                        }
                    } else {
                        failureReason = "当前处于未知区域，无法定位新地点。";
                    }
                }

                updateState(prev => {
                    // Update Fun Suggest
                    const newWorld = { 
                        ...prev.world, 
                        lastFunSuggest: result.funsuggest
                    };
                    
                    // Update Tags: Merge new tags, removing duplicates
                    const existingTags = prev.world.storyTags || [];
                    const existingTexts = new Set(existingTags.map(t => t.text));
                    
                    const newTags: StoryTag[] = [];
                    result.tagsuggest.forEach(text => {
                        if (!existingTexts.has(text) && text.trim()) {
                            newTags.push({
                                id: `tag_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                                text: text.trim(),
                                status: 'neutral',
                                timestamp: Date.now()
                            });
                            existingTexts.add(text);
                        }
                    });
                    
                    // Combine and Enforce Limit on Neutral Tags
                    let allTags = [...existingTags, ...newTags];
                    const neutrals = allTags.filter(t => t.status === 'neutral');
                    const nonNeutrals = allTags.filter(t => t.status !== 'neutral');
                    
                    // Sort neutrals by timestamp (oldest first)
                    neutrals.sort((a, b) => a.timestamp - b.timestamp);
                    
                    // Keep max 20 neutrals (remove from start/oldest)
                    const keptNeutrals = neutrals.slice(Math.max(0, neutrals.length - 20));
                    
                    newWorld.storyTags = [...nonNeutrals, ...keptNeutrals];
                    
                    return { ...prev, world: newWorld };
                });
                
                // --- Handle Coming Character Movement ---
                // Use onProcessMove to leverage standard logic (Physique check, logging, active update)
                // Note: We access state from the hook closure, which is updated on re-render.
                // Since updateState is async, we use the current state's active location ID.
                if (result.comingchar && Array.isArray(result.comingchar) && result.comingchar.length > 0 && onProcessMove) {
                     const targetLocId = state.map.activeLocationId;
                     const targetLoc = targetLocId ? state.map.locations[targetLocId] : null;
                     const targetLocName = targetLoc?.name || "未知地点";

                     if (targetLocId && targetLoc) {
                         result.comingchar.forEach((comingId: string) => {
                             const char = state.characters[comingId];
                             // Only move if they had a plan
                             if (char && char.movePlan) {
                                 onProcessMove(comingId, targetLocId, targetLocName);
                             }
                         });
                     }
                }
                
                if (!newLocId) {
                    if (failureReason) {
                        addLog(`系统: 剧情建议已刷新 (地点生成跳过: ${failureReason})。`, { type: 'system' });
                    } else {
                        addLog("系统: 剧情建议已刷新，新标签已添加。", { type: 'system' });
                    }
                }
            } else {
                addLog("系统: 建议生成失败 (无响应)。");
            }
        } catch (e: any) {
            console.error(e);
            addLog(`系统: 建议生成错误: ${e.message}`);
        } finally {
            setIsSuggesting(false);
        }
    };

    const handleTagClick = (tagId: string) => {
        updateState(prev => {
            const tags = [...(prev.world.storyTags || [])];
            const idx = tags.findIndex(t => t.id === tagId);
            if (idx === -1) return prev;
            
            const tag = tags[idx];
            // Cycle: neutral -> like -> dislike -> neutral
            if (tag.status === 'neutral') tag.status = 'like';
            else if (tag.status === 'like') tag.status = 'dislike';
            else tag.status = 'neutral';
            
            // Re-enforce limit if status changed to neutral? 
            // Simplified: Just update status. The limit runs on addition.
            tags[idx] = tag;
            
            return { ...prev, world: { ...prev.world, storyTags: tags } };
        });
    };

    const handleAddManualTag = () => {
        if (!manualTagInput.trim()) {
            setShowTagInput(false);
            return;
        }
        
        updateState(prev => {
            const existingTags = prev.world.storyTags || [];
            if (existingTags.some(t => t.text === manualTagInput.trim())) return prev;

            const newTag: StoryTag = {
                id: `tag_man_${Date.now()}`,
                text: manualTagInput.trim(),
                status: 'like', // Default to 'like' for manually added tags
                timestamp: Date.now()
            };
            
            return {
                ...prev,
                world: { ...prev.world, storyTags: [...existingTags, newTag] }
            };
        });
        setManualTagInput("");
        setShowTagInput(false);
    };

    // ... existing viewingLocation, viewingRegion, handleSaveRegion ...
    const viewingLocation = viewingLocId ? state.map.locations[viewingLocId] : null;
    const isAtLocation = viewingLocId === state.map.activeLocationId;
    // Look up region from map state
    const viewingRegion = viewingLocation?.regionId ? state.map.regions[viewingLocation.regionId] : null;

    const handleSaveRegion = () => {
        if (!viewingRegion) return;
        updateState(prev => ({
            ...prev,
            map: {
                ...prev.map,
                regions: {
                    ...prev.map.regions,
                    [viewingRegion.id]: {
                        ...viewingRegion,
                        name: tempRegion.name,
                        description: tempRegion.description
                    }
                }
            }
        }));
        setIsEditingRegion(false);
        addLog(`系统: 区域 [${tempRegion.name}] 信息已更新。`);
    };

    // ... existing derived data for rendering ...
    // Characters at viewing location
    const charsAtLocation = viewingLocId ? (Object.values(state.characters) as Character[]).filter(c => {
        const pos = state.map.charPositions[c.id];
        return pos && pos.locationId === viewingLocId;
    }) : [];

    // Gather conflicts from CHARACTERS
    const localConflicts: { charName: string, conflict: Conflict }[] = [];
    charsAtLocation.forEach(c => {
        if (c.conflicts) {
            c.conflicts.forEach(conf => {
                if (!conf.solved) {
                    localConflicts.push({ charName: c.name, conflict: conf });
                }
            });
        }
    });

    // Gather region conflicts (characters in same region but NOT current location)
    const regionOtherConflicts: { locName: string, charName: string, conflict: Conflict }[] = [];
    if (viewingRegion) {
        (Object.values(state.characters) as Character[]).forEach(c => {
            const pos = state.map.charPositions[c.id];
            if (pos && pos.locationId && pos.locationId !== viewingLocId) {
                const loc = state.map.locations[pos.locationId];
                if (loc && loc.regionId === viewingRegion.id) {
                    if (c.conflicts) {
                        c.conflicts.forEach(conf => {
                             if (!conf.solved) {
                                 regionOtherConflicts.push({ locName: loc.name, charName: c.name, conflict: conf });
                             }
                        });
                    }
                }
            }
        });
    }

    // Gather ALL solved conflicts for history
    const solvedConflicts: { charName: string, conflict: Conflict }[] = [];
    (Object.values(state.characters) as Character[]).forEach(c => {
        if(c.conflicts) {
            c.conflicts.forEach(conf => {
                if(conf.solved) {
                    solvedConflicts.push({ charName: c.name, conflict: conf });
                }
            });
        }
    });
    solvedConflicts.sort((a,b) => (b.conflict.solvedTimestamp || 0) - (a.conflict.solvedTimestamp || 0));

    // Dynamic cost calc for display
    const travelCost = getCost(viewingLocation);
    const distance = viewingLocation && state.map.activeLocationId ? 
        Math.sqrt(Math.pow(viewingLocation.coordinates.x - state.map.locations[state.map.activeLocationId].coordinates.x, 2) + Math.pow(viewingLocation.coordinates.y - state.map.locations[state.map.activeLocationId].coordinates.y, 2)) 
        : 0;

    const storyTags = state.world.storyTags || [];

    return (
        <div ref={leftPanelRef} className="w-full lg:w-72 bg-app border-b lg:border-b-0 lg:border-r border-border flex flex-col z-0 shadow-lg relative h-full">
            {/* ... render content (same as before) ... */}
            {/* Conflict History Modal */}
          {showConflictHistory && (
              <Window
                  title="矛盾解决历史"
                  icon={<History size={18}/>}
                  onClose={() => setShowConflictHistory(false)}
                  maxWidth="max-w-md"
                  height="h-auto max-h-[70vh]"
                  zIndex={100}
              >
                  <div className="space-y-3">
                      {solvedConflicts.length === 0 ? (
                          <div className="text-center text-muted text-sm mt-4 italic">暂无已解决的矛盾。</div>
                      ) : (
                          solvedConflicts.map((item, idx) => (
                              <div key={idx} className="bg-surface border border-success/30 rounded p-3 opacity-80 hover:opacity-100 transition-opacity">
                                  <div className="flex justify-between text-xs mb-1">
                                      <span className="text-muted font-bold">[{item.charName}]</span>
                                      <span className="text-success-fg font-mono text-[10px]">
                                          {item.conflict.solvedTimestamp ? new Date(item.conflict.solvedTimestamp).toLocaleTimeString() : "已解决"}
                                      </span>
                                  </div>
                                  <div className="text-sm text-body line-through decoration-success-fg decoration-2">{item.conflict.desc}</div>
                                  <div className="text-[10px] text-muted mt-1 flex items-center gap-1">
                                      <Zap size={10}/> 已获得奖励: {item.conflict.apReward} AP
                                  </div>
                              </div>
                          ))
                      )}
                  </div>
              </Window>
          )}

          {/* Reset Location Modal */}
          {resetLocModal && (
              <Window
                  title={<span className="flex items-center gap-2"><RefreshCw size={18} className="text-danger-fg"/> 重置/重生成地点?</span>}
                  onClose={() => setResetLocModal(null)}
                  maxWidth="max-w-sm"
                  height="h-auto"
                  zIndex={150}
                  noPadding={true}
                  footer={
                      <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setResetLocModal(null)}>取消</Button>
                          <Button size="sm" variant="danger" onClick={confirmResetLocation}>下一步 (指令)</Button>
                      </div>
                  }
              >
                  <div className="p-6">
                      <p className="text-xs text-muted mb-4">
                          这将清除当前地点的名称和描述，并根据当前世界观重新生成。地理位置和现有角色将保留。
                      </p>
                      <label className="flex items-center gap-2 text-xs text-body mb-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={resetLocModal.keepRegion} 
                            onChange={e => setResetLocModal({...resetLocModal, keepRegion: e.target.checked})}
                            className="accent-primary"
                          />
                          保留区域信息
                      </label>
                      <div className="text-[10px] text-muted ml-5">
                          {resetLocModal.keepRegion ? "地点将适配现有区域主题。" : "将同时重新生成所属区域的设定。"}
                      </div>
                  </div>
              </Window>
          )}

          {/* Player Generation Modal (Portal) */}
          {showPlayerGen && (
              <AiGenWindow
                  state={state}
                  updateState={updateState}
                  addLog={addLog}
                  onClose={() => setShowPlayerGen(false)}
                  isPlayerMode={true}
                  cost={CREATE_CHAR_COST} // Pass cost to AiGenWindow
              />
          )}
            
            {/* Image Modals for Exploration */}
            {(locImagesHook.isModalOpen || locImagesHook.editingImage) && (
                <ImageUploadModal 
                    onClose={locImagesHook.closeModal} 
                    onConfirm={locImagesHook.addImage}
                    initialImage={locImagesHook.editingImage}
                />
            )}
            {(charImagesHook.isModalOpen || charImagesHook.editingImage) && (
                <ImageUploadModal 
                    onClose={charImagesHook.closeModal} 
                    onConfirm={charImagesHook.addImage}
                    initialImage={charImagesHook.editingImage}
                />
            )}

            {/* Exploration Config Modal (Also used for Reset Instructions) */}
            {showExplorationModal && (
                <Window
                    title={<span className="flex items-center gap-2 text-accent-teal">
                        {pendingReset ? <RefreshCw size={16} className="text-danger-fg"/> : <Telescope size={16}/>} 
                        {pendingReset ? " 重置指令" : " 探索指令"}
                    </span>}
                    onClose={() => { 
                        setShowExplorationModal(false); 
                        setPendingReset(null); // Clear pending reset on close/cancel
                    }}
                    maxWidth="max-w-2xl" // Widen for 2 columns
                    height="h-auto max-h-[90vh]"
                    zIndex={200}
                    noPadding={true}
                    footer={
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => { 
                                setShowExplorationModal(false); 
                                setPendingReset(null); 
                            }}>取消</Button>
                            <Button onClick={() => executeExplore(explorationInput, cultureInput)} className={`${pendingReset ? 'bg-danger hover:bg-danger-hover' : 'bg-accent-teal hover:bg-teal-500'} text-white font-bold`}>
                                {pendingReset ? "确认重置" : "开始探索"}
                            </Button>
                        </div>
                    }
                >
                    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                        <div className="text-xs text-muted flex items-start gap-2 bg-surface-highlight/30 p-2 rounded">
                            <Info size={14} className={`shrink-0 mt-0.5 ${pendingReset ? 'text-danger' : 'text-accent-teal'}`}/>
                            <span>
                                {pendingReset 
                                    ? "地点重置的具体要求"
                                    : "分别为地点和人文环境输入要求"
                                }
                            </span>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Left: Location Definition */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-primary font-bold">1. 地点定义 (Location)</Label>
                                <p className="text-[10px] text-muted">描述地理特征、建筑风格、环境氛围。如：“废弃的游乐园”、“古代遗迹”。</p>
                                <TextArea 
                                    className={`w-full h-32 text-sm bg-surface-light resize-none border-border p-3 ${pendingReset ? 'focus:border-danger' : 'focus:border-primary'}`}
                                    placeholder="输入地点定义..."
                                    value={explorationInput}
                                    onChange={e => setExplorationInput(e.target.value)}
                                    autoFocus
                                />
                                <div className="border border-border rounded p-1 bg-surface-light/50">
                                    <ImageAttachmentList 
                                        images={locImagesHook.images}
                                        onRemove={locImagesHook.removeImage}
                                        onAdd={locImagesHook.openModal}
                                        onImageClick={locImagesHook.editImage}
                                        maxImages={4}
                                        label="地点参考图"
                                    />
                                </div>
                            </div>

                            {/* Right: Culture/Character Definition */}
                            <div className="flex flex-col gap-2">
                                <Label className="text-accent-teal font-bold">2. 人文与居民 (Culture & Chars)</Label>
                                <p className="text-[10px] text-muted">描述当地的文化习俗、居民类型或特定NPC。如：“好客的游牧民”、“赛博朋克黑帮”。</p>
                                <TextArea 
                                    className={`w-full h-32 text-sm bg-surface-light resize-none border-border p-3 focus:border-accent-teal`}
                                    placeholder="输入人文或角色要求..."
                                    value={cultureInput}
                                    onChange={e => setCultureInput(e.target.value)}
                                />
                                <div className="border border-border rounded p-1 bg-surface-light/50">
                                    <ImageAttachmentList 
                                        images={charImagesHook.images}
                                        onRemove={charImagesHook.removeImage}
                                        onAdd={charImagesHook.openModal}
                                        onImageClick={charImagesHook.editImage}
                                        maxImages={4}
                                        label="人文/角色参考图"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </Window>
            )}

            {/* MAIN SCROLLABLE CONTAINER (Rest is same) */}
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar flex flex-col scroll-smooth">
              
              {/* 1. Map Visualizer (Fixed Height within scroll) */}
              <div className="w-full h-64 shrink-0 relative border-b border-border bg-black">
                  <MapVisualizer 
                    state={state} 
                    onLocationSelect={handleLocationSelect} 
                    viewingLocationId={viewingLocId}
                    onCreateLocation={handleCreateLocation}
                  />
              </div>
              
              {/* 2. Action Points & Guidance Controls */}
              <div className="bg-surface p-2 border-b border-border flex flex-col gap-2 shrink-0">
                   <div className="flex items-center justify-between bg-surface-highlight p-2 rounded border border-border">
                       <div className="flex items-center gap-2 text-accent-teal font-bold text-xs">
                           <Footprints size={14}/> 行动点 (AP)
                       </div>
                       <div className="flex items-center gap-1">
                           <input 
                               type="number" 
                               className={`w-28 bg-surface-light border border-border rounded px-1 text-right text-xs font-mono text-highlight outline-none ${locked.actionPoints ? 'opacity-50 cursor-not-allowed' : 'focus:border-primary'}`}
                               value={state.round.actionPoints}
                               readOnly={locked.actionPoints}
                               onChange={(e) => {
                                   if (locked.actionPoints) return;
                                   const val = parseInt(e.target.value) || 0;
                                   updateState(s => ({...s, round: {...s.round, actionPoints: val}}));
                               }}
                           />
                       </div>
                   </div>

                   <Button 
                        size="sm" 
                        variant="ghost"
                        className={`w-full flex justify-between items-center text-xs text-muted hover:text-primary hover:bg-surface-highlight py-1 h-auto ${state.round.actionPoints < CREATE_CHAR_COST ? 'opacity-50 cursor-not-allowed' : ''}`}
                        onClick={() => {
                            if (state.round.actionPoints >= CREATE_CHAR_COST) setShowPlayerGen(true);
                        }}
                        disabled={state.round.actionPoints < CREATE_CHAR_COST}
                        title={`消耗 ${CREATE_CHAR_COST} AP 创建一个新的玩家角色`}
                   >
                        <span className="flex items-center gap-2"><UserPlus size={12}/> 创建角色</span>
                        {/* Cost text -> Dopamine */}
                        <span className="text-dopamine font-mono text-[10px]">-{CREATE_CHAR_COST} AP</span>
                   </Button>

                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className={`w-full flex justify-between items-center text-xs text-muted hover:text-primary hover:bg-surface-highlight py-1 h-auto ${locked.directorInstructions ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => { 
                        if (locked.directorInstructions) return;
                        setGuidanceTemp(state.world.worldGuidance || ""); 
                        setIsEditingGuidance(true); 
                    }}
                    title={locked.directorInstructions ? "已锁定" : "点击编辑世界生成指导"}
                  >
                      <span className="flex items-center gap-2"><Compass size={12}/> 导演指令</span>
                      {locked.directorInstructions ? <Lock size={10}/> : <Edit2 size={10} />}
                  </Button>
              </div>

              {/* 2.5 STORY SUGGEST & TAGS SECTION */}
              <div ref={preferenceDividerRef} className="bg-surface p-2 border-b border-border flex flex-col gap-2 shrink-0">
                  <div className="flex justify-between items-center">
                      <div className="text-[10px] font-bold text-muted flex items-center gap-1 uppercase tracking-wider">
                          <Tag size={12}/> 偏好标签
                      </div>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="text-[10px] h-6 px-2 hover:bg-surface-highlight hover:text-dopamine transition-colors"
                        onClick={handleStorySuggest}
                        disabled={isSuggesting}
                        title="分析当前剧情，生成新的创意建议和标签"
                      >
                          {isSuggesting ? <Loader2 size={10} className="animate-spin mr-1"/> : <Sparkles size={10} className="mr-1"/>}
                          剧情建议
                      </Button>
                  </div>
                  
                  {/* Tag Cloud - UPDATED: No fixed height, let it expand */}
                  <div className="flex flex-wrap gap-1.5 content-start p-1 bg-surface-light/30 rounded">
                      {storyTags.length === 0 && (
                          <span className="text-[10px] text-faint italic w-full text-center py-2">暂无标签</span>
                      )}
                      {storyTags.map(tag => {
                          let colorClass = "bg-surface-highlight border-border text-muted hover:border-muted"; // Neutral
                          if (tag.status === 'like') colorClass = "bg-oxytocin/20 border-oxytocin text-oxytocin";
                          if (tag.status === 'dislike') colorClass = "bg-endorphin/20 border-endorphin text-endorphin";
                          
                          return (
                              <div 
                                key={tag.id}
                                onClick={() => handleTagClick(tag.id)}
                                className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-all select-none group flex items-center gap-1 ${colorClass}`}
                                title={`点击切换偏好 (${tag.status})`}
                              >
                                  {tag.text}
                              </div>
                          );
                      })}
                  </div>
                  
                  {/* Manual Add Tag */}
                  {showTagInput ? (
                      <div className="flex gap-1 animate-in fade-in slide-in-from-left-2">
                          <Input 
                              value={manualTagInput}
                              onChange={e => setManualTagInput(e.target.value)}
                              placeholder="添加自定义标签..."
                              className="h-6 text-[10px]"
                              autoFocus
                              onKeyDown={(e) => e.key === 'Enter' && handleAddManualTag()}
                          />
                          <Button size="sm" onClick={handleAddManualTag} className="h-6 px-2"><Check size={10}/></Button>
                          <Button size="sm" variant="secondary" onClick={() => setShowTagInput(false)} className="h-6 px-2"><X size={10}/></Button>
                      </div>
                  ) : (
                      <button 
                        onClick={() => setShowTagInput(true)}
                        className="text-[10px] text-muted hover:text-primary flex items-center gap-1 justify-center py-1 hover:bg-surface-highlight rounded transition-colors"
                      >
                          <Plus size={10}/> 手动添加
                      </button>
                  )}
              </div>

              {/* 4. World Status Panel (Moved from bottom) */}
              <div className="p-4 shrink-0 border-b border-border">
                  {(() => {
                      const attrs = Object.values(state.world.attributes) as GameAttribute[];
                      const timeAttr = attrs.find(a => a.id === 'worldTime' || a.name === '世界时间');
                      const statusAttr = attrs.find(a => a.id === 'world_status' || a.id === 'weather' || a.name === '状态' || a.name === '天气');
                      const otherAttrs = attrs.filter(a => a !== timeAttr && a !== statusAttr);
                      
                      return (
                          <div className="space-y-2">
                              {/* Visualizer */}
                              <div className="relative overflow-visible">
                                  <WorldTimeVisualizer 
                                      worldTimeStr={timeAttr?.value as string || "2026:01:01:12:00:00"}
                                      worldStatusText={statusAttr?.value as string || "正常"}
                                      onEdit={() => !locked.worldState && openWindow('world')}
                                      locked={locked.worldState || false}
                                  />
                              </div>

                              {/* Other Attributes */}
                              {otherAttrs.length > 0 && (
                                  <div className="space-y-2 mt-4">
                                      {otherAttrs.map(attr => (
                                          <div key={attr.id} className="flex justify-between items-center bg-surface p-2.5 rounded border border-border group hover:border-highlight transition-colors">
                                              <div className="flex items-center gap-2 text-muted text-xs font-medium">
                                                  <AttrIcon id={attr.id} /> {attr.name}
                                              </div>
                                              <span className="font-mono text-xs text-primary px-1.5 py-0.5">{attr.value}</span>
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>
                      );
                  })()}
              </div>

              {/* 3. Location & Region Details Panel */}
              {viewingLocation && (
                  <div className="p-4 border-b border-border bg-surface/30 shrink-0">
                      
                      {/* Character List (Moved here, below World Status) */}
                      <div className="mb-4">
                           <h3 className="text-[10px] font-bold text-accent-teal uppercase mb-1 flex items-center gap-1">
                              <Users size={10}/> 地点角色 ({(charsAtLocation || []).length})
                           </h3>
                           {(charsAtLocation || []).length > 0 ? (
                               <div className="flex flex-wrap gap-1">
                                   {(charsAtLocation || []).map(c => (
                                       <span key={c.id} className="text-xs bg-secondary text-secondary-fg px-1.5 py-0.5 rounded border border-border">
                                           {c.name}
                                       </span>
                                   ))}
                               </div>
                           ) : (
                               <span className="text-xs text-faint italic">空无一人</span>
                           )}
                      </div>

                      {/* Action Buttons: Explore or Move */}
                      {!isAtLocation && (
                          <div className="flex flex-col gap-1 mb-4">
                              <div className="flex justify-between text-[10px] text-muted mb-1">
                                   <span>距离: {distance.toFixed(0)}m</span>
                                   <span className={state.round.actionPoints >= travelCost && !viewingLocation.isKnown ? "text-success-fg" : (viewingLocation.isKnown ? "text-muted" : "text-danger-fg")}>
                                       {viewingLocation.isKnown ? "移动" : `消耗: ${travelCost} AP`}
                                   </span>
                              </div>
                              <div className="flex gap-2">
                                  {!viewingLocation.isKnown && (
                                      <label className="flex items-center gap-1 text-xs text-muted cursor-pointer px-2 py-1 rounded bg-surface border border-border hover:bg-surface-highlight" title="手动模式: 跳过AI生成，手动填写地名和描述">
                                          <input 
                                              type="checkbox" 
                                              checked={isManualMove} 
                                              onChange={e => setIsManualMove(e.target.checked)}
                                              className="accent-primary"
                                          />
                                          手动
                                      </label>
                                  )}

                                  {/* DYNAMIC BUTTON: EXPLORE or MOVE */}
                                  {viewingLocation.isKnown ? (
                                      <Button 
                                        size="sm" 
                                        className="flex-1 flex items-center justify-center gap-2 border border-primary bg-primary/10 text-primary hover:bg-primary/20"
                                        onClick={handleTravel}
                                        // Known location travel is usually free/cheap, so mostly enabled.
                                        title="移动至已知地点"
                                      >
                                          <Navigation size={14}/> 移动至此
                                      </Button>
                                  ) : (
                                      <Button 
                                        size="sm" 
                                        className="flex-1 flex items-center justify-center gap-2 border border-primary bg-primary/10 text-primary hover:bg-primary/20" 
                                        onClick={handleExploreClick} // Changed Handler
                                        disabled={state.round.actionPoints < travelCost || exploringLocIds.includes(viewingLocation.id)}
                                        title={state.round.actionPoints < travelCost ? "AP不足" : "探索地点详情"}
                                      >
                                          {exploringLocIds.includes(viewingLocation.id) ? <Loader2 size={14} className="animate-spin"/> : <Telescope size={14}/>} 
                                          {exploringLocIds.includes(viewingLocation.id) ? "探索中..." : (state.round.actionPoints < travelCost ? "AP不足" : (isManualMove ? "手动探索" : "探索"))}
                                      </Button>
                                  )}
                                  
                                  {/* DELETE BUTTON -> Primary */}
                                  <Button
                                      size="sm"
                                      // Updated style: Use variable classes to match other buttons in look (translucent) but Danger color
                                      className={`w-16 flex items-center justify-center shrink-0 transition-colors ${deleteConfirmLocId === viewingLocation.id ? 'bg-danger text-danger-fg border-danger' : 'border border-danger/30 bg-danger/10 text-danger-fg hover:bg-danger/20'}`}
                                      onClick={handleDeleteLocation}
                                      title={deleteConfirmLocId === viewingLocation.id ? "确认删除?" : "删除地点 (含角色)"}
                                  >
                                      {deleteConfirmLocId === viewingLocation.id ? <span className="text-[10px] font-bold">确认?</span> : <Trash2 size={14}/>}
                                  </Button>
                              </div>
                          </div>
                      )}
                      
                      {/* Location Section */}
                      <div className="mb-3 pb-3 border-b border-border/50">
                          <div className="flex items-start justify-between mb-2">
                               <h3 className="text-[10px] font-bold text-muted flex items-center gap-1 uppercase tracking-wider">
                                  <MapPin size={10}/>
                                  {viewingLocation.name}
                                  {isAtLocation && <span className="text-[10px] bg-danger/50 text-danger-fg px-1.5 py-0.5 rounded ml-1">当前位置</span>}
                               </h3>
                               {viewingLocation.isKnown && !locked.locationEditor && (
                                   <div className="flex gap-1">
                                       <button 
                                         onClick={() => openWindow('world_composition' as any)}
                                         className="text-faint hover:text-body p-1 rounded hover:bg-surface-highlight transition-colors"
                                         title="打开详细列表"
                                       >
                                           <Globe size={12}/>
                                       </button>
                                       <button 
                                         onClick={() => setResetLocModal({ isOpen: true, keepRegion: true })}
                                         className="text-faint hover:text-body p-1 rounded hover:bg-surface-highlight transition-colors"
                                         title="重置/重新生成地点信息"
                                       >
                                           <RefreshCw size={12}/>
                                       </button>
                                   </div>
                               )}
                          </div>
                          
                          <p className="text-xs text-muted italic leading-relaxed mb-3 whitespace-pre-wrap">
                              {viewingLocation.isKnown ? viewingLocation.description : "遥远的未知之地。点击「探索」以探知详情。"}
                          </p>
                          <div className="flex justify-between items-center text-[10px] text-muted font-mono px-1">
                              <span>X: {viewingLocation.coordinates.x.toFixed(0)}</span>
                              <span>Y: {viewingLocation.coordinates.y.toFixed(0)}</span>
                              <span>Z: {viewingLocation.coordinates.z.toFixed(0)}m</span>
                          </div>
                      </div>

                      {/* Region Section */}
                      <div className="mb-3">
                          <div className="flex justify-between items-start mb-1">
                              <h3 className="text-[10px] font-bold text-primary mb-1 flex items-center gap-1 uppercase tracking-wider">
                                  <Map size={10}/> 所属区域 (Region)
                              </h3>
                          </div>
                          
                          {viewingRegion ? (
                            isEditingRegion ? (
                                <div className="flex flex-col gap-2 bg-surface p-2 rounded border border-border mt-1">
                                    <Input 
                                        value={tempRegion.name} 
                                        onChange={e => setTempRegion({...tempRegion, name: e.target.value})}
                                        className="text-xs h-7"
                                        placeholder="区域名称"
                                    />
                                    <TextArea 
                                        value={tempRegion.description}
                                        onChange={e => setTempRegion({...tempRegion, description: e.target.value})}
                                        className="text-xs min-h-[100px] leading-relaxed resize-none"
                                        placeholder="区域描述..."
                                    />
                                    <div className="flex justify-end gap-2 mt-1">
                                        <button 
                                            onClick={() => setIsEditingRegion(false)} 
                                            className="text-[10px] flex items-center gap-1 px-2 py-1 rounded bg-secondary text-secondary-fg hover:bg-secondary-hover"
                                        >
                                            <X size={10}/> 取消
                                        </button>
                                        <button 
                                            onClick={handleSaveRegion} 
                                            className="text-[10px] flex items-center gap-1 px-2 py-1 rounded bg-success-base/50 text-success-fg hover:bg-success-base/80 border border-success-base"
                                        >
                                            <Save size={10}/> 保存
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="group relative pr-6">
                                    <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => {
                                                if (locked.locationEditor) return;
                                                setTempRegion({ name: viewingRegion.name, description: viewingRegion.description });
                                                setIsEditingRegion(true);
                                            }}
                                            className={`p-1 rounded ${locked.locationEditor ? 'text-muted cursor-not-allowed' : 'text-muted hover:text-primary hover:bg-surface-highlight'}`}
                                            title={locked.locationEditor ? "区域编辑已锁定" : "编辑区域信息"}
                                        >
                                            {locked.locationEditor ? <Lock size={12}/> : <Edit2 size={12}/>}
                                        </button>
                                    </div>
                                    <p className="text-xs font-bold text-body mb-1 flex items-center"><MapPin size={10} className="mr-1"/>{viewingRegion.name}</p>
                                    <p className="text-xs text-muted italic leading-relaxed whitespace-pre-wrap">{viewingRegion.description}</p>
                                </div>
                            )
                          ) : (
                            <p className="text-xs text-faint italic">未知 / 未分配区域</p>
                          )}
                      </div>

                      {/* Conflicts Display */}
                      {viewingLocation.isKnown && (
                          <div className="mt-3 mb-3 space-y-2">
                              <div className="flex justify-between items-center">
                                  {/* Active Conflicts Header -> Endorphin */}
                                  <h3 className="text-[10px] font-bold text-endorphin uppercase flex items-center gap-1">
                                      <AlertTriangle size={10} /> 活跃矛盾 (Active)
                                  </h3>
                                  <button onClick={() => setShowConflictHistory(true)} className="text-[10px] text-muted hover:text-body flex items-center gap-1 bg-surface px-2 py-0.5 rounded border border-border">
                                      <History size={10}/> 历史
                                  </button>
                              </div>

                              {/* Local Conflicts */}
                              {localConflicts.length > 0 ? (
                                  <div className="bg-orange-900/10 border border-orange-900/30 rounded p-2">
                                      <div className="space-y-1">
                                          {localConflicts.map((item, idx) => (
                                              <div key={idx} className="text-xs flex justify-between gap-2 text-body">
                                                  <span className="whitespace-pre-wrap break-words">
                                                      <span className="text-muted">[{item.charName}]</span> {item.conflict.desc}
                                                  </span>
                                                  <span className="font-mono text-orange-300 whitespace-nowrap">+{item.conflict.apReward}</span>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              ) : (
                                  <div className="text-xs text-faint italic px-2">无本地角色矛盾</div>
                              )}
                              
                              {/* Region Conflicts */}
                              {regionOtherConflicts.length > 0 && (
                                  <div className="bg-surface-highlight/30 border border-border/50 rounded p-2 opacity-80 hover:opacity-100 transition-opacity">
                                      <div className="text-[10px] font-bold text-muted uppercase mb-1 flex items-center gap-1">
                                          <Globe size={10} /> 区域其他矛盾 (Region)
                                      </div>
                                      <div className="space-y-1">
                                          {regionOtherConflicts.slice(0, 3).map((item, i) => (
                                              <div key={i} className="text-xs text-muted flex justify-between gap-2 italic">
                                                  <span className="whitespace-pre-wrap break-words">[{item.locName} - {item.charName}] {item.conflict.desc}</span>
                                                  <span className="font-mono text-faint">+{item.conflict.apReward}</span>
                                              </div>
                                          ))}
                                          {regionOtherConflicts.length > 3 && <div className="text-[8px] text-faint">...以及更多 ({regionOtherConflicts.length - 3})</div>}
                                      </div>
                                  </div>
                              )}
                          </div>
                      )}
                  </div>
              )}

              {/* Spacer for bottom clearance on mobile if needed */}
              <div className="h-10 lg:h-0 shrink-0"></div>
          </div>

          {/* Director Instructions Modal Window */}
          {isEditingGuidance && (
              <Window
                  title={<span className="flex items-center gap-2"><Compass size={20}/> 世界导演指令 / 生成设定</span>}
                  onClose={() => setIsEditingGuidance(false)}
                  maxWidth="max-w-5xl"
                  height="h-[80vh]"
                  zIndex={200}
                  noPadding={true}
                  footer={
                      <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => setIsEditingGuidance(false)}>取消</Button>
                          <Button onClick={handleSaveGuidance}>保存设定</Button>
                      </div>
                  }
              >
                  <TextArea
                      className="w-full h-full text-sm font-mono leading-relaxed resize-none bg-surface/30 border-none focus:ring-0 p-4"
                      placeholder="例如: 这是一个赛博朋克世界，科技发达但社会秩序混乱。所有的NPC都应该带有某种机械改造特征..."
                      value={guidanceTemp}
                      onChange={e => setGuidanceTemp(e.target.value)}
                  />
              </Window>
          )}
      </div>
    );
};