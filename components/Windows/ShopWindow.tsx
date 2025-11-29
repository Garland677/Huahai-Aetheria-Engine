
import React, { useState } from 'react';
import { GameState, Card, Character, AttributeType, AttributeVisibility } from '../../types';
import { Button, Input, Label } from '../ui/Button';
import { X, ShoppingCart, Plus, Coins, Zap, Box, Edit2, Info } from 'lucide-react';
import { CardEditor } from './CardEditor';

interface ShopWindowProps {
    winId: number;
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    closeWindow: (id: number) => void;
    addLog: (text: string) => void;
    activeCharId?: string;
}

export const ShopWindow: React.FC<ShopWindowProps> = ({ winId, state, updateState, closeWindow, addLog, activeCharId }) => {
    // "Create" is now the default and only mode
    const [isCreating, setIsCreating] = useState(false);

    const activeChar = activeCharId ? state.characters[activeCharId] : null;
    
    // Helper to get CP
    const getCP = (char: Character) => {
        const attr = char.attributes['cp'] || char.attributes['创造点'];
        return Number(attr?.value || 0);
    };
    
    const currentCP = activeChar ? getCP(activeChar) : 0;
    const creationCost = state.defaultSettings.gameplay.defaultCreationCost;

    const handleCreateSave = (newCard: Card) => {
        if (!activeChar) return;
        if (currentCP < creationCost) {
            alert("CP 不足！");
            return;
        }

        // Check if an identical card exists in pool
        const existingCard = state.cardPool.find(c => 
            c.name === newCard.name && c.description === newCard.description
        );

        const finalCard = existingCard || { ...newCard, id: `card_gen_${Date.now()}` };

        updateState(prev => {
            const newChars = { ...prev.characters };
            const char = newChars[activeChar.id];
            const cpAttr = char.attributes['cp'] || char.attributes['创造点'];
            
            // Deduct CP
            if (cpAttr) {
                cpAttr.value = Number(cpAttr.value) - creationCost;
            }
            
            // Add to Global Pool (if new) AND Inventory
            const newPool = existingCard ? prev.cardPool : [...prev.cardPool, finalCard];
            char.inventory = [...char.inventory, finalCard.id];
            
            return { ...prev, cardPool: newPool, characters: newChars };
        });

        addLog(`> 创造: ${activeChar.name} 领悟了技能 [${finalCard.name}] (-${creationCost} CP) 并加入了背包。${existingCard ? '(复用现有技能)' : ''}`);
        setIsCreating(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            
            {/* Visual Card Editor Overlay */}
            {isCreating && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
                    <CardEditor 
                        onClose={() => setIsCreating(false)}
                        onSave={handleCreateSave}
                        gameState={state}
                        initialCard={{
                            id: `new_${Date.now()}`,
                            name: "新能力",
                            description: "描述...",
                            itemType: "skill",
                            triggerType: "active",
                            cost: 0, // Not used for purchase cost here, but logic cost
                            effects: [],
                            visibility: AttributeVisibility.PUBLIC
                        }}
                    />
                </div>
            )}

            <div className="w-full max-w-2xl h-[400px] bg-slate-900 border border-slate-700 shadow-2xl rounded-lg flex flex-col relative overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="font-bold text-lg text-slate-100 flex items-center gap-2"><Zap size={18} className="text-indigo-400"/> 创造能力 (Create Ability)</h2>
                        {activeChar && (
                            <div className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-900/50 px-3 py-1 rounded-full text-xs text-yellow-400">
                                <Coins size={12}/> 当前 CP: {currentCP}
                            </div>
                        )}
                    </div>
                    <button onClick={() => closeWindow(winId)} className="text-slate-400 hover:text-white"><X size={20}/></button>
                </div>

                <div className="flex-1 bg-slate-900 p-8 flex flex-col items-center justify-center relative">
                    {!activeChar ? (
                        <div className="flex items-center justify-center h-full text-slate-500">
                            请先在主界面选择一个由你控制的角色。
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-6 max-w-md text-center">
                            <div 
                                onClick={() => setIsCreating(true)}
                                className="w-24 h-24 rounded-full bg-indigo-900/30 flex items-center justify-center border-2 border-dashed border-indigo-500/50 cursor-pointer hover:bg-indigo-900/50 hover:scale-105 transition-all"
                            >
                                <Plus size={48} className="text-indigo-400"/>
                            </div>
                            
                            <div>
                                <h3 className="text-xl font-bold text-white mb-2">设计全新能力</h3>
                                <p className="text-sm text-slate-400 leading-relaxed">
                                    消耗 <span className="text-yellow-400 font-bold">{creationCost} CP</span> 来设计一张全新的卡牌（技能、物品或被动）。<br/>
                                    该卡牌将永久加入游戏并直接放入你的背包。
                                </p>
                            </div>

                            <Button onClick={() => setIsCreating(true)} disabled={currentCP < creationCost} className="px-8 py-2 text-sm font-bold">
                                开始创造 (-{creationCost} CP)
                            </Button>
                            
                            {currentCP < creationCost && <p className="text-xs text-red-400 font-bold">CP 不足</p>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
