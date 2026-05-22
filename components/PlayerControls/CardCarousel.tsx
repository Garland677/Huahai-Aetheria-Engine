
import React from 'react';
import { Card } from '../../types';
import { Box, Zap, Coins, Target } from 'lucide-react';

interface CardCarouselProps {
    availableCards: Card[];
    selectedCardId: string | null;
    onCardClick: (e: React.MouseEvent, card: Card) => void;
    onCancelSelection: () => void;
    isProcessingAI: boolean;
    popoverCardId?: string;
    doesCardNeedTarget: (card: Card) => boolean;
}

export const CardCarousel: React.FC<CardCarouselProps> = ({
    availableCards,
    selectedCardId,
    onCardClick,
    onCancelSelection,
    isProcessingAI,
    popoverCardId,
    doesCardNeedTarget
}) => {
    return (
        <div 
            className="flex-1 overflow-x-auto flex gap-1.5 items-center custom-scrollbar"
            // Stop propagation to prevent App.tsx swipe logic
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
        >
            {availableCards.map((card, index) => {
                const isPopoverSource = popoverCardId === card.id;
                const needsTarget = doesCardNeedTarget(card);
                const isVirtual = card.isVirtualAction;
                
                return (
                    <div 
                        key={`${card?.id}_${index}`}
                        onClick={(e) => onCardClick(e, card)}
                        className={`h-14 w-32 rounded-lg border px-2 py-1.5 flex flex-col justify-between cursor-pointer transition-all shrink-0 group overflow-hidden
                            ${selectedCardId === card?.id ? (isVirtual ? 'border-oxytocin bg-oxytocin/10 ring-1 ring-oxytocin' : 'border-primary bg-primary/10 ring-1 ring-primary') : 'border-border bg-surface-light hover:border-highlight'} 
                            ${isProcessingAI ? 'opacity-50 cursor-not-allowed' : ''}
                            ${isPopoverSource ? (isVirtual ? 'z-[65] relative ring-2 ring-oxytocin' : 'z-[65] relative ring-2 ring-primary') : 'relative'}
                            ${isVirtual ? 'border-r-4 border-r-oxytocin' : ''} 
                        `}
                        title={card?.description} // Add tooltip since description is removed
                    >
                        {card?.triggerType === 'reaction' && (
                            <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-endorphin border border-surface z-10" title="反应卡牌"></div>
                        )}
                        
                        {/* Top Row: Name */}
                        <div className="flex items-center">
                            {/* Card Name -> Dopamine or Oxytocin if Virtual */}
                            <div className={`text-[11px] font-bold leading-tight truncate w-full pr-3 ${isVirtual ? 'text-oxytocin' : 'text-dopamine'}`}>{card?.name}</div>
                        </div>
                        
                        {/* Bottom Row: Meta Info */}
                        <div className="flex justify-between items-end text-[9px] border-t border-border/30 pt-1 mt-0.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-muted font-mono shrink-0">{card?.itemType === 'skill' ? '技能' : '物品'}</span>
                                {needsTarget && (
                                    <span className={`font-bold flex items-center gap-0.5 shrink-0 animate-pulse ${isVirtual ? 'text-oxytocin' : 'text-endorphin'}`}>
                                        <Target size={8}/> 需目标
                                    </span>
                                )}
                            </div>
                            
                            {card?.cost ? (
                                <span className="text-warning-fg font-mono flex items-center gap-0.5 shrink-0 pl-1">
                                    <div className="w-1 h-1 bg-warning-base rounded-full"></div>{card.cost}
                                </span>
                            ) : (
                                <span className="text-muted">-</span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
