
import { useState, useEffect, MutableRefObject } from 'react';
import { GameState, GamePhase, DebugLog, LogEntry } from '../types';
import { useMapLogic } from './useMapLogic';
import { useActionLogic } from './useActionLogic';
import { usePhaseLogic } from './usePhaseLogic';

interface UseEngineProps {
    state: GameState;
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string, overrides?: Partial<LogEntry>) => void;
    addDebugLog: (log: DebugLog) => void;
    requestPlayerReaction?: (charId: string, title: string, message: string) => Promise<string | null>;
}

export interface PendingAction {
    id: string;
    type: 'use_skill' | 'move_to' | 'lottery';
    cardId?: string;
    targetId?: string;
    cardName: string;
    destinationName?: string;
    destinationId?: string;
    // Lottery fields
    poolId?: string;
    action?: 'draw' | 'deposit' | 'peek';
    amount?: number;
    cardIds?: string[];
    itemName?: string;
    isHidden?: boolean;
}

export const useEngine = ({ state, stateRef, updateState, addLog, addDebugLog, requestPlayerReaction }: UseEngineProps) => {
    const [isProcessingAI, setIsProcessingAI] = useState(false);
    const [processingLabel, setProcessingLabel] = useState("");
    
    const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
    // New Action Queue State
    const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
    
    // Legacy selection state (for immediate feedback before adding to queue)
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
    
    const [playerInput, setPlayerInput] = useState("");

    const setPhase = (phase: GamePhase) => updateState(prev => ({ ...prev, round: { ...prev.round, phase, lastErrorMessage: undefined } }));
    const setError = (msg: string) => updateState(prev => ({ ...prev, round: { ...prev.round, lastErrorMessage: msg } }));
    
    // Centralized AI Failure Handler
    const handleAiFailure = (context: string, e: any) => {
        console.error(`${context} Failed`, e);
        addLog(`系统: AI 运算连续失败（数据无效或无响应）。当前操作已取消，流程暂停。请重试。(${e.message})`);
        setError(`${context} Failed: ${e.message}`);
        updateState(prev => ({ ...prev, round: { ...prev.round, isPaused: true } }));
        setIsProcessingAI(false);
    };

    // Sub-hooks for logic splitting
    const { exploreLocation, processLocationChange, resetLocation } = useMapLogic({
        stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, addDebugLog
    });

    const { phaseOrderDetermination, phaseTurnStart, phaseSettlement, phaseRoundEnd } = usePhaseLogic({
        stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, setPhase, addDebugLog
    });

    const { performCharacterAction, submitPlayerTurn } = useActionLogic({
        stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, 
        setSelectedCharId, playerInput, setPlayerInput, 
        selectedCharId,
        selectedCardId, selectedTargetId, setSelectedCardId, setSelectedTargetId, 
        pendingActions, setPendingActions,
        addDebugLog,
        requestPlayerReaction
    });

    // --- MAP & EXPLORATION TRIGGER ---
    useEffect(() => {
        if (state.round.phase === 'turn_start' || state.round.phase === 'char_acting') return;
        if (isProcessingAI) return;
        processLocationChange();
    }, [state.map.activeLocationId]);

    // --- CORE FSM LOOP ---
    useEffect(() => {
        if (state.round.isPaused) return;
        if (isProcessingAI) return;

        const executePhase = async () => {
            const currentPhase = state.round.phase;
            try {
                switch (currentPhase) {
                    case 'init':
                    case 'order':
                        await phaseOrderDetermination();
                        break;
                    case 'turn_start':
                        phaseTurnStart();
                        break;
                    case 'char_acting':
                        await performCharacterAction();
                        break;
                    case 'executing':
                        break;
                    case 'settlement':
                        await phaseSettlement();
                        break;
                    case 'round_end':
                        phaseRoundEnd();
                        break;
                }
            } catch (e: any) {
                console.error(`Phase ${currentPhase} Loop Error`, e);
                updateState(prev => ({ ...prev, round: { ...prev.round, isPaused: true, lastErrorMessage: e.message } }));
            }
        };

        executePhase();
    }, [state.round.phase, state.round.isPaused, state.round.turnIndex, isProcessingAI]);

    return {
        isProcessingAI,
        processingLabel,
        selectedCharId, setSelectedCharId,
        selectedCardId, setSelectedCardId,
        selectedTargetId, setSelectedTargetId,
        playerInput, setPlayerInput,
        pendingActions, setPendingActions,
        submitPlayerTurn,
        recalculateTurnOrder: phaseOrderDetermination,
        resetLocation
    };
};
