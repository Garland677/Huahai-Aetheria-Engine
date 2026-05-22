
import React, { useState, useEffect, useMemo } from 'react';
import { Character, Secret } from '../../types';
import { Button } from '../ui/Button';
import { Brain, Lock, Unlock, AlertTriangle, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { Window } from '../ui/Window';

interface PuzzleSolvingModalProps {
    isOpen: boolean;
    character: Character;
    secret: Secret;
    onClose: () => void;
    onSolve: (isCorrect: boolean, secret: Secret) => void;
    onIgnore: (secret: Secret) => void;
}

export const PuzzleSolvingModal: React.FC<PuzzleSolvingModalProps> = ({ 
    isOpen, character, secret, onClose, onSolve, onIgnore
}) => {
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'correct' | 'wrong'>('idle');

    // Shuffle options once when secret changes
    const options = useMemo(() => {
        const list = [
            secret.correctAnswer,
            secret.wrongAnswerA,
            secret.wrongAnswerB
        ].filter(Boolean); // Filter out empty if any
        // Fisher-Yates shuffle
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
    }, [secret.id]);

    // Reset state on open
    useEffect(() => {
        if (isOpen) {
            setSelectedOption(null);
            setStatus('idle');
        }
    }, [isOpen, secret.id]);

    const handleSubmit = () => {
        if (!selectedOption) return;

        if (selectedOption === secret.correctAnswer) {
            setStatus('correct');
            setTimeout(() => {
                onSolve(true, secret);
            }, 1500);
        } else {
            setStatus('wrong');
            setTimeout(() => {
                onSolve(false, secret);
            }, 1500);
        }
    };

    if (!isOpen) return null;

    return (
        <Window
            title={<span className="flex items-center gap-2 text-primary"><Brain size={18}/> 角色谜题</span>}
            onClose={onClose}
            maxWidth="max-w-md"
            height="h-auto"
            zIndex={300}
            noPadding={true}
        >
            <div className="p-6 flex flex-col gap-6 bg-surface/95 relative overflow-hidden">
                {/* Background Effect */}
                <div className={`absolute inset-0 pointer-events-none transition-colors duration-500 ${status === 'correct' ? 'bg-success-base/20' : status === 'wrong' ? 'bg-danger-base/20' : ''}`} />

                <div className="relative z-10 flex flex-col items-center text-center gap-2">
                    <div className="w-16 h-16 rounded-full border-4 border-surface shadow-xl overflow-hidden mb-2">
                         {character.avatarUrl ? (
                             <img src={character.avatarUrl} className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }}/>
                         ) : (
                             <div className="w-full h-full bg-muted flex items-center justify-center">?</div>
                         )}
                    </div>
                    <h3 className="text-lg font-bold text-body">
                        关于 <span className="text-primary">{character.name}</span> 的秘密
                    </h3>
                    <p className="text-xs text-muted">
                        你需要通过日常观察或推理来回答这个问题。
                    </p>
                </div>

                <div className="relative z-10 bg-black/20 p-4 rounded-lg border border-border/50 text-center">
                    <div className="text-xs text-primary font-bold uppercase mb-2 flex items-center justify-center gap-2">
                        <Lock size={12}/> Question
                    </div>
                    <div className="text-lg font-bold text-highlight font-serif">
                        {secret.question} ?
                    </div>
                </div>

                <div className="relative z-10 flex flex-col gap-3">
                    {options.map((opt, idx) => {
                        let btnClass = "bg-surface border-border hover:border-primary text-body";
                        if (status !== 'idle') {
                            if (opt === secret.correctAnswer) btnClass = "bg-success-base text-white border-success-base ring-2 ring-success-base/50";
                            else if (opt === selectedOption) btnClass = "bg-danger-base text-white border-danger-base opacity-50";
                            else btnClass = "bg-surface border-border opacity-30";
                        } else if (selectedOption === opt) {
                            btnClass = "bg-primary text-primary-fg border-primary ring-2 ring-primary/30";
                        }

                        return (
                            <button
                                key={idx}
                                onClick={() => status === 'idle' && setSelectedOption(opt)}
                                disabled={status !== 'idle'}
                                className={`
                                    w-full p-4 rounded-lg border text-sm font-bold transition-all transform duration-200
                                    ${btnClass}
                                    ${status === 'idle' ? 'hover:scale-[1.02] active:scale-95' : ''}
                                `}
                            >
                                {opt}
                            </button>
                        );
                    })}

                    <button
                        onClick={() => status === 'idle' && onIgnore(secret)}
                        disabled={status !== 'idle'}
                        className={`
                            w-full p-4 rounded-lg border text-sm font-bold transition-all transform duration-200
                            flex items-center justify-center gap-2
                            border-endorphin/30 text-endorphin bg-surface hover:bg-endorphin hover:text-endorphin-fg hover:border-endorphin
                            ${status === 'idle' ? 'hover:scale-[1.02] active:scale-95' : 'opacity-30'}
                        `}
                    >
                        <Trash2 size={16}/> 我没有兴趣
                    </button>
                </div>

                <div className="relative z-10 pt-2">
                    {status === 'idle' ? (
                        <Button 
                            onClick={handleSubmit} 
                            disabled={!selectedOption} 
                            className="w-full h-12 text-lg font-bold shadow-lg"
                        >
                            确认推测
                        </Button>
                    ) : status === 'correct' ? (
                        <div className="flex items-center justify-center gap-2 text-success-fg font-bold animate-in zoom-in">
                            <CheckCircle size={24}/> 回答正确！
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-2 text-danger-fg font-bold animate-in shake">
                            <XCircle size={24}/> 回答错误！
                        </div>
                    )}
                </div>
            </div>
        </Window>
    );
};
