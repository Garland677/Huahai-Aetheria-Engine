import React, { useState, useMemo } from 'react';
import { GameState, Character, Secret, AttributeType, AttributeVisibility } from '../../types';
import { Window } from '../ui/Window';
import { Brain, Lock, Unlock, CheckCircle, Search, MapPin, Trash2 } from 'lucide-react';
import { PuzzleSolvingModal } from '../Modals/PuzzleSolvingModal';
import { getAttr } from '../../services/attributeUtils';
import { Button } from '../ui/Button';

interface PuzzleWindowProps {
    winId: number;
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    closeWindow: (id: number) => void;
    addLog: (text: string, overrides?: any) => void;
}

export const PuzzleWindow: React.FC<PuzzleWindowProps> = ({ winId, state, updateState, closeWindow, addLog }) => {
    const [solvingSecret, setSolvingSecret] = useState<{ charId: string, secret: Secret } | null>(null);
    const [batchClearConfirm, setBatchClearConfirm] = useState(false);

    const activeLocId = state.map.activeLocationId;
    const activeLocName = activeLocId ? state.map.locations[activeLocId]?.name : "未知区域";

    // Gather characters with UNSOLVED secrets in current location
    const puzzleTargets = useMemo(() => {
        const targets: { char: Character, secrets: Secret[] }[] = [];
        
        (Object.values(state.characters) as Character[]).forEach(c => {
            const pos = state.map.charPositions[c.id];
            if (pos && pos.locationId === activeLocId) {
                // Filter for unsolved secrets only
                const unsolved = (c.secrets || []).filter(s => !s.solved);
                if (unsolved.length > 0) {
                    targets.push({ char: c, secrets: unsolved });
                }
            }
        });
        
        return targets;
    }, [state.characters, activeLocId]);

    const handleSolveResult = (isCorrect: boolean, secret: Secret) => {
        if (!solvingSecret) return;
        const { charId } = solvingSecret;
        const charName = state.characters[charId]?.name || "未知角色";

        updateState(prev => {
            const newChars = { ...prev.characters };
            const existingChar = newChars[charId];
            if (!existingChar) return prev;

            // Clone character to ensure immutability
            const char = { ...existingChar };
            char.attributes = { ...char.attributes }; // Clone attributes map

            // --- COMMON LOGIC (Execute regardless of success/failure) ---
            // 1. Mark secret as solved
            char.secrets = (char.secrets || []).map(s => s.id === secret.id ? { ...s, solved: true } : s);
            
            // 2. Add as public attribute if not exists (Information obtained either way)
            const attrKey = secret.question;
            if (!char.attributes[attrKey]) {
                char.attributes[attrKey] = {
                    id: `attr_sec_${Date.now()}`,
                    name: attrKey,
                    type: AttributeType.TEXT,
                    value: secret.correctAnswer,
                    visibility: AttributeVisibility.PUBLIC,
                    description: "通过解谜获得的情报"
                };
            }

            // --- BRANCHED LOGIC (Reward vs Penalty) ---
            if (isCorrect) {
                // 3. Reward: Increase Active (活跃) by 30
                // Find key (handle alias)
                const activeKey = Object.keys(char.attributes).find(k => k === '活跃' || k === 'active');
                if (activeKey) {
                    const attr = { ...char.attributes[activeKey] };
                    attr.value = Math.min(100, Number(attr.value) + 30);
                    char.attributes[activeKey] = attr;
                } else {
                    // Initialize if missing
                    char.attributes['活跃'] = { id: '活跃', name: '活跃', type: AttributeType.NUMBER, value: 80, visibility: AttributeVisibility.PUBLIC };
                }
            } else {
                // 4. Penalty: Decrease Pleasure (快感) by 30
                const pleasureKey = Object.keys(char.attributes).find(k => k === '快感' || k === 'pleasure');
                if (pleasureKey) {
                    const attr = { ...char.attributes[pleasureKey] };
                    attr.value = Math.max(0, Number(attr.value) - 30);
                    char.attributes[pleasureKey] = attr;
                } else {
                     // Initialize if missing (start at 50 - 30 = 20)
                     char.attributes['快感'] = { id: '快感', name: '快感', type: AttributeType.NUMBER, value: 20, visibility: AttributeVisibility.PUBLIC };
                }
            }

            newChars[charId] = char;
            return { ...prev, characters: newChars };
        });

        if (isCorrect) {
            addLog(`系统: 你看穿了 [${charName}] 的心思！角色秘密公开: ${secret.question} = ${secret.correctAnswer} (活跃 +30)`);
        } else {
            addLog(`系统: 你对 [${charName}] 的猜测是错误的，对方感到不悦，但公开了以下秘密: ${secret.question} = ${secret.correctAnswer} (快感 -30)`);
        }
        
        setSolvingSecret(null);
    };

    const handleIgnore = (secret: Secret) => {
        if (!solvingSecret) return;
        const { charId } = solvingSecret;
        const charName = state.characters[charId]?.name || "未知角色";

        updateState(prev => {
            const newChars = { ...prev.characters };
            const existingChar = newChars[charId];
            if (!existingChar) return prev;

            const char = { ...existingChar };
            // Remove the secret permanently
            char.secrets = (char.secrets || []).filter(s => s.id !== secret.id);
            
            newChars[charId] = char;
            return { ...prev, characters: newChars };
        });

        addLog(`系统: [${charName}] 的秘密 "${secret.question}"已被忽略。`);
        setSolvingSecret(null);
    };

    const handleBatchClear = () => {
        if (!batchClearConfirm) {
            setBatchClearConfirm(true);
            setTimeout(() => setBatchClearConfirm(false), 3000);
            return;
        }

        let totalRemoved = 0;

        updateState(prev => {
            const newChars = { ...prev.characters };
            
            // Iterate over the targets identified in the current view (active location)
            puzzleTargets.forEach(({ char }) => {
                const targetChar = newChars[char.id];
                if (targetChar && targetChar.secrets) {
                    const originalLength = targetChar.secrets.length;
                    // Filter: Keep ONLY solved secrets, effectively removing all unsolved ones
                    targetChar.secrets = targetChar.secrets.filter(s => s.solved);
                    totalRemoved += (originalLength - targetChar.secrets.length);
                }
            });

            return { ...prev, characters: newChars };
        });

        addLog(`系统: 已批量忽略当前地点的 ${totalRemoved} 个未解之谜。`);
        setBatchClearConfirm(false);
    };

    return (
        <Window
            title="解谜"
            icon={<Brain size={18}/>}
            onClose={() => closeWindow(winId)}
            maxWidth="max-w-2xl"
            height="h-[80vh]"
            zIndex={200}
            noPadding={true}
        >
            {solvingSecret && (
                <PuzzleSolvingModal 
                    isOpen={true}
                    character={state.characters[solvingSecret.charId]}
                    secret={solvingSecret.secret}
                    onClose={() => setSolvingSecret(null)}
                    onSolve={handleSolveResult}
                    onIgnore={handleIgnore}
                />
            )}

            <div className="flex flex-col h-full bg-surface-light/30">
                <div className="p-3 bg-surface-highlight border-b border-border flex justify-between items-center text-xs text-muted">
                    <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1"><MapPin size={12}/> 当前区域: <span className="text-body font-bold">{activeLocName}</span></span>
                        <span>发现 {puzzleTargets.reduce((sum, t) => sum + t.secrets.length, 0)} 个未解之谜</span>
                    </div>
                    
                    <Button 
                        size="sm" 
                        variant={batchClearConfirm ? "danger" : "secondary"}
                        onClick={handleBatchClear}
                        disabled={puzzleTargets.length === 0}
                        className={`h-7 text-xs px-2 transition-all ${batchClearConfirm ? 'animate-pulse' : ''}`}
                        title="删除当前地点所有未解开的秘密"
                    >
                        <Trash2 size={12} className="mr-1"/> {batchClearConfirm ? "确认清除?" : "批量清除"}
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {puzzleTargets.length === 0 && (
                        <div className="text-center text-muted italic py-10 flex flex-col items-center gap-2">
                            <Search size={32} className="opacity-20"/>
                            <p>当前地点没有侦测到可解开的秘密。</p>
                            <p className="text-[10px]">已解开的秘密请前往角色面板查看。</p>
                        </div>
                    )}

                    {puzzleTargets.map(({ char, secrets }) => (
                        <div key={char.id} className="bg-surface border border-border rounded-lg overflow-hidden shadow-sm">
                            <div className="p-3 bg-black/20 flex items-center gap-3 border-b border-border/50">
                                <div className="w-8 h-8 rounded-full border border-border overflow-hidden bg-black shrink-0">
                                    {char.avatarUrl && <img src={char.avatarUrl} className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }}/>}
                                </div>
                                <div className="font-bold text-sm text-body">{char.name}</div>
                            </div>
                            
                            <div className="divide-y divide-border/30">
                                {secrets.map(secret => (
                                    <div 
                                        key={secret.id} 
                                        onClick={() => setSolvingSecret({ charId: char.id, secret })}
                                        className="p-3 flex items-center justify-between transition-colors hover:bg-surface-highlight cursor-pointer"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-1.5 rounded-full bg-primary/20 text-primary">
                                                <Lock size={14}/>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-body">
                                                    {secret.question}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        <div className="text-[10px] bg-primary text-primary-fg px-2 py-1 rounded font-bold">
                                            解答
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </Window>
    );
};