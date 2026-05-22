
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GameState, Card, MapLocation, LogEntry, DebugLog, Character, GameImage, Trigger } from '../../types';
import { Button, TextArea } from '../ui/Button';
import { Send, Loader2, Plus, ShoppingCart, Gift, Eye, Clock, MapPin, Image as ImageIcon, Zap, Package } from 'lucide-react';
import { PendingAction } from '../../hooks/useEngine';
import { DurationPicker } from '../ui/DurationPicker';
import { CardEditor } from '../Windows/CardEditor';
import { generateObservation } from '../../services/aiService';
import { processImage } from '../../services/imageUtils';

// Extracted Components
import { SelectionPopover, SelectionItem } from '../ui/SelectionPopover';
import { LotteryModal } from '../Modals/LotteryModal';
import { ObservationModal } from '../Modals/ObservationModal';
import { ReactionInput } from '../PlayerControls/ReactionInput';
import { ActionQueue } from '../PlayerControls/ActionQueue';
import { CardCarousel } from '../PlayerControls/CardCarousel';
import { ImageUploadModal } from '../Modals/ImageUploadModal';
import { ImageAttachmentList } from '../ui/ImageAttachmentList';
import { MentionInput } from '../ui/MentionInput';

// Extracted Hooks
import { usePlayerCards } from '../../hooks/usePlayerCards';
import { useInteractionPopover } from '../../hooks/useInteractionPopover';
import { useImageAttachments } from '../../hooks/useImageAttachments';

const TopResizer = ({ children, minHeight = 40, maxHeight = 300, className = "" }: { children: React.ReactNode, minHeight?: number, maxHeight?: number, className?: string }) => {
    const [height, setHeight] = useState(minHeight);
    const startY = useRef(0);
    const startHeight = useRef(minHeight);
    const isDragging = useRef(false);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        isDragging.current = true;
        startY.current = e.clientY;
        startHeight.current = height;
        document.body.style.cursor = 'ns-resize';
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging.current) return;
        const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight.current + (startY.current - e.clientY)));
        setHeight(newHeight);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        isDragging.current = false;
        document.body.style.cursor = '';
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    return (
        <div 
            className={`relative flex flex-col w-full bg-surface-light border border-border focus-within:ring-1 focus-within:ring-primary focus-within:border-primary rounded ${className}`}
            style={{ height: `${height}px` }}
        >
            <div 
                className="absolute top-0 right-0 w-4 h-4 cursor-ns-resize z-10 flex items-start justify-end p-0 opacity-40 hover:opacity-100 touch-none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <svg className="w-2.5 h-2.5 mt-0.5 mr-0.5 text-muted pointer-events-none" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
                    <line x1="0" y1="0" x2="10" y2="10" />
                    <line x1="4" y1="0" x2="10" y2="6" />
                </svg>
            </div>
            <div className="flex-1 flex w-full h-full pt-1.5 overflow-hidden">
                {children}
            </div>
        </div>
    );
};

interface PlayerControlsProps {
    state: GameState;
    activeCharId: string;
    playerInput: string;
    setPlayerInput: (val: string) => void;
    selectedCardId: string | null;
    setSelectedCardId: (val: string | null) => void;
    selectedTargetId: string | null; // Deprecated but kept for interface compatibility
    setSelectedTargetId: (val: string | null) => void; // Deprecated but kept for interface compatibility
    submitPlayerTurn: (timePassed: number, images?: GameImage[], overrideSpeech?: string, forcePrune?: boolean) => void;
    performInstantAction: (charId: string, targetId: string, speech: string, actionDesc: string, images?: GameImage[], isItemOperation?: boolean, timePassed?: number) => void; 
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
    onAddLog?: (text: string, overrides?: Partial<LogEntry>) => void;
    addDebugLog?: (log: DebugLog) => void;
    areWindowsOpen?: boolean; // New Prop: Indicates if any modal/window is open
    // Need updateState to handle trigger updates from observation
    updateState?: (updater: (current: GameState) => GameState) => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
    state, activeCharId, playerInput, setPlayerInput, 
    selectedCardId, setSelectedCardId,
    submitPlayerTurn, performInstantAction, isProcessingAI = false,
    pendingActions = [], setPendingActions,
    onOpenShop,
    reactionRequest, onRespondToReaction,
    onAddLog,
    addDebugLog,
    areWindowsOpen = false,
    updateState
}) => {
    // Hooks
    const { activeChar, pendingCounts, availableCards, doesCardNeedTarget } = usePlayerCards(state, activeCharId, pendingActions);
    const { popoverState, openPopover, closePopover, setPopoverState } = useInteractionPopover();
    
    // We want only characters in the current location to be mentionable.
    const activeLocationId = state.map.activeLocationId;
    const locationChars = Object.keys(state.map.charPositions).filter(charId => state.map.charPositions[charId]?.locationId === activeLocationId);
    const mentionableCharacters = Object.fromEntries(
        Object.entries(state.characters).filter(([id]) => locationChars.includes(id) || id === activeChar?.id)
    );

    // Image Attachments Hook
    const { 
        images: attachedImages, 
        addImage, 
        removeImage, 
        clearImages, 
        isModalOpen, 
        openModal, 
        closeModal,
        editingImage,
        editImage
    } = useImageAttachments();

    // Local State
    const [showLottery, setShowLottery] = useState(false);
    const [showObservation, setShowObservation] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [manualTime, setManualTime] = useState({ y: 0, m: 0, d: 0, h: 0, min: 5, s: 0 });
    const [viewingCard, setViewingCard] = useState<Card | null>(null);
    const [isPastingImage, setIsPastingImage] = useState(false);
    
    // Action Description for Virtual Action Card
    const [actionInput, setActionInput] = useState("");
    // Item Operation Mode (Toggle for Action)
    const [isItemMode, setIsItemMode] = useState(false);

    // Refs for Focus & Interaction
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const isBurningLife = pendingActions.length > 2;

    // --- PLATFORM CHECK ---
    const isWindowsDesktop = () => {
        const ua = navigator.userAgent;
        return !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    };

    // Auto Focus Effect
    useEffect(() => {
        // Only autofocus if no windows are open
        if (!isProcessingAI && activeChar?.isPlayer && !state.round.isPaused && isWindowsDesktop() && !areWindowsOpen) {
            // Slight delay to ensure render visibility
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    }, [isProcessingAI, activeChar, state.round.isPaused, areWindowsOpen]);

    const accumulatedTimeRef = useRef(0);

    // Reset manual time to 5 minutes at the start of the player's turn
    useEffect(() => {
        if (activeChar?.isPlayer && state.round.phase === 'char_acting') {
            setManualTime({ y: 0, m: 0, d: 0, h: 0, min: 5, s: 0 });
            accumulatedTimeRef.current = 0;
        }
    }, [activeChar?.isPlayer, state.round.phase, activeCharId, state.round.turnIndex]);

    // --- UTILS ---
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

    const handleSubmit = async () => {
        if (!activeChar) return;

        const regex = /@((?:char|env)[a-zA-Z0-9_\-]+)/g;
        
        const extractMentions = (text: string) => {
            const matches: string[] = [];
            let match;
            regex.lastIndex = 0; // reset
            while ((match = regex.exec(text)) !== null) {
                if (state.characters[match[1]] && !matches.includes(match[1])) {
                    matches.push(match[1]);
                }
            }
            return matches;
        };

        const replaceMentions = (text: string) => {
            return text.replace(/@((?:char|env)[a-zA-Z0-9_\-]+)/g, (match, id) => {
                return state.characters[id] ? state.characters[id].name : match;
            });
        };

        let actionTargets = extractMentions(actionInput);
        let speechTargets = extractMentions(playerInput);
        
        let finalActionTargets = [...actionTargets];
        let finalSpeechTargets = speechTargets.filter(id => !finalActionTargets.includes(id));
        let combinedTargets = [...finalActionTargets, ...finalSpeechTargets];

        let cleanActionInput = replaceMentions(actionInput);
        const cleanPlayerInput = replaceMentions(playerInput);

        // Auto-target environmental character if input has actions but no targets and no speech
        if (cleanPlayerInput.trim() === "" && cleanActionInput.trim() !== "" && combinedTargets.length === 0) {
            const charLocationId = state.map.charPositions[activeChar.id]?.locationId || state.map.activeLocationId;
            const envCharIds = Object.keys(state.map.charPositions).filter(charId => {
                return state.map.charPositions[charId]?.locationId === charLocationId && charId.startsWith("env");
            });
            if (envCharIds.length > 0) {
                finalActionTargets = [envCharIds[0]];
                combinedTargets = [envCharIds[0]];
                // Append the environment name so AI clearly recognizes it as the target of the action
                const envName = state.characters[envCharIds[0]]?.name || "环境";
                cleanActionInput = `${cleanActionInput} (针对 ${envName})`;
            }
        }

        if (combinedTargets.length > 0) {
            let hasLoggedSpeech = false;
            
            // Advance time internally without submitting turn 
            const seconds = getTotalSeconds(manualTime);
            const imagesToPass = [...attachedImages]; // copy
            
            const updatedAccumulated = accumulatedTimeRef.current + seconds;
            accumulatedTimeRef.current = updatedAccumulated;
            
            // Clear inputs early so user can type again
            setPlayerInput("");
            setActionInput("");
            clearImages();
            
            // Set timer to 5 minutes
            if (manualTime.m === 0 && manualTime.d === 0 && manualTime.y === 0 && manualTime.h === 0) {
                setManualTime(prev => ({ ...prev, min: 5, s: 0 }));
            }

            // Fire actions in background
            (async () => {
                let hasAddedTime = false;
                
                for (const targetId of finalActionTargets) {
                    await performInstantAction(
                        activeChar.id, 
                        targetId, 
                        hasLoggedSpeech ? "" : cleanPlayerInput, 
                        cleanActionInput, 
                        hasLoggedSpeech ? undefined : imagesToPass, 
                        isItemMode,
                        hasAddedTime ? 0 : seconds
                    );
                    hasLoggedSpeech = true;
                    hasAddedTime = true;
                }

                for (const targetId of finalSpeechTargets) {
                    await performInstantAction(
                        activeChar.id, 
                        targetId, 
                        hasLoggedSpeech ? "" : cleanPlayerInput, 
                        "", // Empty actionDesc so it triggers "Interact"
                        hasLoggedSpeech ? undefined : imagesToPass, 
                        false,
                        hasAddedTime ? 0 : seconds
                    );
                    hasLoggedSpeech = true;
                    hasAddedTime = true;
                }
                
                // Auto-skip turn if accumulated time reaches 15 mins (900 seconds)
                if (updatedAccumulated >= 900) {
                    if (onAddLog) {
                        onAddLog(`系统: ${activeChar.name}此回合进行了过多长时间行动，系统自动推进时间线，并跳过部分单位行动。`, { type: 'system', actingCharId: activeChar.id });
                    }
                    
                    submitPlayerTurn(0, [], `[SKIP_LOG]`, true);
                }
            })();

        } else {
            // No targets -> Normal Send (skips turn or executes queue)
            const seconds = getTotalSeconds(manualTime);
            submitPlayerTurn(seconds, attachedImages, cleanPlayerInput);
            setPlayerInput("");
            setActionInput("");
            clearImages();
        }
    };

    // Keyboard Handler for Desktop
    const handleKeyDown = (e: React.KeyboardEvent<Element>) => {
        if (!isWindowsDesktop()) return;

        // Ctrl+Enter to Send
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    // Paste Handler
    const handlePaste = async (e: React.ClipboardEvent<Element>) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault(); // Prevent pasting the binary text representation
                const file = items[i].getAsFile();
                if (file) {
                    setIsPastingImage(true);
                    try {
                         const settings = state.appSettings.imageSettings || { maxShortEdge: 896, maxLongEdge: 4480, compressionQuality: 0.8 };
                         const base64 = await processImage(file, settings);
                         const newImg = {
                             id: `img_paste_${Date.now()}`,
                             base64,
                             mimeType: file.type,
                             description: ''
                         };
                         addImage(newImg);
                         if (onAddLog) onAddLog(`系统: 已粘贴图片 (${Math.round(file.size/1024)}KB -> 压缩后)。`, { type: 'system' });
                    } catch(err: any) {
                        console.error("Paste failed", err);
                        if(onAddLog) onAddLog(`系统: 图片粘贴失败 - ${err.message}`, { type: 'system' });
                    } finally {
                        setIsPastingImage(false);
                    }
                    return; // Only process the first image found
                }
            }
        }
    };

    // --- Handlers ---

    // Get Target Options for Popover
    const getTargetItems = (): SelectionItem[] => {
        const currentLocId = state.map.activeLocationId;
        const chars = (Object.values(state.characters) as Character[])
            .filter(c => {
                const pos = state.map.charPositions[c.id];
                return pos && pos.locationId === currentLocId;
            })
            .map(c => ({ 
                id: c.id, 
                name: c.name, 
                description: c.description.substring(0, 30) + '...',
                icon: c.avatarUrl,
                isSelf: c.id === activeCharId
            }));
        return chars;
    };

    // Get Move Options for Popover
    const getMoveItems = (): SelectionItem[] => {
        const currentLocId = state.map.charPositions[activeCharId]?.locationId;
        const currentLoc = currentLocId ? state.map.locations[currentLocId] : null;
        if (!currentLoc) return [];

        const candidates: SelectionItem[] = [];
        (Object.values(state.map.locations) as MapLocation[]).forEach(loc => {
            if (loc.id === currentLocId) return;
            const dist = Math.sqrt((loc.coordinates.x - currentLoc.coordinates.x)**2 + (loc.coordinates.y - currentLoc.coordinates.y)**2);
            if (dist <= 1000 || (loc.isKnown && loc.regionId === currentLoc.regionId)) {
                candidates.push({
                    id: loc.id,
                    name: loc.name,
                    description: loc.isKnown ? (loc.description.substring(0, 30) + '...') : "未知地点",
                    icon: loc.avatarUrl
                });
            }
        });
        return candidates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    };

    const handleTargetSelect = (targetId: string) => {
        if (popoverState?.cardId) {
             const card = availableCards.find(c => c.id === popoverState.cardId);
             if (card) {
                 if (setPendingActions) {
                     // Standard Card -> Add to Queue
                     setPendingActions([...pendingActions, {
                         id: `act_${Date.now()}`,
                         type: 'use_skill',
                         cardId: card.id,
                         cardName: card.name,
                         targetId: targetId
                     }]);
                 }
             }
        }
        closePopover();
    };

    const handleMoveSelect = (locId: string) => {
        if (!setPendingActions) return;
        const loc = state.map.locations[locId];
        if (!loc) return;

        // Remove existing move actions to replace
        const filteredActions = pendingActions.filter(a => a.type !== 'move_to');
        
        setPendingActions([...filteredActions, {
            id: `act_move_${Date.now()}`,
            type: 'move_to',
            cardName: `移动至 [${loc.name}]`, 
            destinationId: loc.id,
            destinationName: loc.name
        }]);
        closePopover();
    };

    const handleCardClick = (e: React.MouseEvent, card: Card) => {
        if (isProcessingAI) return;
        
        // ISSUE 1 FIX: Logic to open details if card is clicked while popover is active for it
        if (popoverState && popoverState.isOpen && popoverState.cardId === card.id) {
             if (!card.isVirtualAction) {
                 setViewingCard(card);
             }
             closePopover();
             return;
        }
        
        // If card needs target -> Open Popover
        if (doesCardNeedTarget(card)) {
            openPopover(e, 'target', card.id);
        } else {
            // No target needed -> Standard selection logic
            if (selectedCardId === card.id) {
                if (!card.isVirtualAction) setViewingCard(card); // View details on double click
            } else {
                setSelectedCardId(card.id); 
            }
        }
    };

    const handleMoveButtonClick = (e: React.MouseEvent) => {
        if (isProcessingAI) return;
        openPopover(e, 'move');
    };

    const handleAddToQueue = () => {
        if (!selectedCardId || !setPendingActions) return;
        const card = availableCards.find(c => c.id === selectedCardId);
        if (!card) return;

        const newAction: PendingAction = {
            id: `act_${Date.now()}`,
            type: 'use_skill',
            cardId: card.id,
            cardName: card.name,
            targetId: undefined 
        };
        setPendingActions([...pendingActions, newAction]);
        setSelectedCardId(null);
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
    
    // New: Trigger Update Handler for Observation
    const handleTriggerUpdate = (id: string, updates: Partial<Trigger>) => {
        if (updateState) {
            updateState(prev => ({
                ...prev,
                triggers: {
                    ...prev.triggers,
                    [id]: { ...prev.triggers[id], ...updates }
                }
            }));
        }
    };

    const handleObservation = async (query: string) => {
        if (!activeChar) return;
        setShowObservation(false);
        if (onAddLog) onAddLog(`系统: ${activeChar.name} 开始观测...`, { type: 'system', actingCharId: activeChar.id });
        
        try {
            const activeLocId = state.map.charPositions[activeChar.id]?.locationId;
            let currentLocation: MapLocation | undefined;
            if (activeLocId) currentLocation = state.map.locations[activeLocId];

            const obsText = await generateObservation(
                activeChar,
                query,
                state.world.history,
                state.world.attributes,
                state.globalContext,
                state.cardPool,
                state.appSettings,
                state.defaultSettings,
                currentLocation,
                state.map.regions,
                addDebugLog,
                state,
                (msg) => onAddLog ? onAddLog(msg, { type: 'system' }) : undefined,
                handleTriggerUpdate
            );

            if (obsText) {
                if (onAddLog) {
                    onAddLog(obsText, { type: 'narrative', isReaction: true, actingCharId: activeChar.id });
                }
            }

        } catch (e) {
            console.error(e);
            if (onAddLog) onAddLog("系统: 观测失败，思维似乎受阻。", { type: 'system' });
        }
    };

    // --- Conditional Renders ---

    // 1. Reaction Request (Priority)
    if (reactionRequest && reactionRequest.isOpen) {
        return (
            <ReactionInput 
                reactionRequest={reactionRequest} 
                state={state}
                playerInput={playerInput}
                setPlayerInput={setPlayerInput}
                onRespondToReaction={onRespondToReaction}
                onAddLog={onAddLog}
            />
        );
    }

    if (!activeChar && state.round.phase !== 'settlement') return null;

    const isPlayerTurn = activeChar?.isPlayer && state.round.phase === 'char_acting';

    // Hide controls during non-player turns entirely, or if the game is paused
    if (!isPlayerTurn || state.round.isPaused) return null;

    return (
        <div className="min-h-[130px] bg-surface border-t border-border flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.2)] relative z-10 text-body p-1.5 gap-1.5">
            
            {(isModalOpen || editingImage) && (
                <ImageUploadModal 
                    onClose={closeModal} 
                    onConfirm={addImage}
                    initialImage={editingImage}
                />
            )}

            {showTimePicker && createPortal(
                <DurationPicker 
                    // Fixed: Always reset to 5 minutes when opening
                    initialDuration={{ y: 0, m: 0, d: 0, h: 0, min: 5, s: 0 }}
                    onConfirm={(newVal) => { setManualTime(newVal); setShowTimePicker(false); }}
                    onCancel={() => setShowTimePicker(false)}
                />,
                document.body
            )}

            {showObservation && activeChar && (
                <ObservationModal 
                    state={state} 
                    activeChar={activeChar}
                    onClose={() => setShowObservation(false)}
                    onConfirm={handleObservation}
                    isProcessing={false} 
                />
            )}

            {viewingCard && createPortal(
                <CardEditor 
                    initialCard={viewingCard}
                    gameState={state}
                    onClose={() => setViewingCard(null)}
                    onSave={() => setViewingCard(null)}
                    readOnly={true}
                />,
                document.body
            )}

            {/* SELECTION POPOVER */}
            {popoverState && popoverState.isOpen && (
                <SelectionPopover 
                    title={popoverState.type === 'move' ? "选择目的地 (Move To)" : "选择目标 (Target)"}
                    items={popoverState.type === 'move' ? getMoveItems() : getTargetItems()}
                    anchorRect={popoverState.rect}
                    onSelect={popoverState.type === 'move' ? handleMoveSelect : handleTargetSelect}
                    onClose={closePopover}
                    onSourceClick={() => {
                        const card = availableCards.find(c => c.id === popoverState.cardId);
                        if (card) {
                            if (!card.isVirtualAction) setViewingCard(card);
                            closePopover();
                        }
                    }}
                />
            )}

            {isPlayerTurn && (
                <div className="flex flex-col h-full gap-1.5">
                    
                    {showLottery && activeChar && (
                        <LotteryModal 
                            state={state} 
                            activeChar={activeChar} 
                            pendingCounts={pendingCounts}
                            onClose={() => setShowLottery(false)} 
                            onConfirm={handleAddLotteryToQueue}
                        />
                    )}

                    {/* Pending Action Queue */}
                    <ActionQueue 
                        pendingActions={pendingActions} 
                        state={state} 
                        onRemove={handleRemoveFromQueue} 
                    />

                    {/* MAIN CONTROL AREA */}
                    <div className="flex flex-col gap-1.5">
                        
                        {/* ROW 1: Buttons & Tools */}
                        <div className="flex gap-2 justify-between items-center overflow-x-auto scrollbar-hide">
                            <div className="flex gap-2 shrink-0">
                                {/* Move Button: Use Primary Text Color instead of Libido */}
                                <Button 
                                    size="sm"
                                    className="h-7 px-2 flex items-center justify-center gap-1 border border-primary bg-primary/10 text-primary hover:bg-primary/20 text-xs"
                                    onClick={handleMoveButtonClick}
                                    disabled={isProcessingAI}
                                    title="移动"
                                >
                                    <MapPin size={12} />
                                </Button>

                                {/* Image Upload Button */}
                                <Button 
                                    size="sm" 
                                    className="h-7 px-2 bg-dopamine/10 border border-dopamine hover:bg-dopamine/20 text-dopamine flex items-center justify-center gap-1 text-xs"
                                    onClick={openModal}
                                    disabled={isProcessingAI}
                                    title="附加图片"
                                >
                                    <ImageIcon size={12}/>
                                    {attachedImages.length > 0 && <span className="text-[9px] font-bold">{attachedImages.length}</span>}
                                </Button>

                                {/* Observation: Use Primary Text Color */}
                                <Button 
                                    size="sm"
                                    className="h-7 px-2 border border-primary bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center gap-1 text-xs"
                                    onClick={() => setShowObservation(true)}
                                    disabled={isProcessingAI}
                                    title="观测"
                                >
                                    <Eye size={12} />
                                </Button>

                                {selectedCardId && (
                                    <Button
                                        className="h-7 px-2 bg-primary hover:bg-primary-hover border border-primary-active flex items-center justify-center gap-1 animate-in zoom-in duration-200 rounded text-white shadow-sm text-xs"
                                        onClick={handleAddToQueue}
                                        disabled={isProcessingAI}
                                        title="加入行动队列 (手动)"
                                    >
                                        <Plus size={12}/>
                                        <span className="text-[10px] font-bold">添加</span>
                                    </Button>
                                )}
                            </div>

                            {/* Removed extra margin (ml-2) here to tighten layout on mobile */}
                            <div className="flex gap-1 shrink-0 border-l border-border pl-2">
                                {/* Time Picker: Use Primary Text Color */}
                                <Button 
                                    className="h-7 px-2 border border-primary bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center text-xs"
                                    onClick={() => setShowTimePicker(true)}
                                    disabled={isProcessingAI}
                                    title="调整本轮行动耗时"
                                >
                                    <span className="text-[10px] font-mono truncate max-w-[60px]">{formatDuration(manualTime)}</span>
                                </Button>

                                {/* Shop: Dopamine */}
                                <Button 
                                    size="sm" 
                                    className="h-7 px-2 bg-dopamine/10 border border-dopamine hover:bg-dopamine/20 text-dopamine flex items-center justify-center gap-1 text-xs"
                                    onClick={onOpenShop}
                                    disabled={isProcessingAI}
                                    title="商店/创造"
                                >
                                    <ShoppingCart size={12}/>
                                </Button>
                                {/* Lottery: Dopamine */}
                                <Button 
                                    size="sm" 
                                    className="h-7 px-2 bg-dopamine/10 border border-dopamine hover:bg-dopamine/20 text-dopamine flex items-center justify-center gap-1 text-xs"
                                    onClick={() => setShowLottery(true)}
                                    disabled={isProcessingAI}
                                    title="奖池"
                                >
                                    <Gift size={12}/>
                                </Button>
                            </div>
                        </div>

                        {/* ROW 2: Input & Navigation */}
                        <div className="flex flex-col gap-1.5 pt-1">
                            <div className="relative">
                                {isPastingImage && (
                                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-lg backdrop-blur-sm z-20 pointer-events-none">
                                        <Loader2 size={20} className="animate-spin text-white"/>
                                    </div>
                                )}
                                <TopResizer>
                                    <MentionInput
                                        value={playerInput}
                                        onChange={setPlayerInput}
                                        characters={mentionableCharacters}
                                        disabled={isProcessingAI}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        placeholder={`${activeChar.name} 的发言...@以提及`}
                                        className="w-full h-full text-xs px-1.5 pb-1 relative z-0"
                                    />
                                </TopResizer>
                            </div>

                            <div className="flex gap-1.5 items-end min-h-[40px]">
                                <TopResizer className="flex-1">
                                    <MentionInput
                                        value={actionInput}
                                        onChange={setActionInput}
                                        characters={mentionableCharacters}
                                        disabled={isProcessingAI}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        placeholder="补充动作行为...@以指定对象"
                                        className="w-full h-full text-xs px-1.5 pb-1 relative z-0"
                                    />
                                </TopResizer>

                                {/* Item Operation Toggle */}
                                <button
                                    onClick={() => setIsItemMode(!isItemMode)}
                                    disabled={isProcessingAI}
                                    className={`w-12 h-[40px] rounded flex flex-col items-center justify-center gap-0.5 shadow-sm transition-colors border shrink-0
                                        ${isItemMode 
                                            ? 'bg-primary border-primary text-white' 
                                            : 'bg-surface border-border text-muted hover:border-primary/50 hover:text-primary'
                                        }
                                    `}
                                    title={isItemMode ? "当前：物品操作 (尝试获取/交易)" : "点击切换为物品操作"}
                                >
                                    <Package size={14}/>
                                    <span className="text-[9px] font-bold">物品</span>
                                </button>

                                <button
                                    onClick={handleSubmit}
                                    disabled={isProcessingAI}
                                    className={`w-[4.5rem] h-[40px] rounded flex flex-col items-center justify-center gap-0.5 shadow-sm transition-colors border-transparent shrink-0
                                        ${pendingActions.length > 0
                                            ? (isBurningLife ? 'bg-endorphin hover:bg-endorphin/80 text-white' : 'bg-primary hover:bg-primary/80 text-white')
                                            : ((/@((?:char|env)[a-zA-Z0-9_\-]+)/.test(actionInput) || /@((?:char|env)[a-zA-Z0-9_\-]+)/.test(playerInput)) ? 'bg-oxytocin hover:bg-oxytocin/80 text-white' : 'bg-primary hover:bg-primary/80 text-white')
                                        }
                                    `}
                                    title="发送/执行当前行动"
                                >
                                    {isProcessingAI ? <Loader2 size={14} className="animate-spin"/> : (
                                        (pendingActions.length > 0 || (!/@((?:char|env)[a-zA-Z0-9_\-]+)/.test(actionInput) && !/@((?:char|env)[a-zA-Z0-9_\-]+)/.test(playerInput))) ? <Send size={14}/> : <Zap size={14}/>
                                    )}
                                    <span className="text-[10px] font-bold">
                                        {isProcessingAI ? "执行..." : (pendingActions.length > 0 ? (isBurningLife ? "燃命" : "发送") : ((/@((?:char|env)[a-zA-Z0-9_\-]+)/.test(actionInput) || /@((?:char|env)[a-zA-Z0-9_\-]+)/.test(playerInput)) ? "动作" : "发送"))}
                                    </span>
                                </button>
                            </div>

                            {attachedImages.length > 0 && (
                                <div className="border border-border rounded p-1 bg-surface-light/50 shrink-0 flex flex-col justify-center">
                                    <ImageAttachmentList 
                                        images={attachedImages}
                                        onRemove={removeImage}
                                        onAdd={openModal}
                                        maxImages={4}
                                        readOnly={isProcessingAI}
                                        onImageClick={editImage}
                                        compact={true} // Use compact mode
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Card Carousel */}
                    <CardCarousel 
                        availableCards={availableCards}
                        selectedCardId={selectedCardId}
                        onCardClick={handleCardClick}
                        onCancelSelection={() => setSelectedCardId(null)}
                        isProcessingAI={isProcessingAI}
                        popoverCardId={popoverState?.cardId}
                        doesCardNeedTarget={doesCardNeedTarget}
                    />
                </div>
            )}
        </div>
    );
};
