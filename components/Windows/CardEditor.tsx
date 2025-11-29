

import React, { useState } from 'react';
import { Card, Effect, GameState, Character, AttributeVisibility } from '../../types';
import { Button, Input, Label, TextArea } from '../ui/Button';
import { Plus, Trash2, X, Sparkles, Box, Zap, Coins, Hourglass, ShieldAlert, Wand2, EyeOff, Eye, MessageSquare } from 'lucide-react';
import { ImageUploader } from '../ui/ImageUploader';

interface CardEditorProps {
  onSave: (card: Card) => void;
  onClose: () => void;
  initialCard?: Card;
  gameState: GameState; 
}

export const CardEditor: React.FC<CardEditorProps> = ({ onSave, onClose, initialCard, gameState }) => {
  const ensureHitEffect = (c: Card): Card => {
      if (!c.effects || c.effects.length === 0) {
          return {
              ...c,
              effects: [{
                  id: 'effect_hit_' + Date.now(),
                  name: '命中判定',
                  targetType: 'specific_char',
                  targetAttribute: '健康', 
                  targetId: '',
                  value: 0, 
                  conditionDescription: '无 (默认为真/必中)', 
                  conditionContextKeys: []
              }]
          };
      }
      return c;
  };

  const [card, setCard] = useState<Card>(ensureHitEffect(initialCard || {
    id: `card_${Date.now()}`,
    name: '新卡牌',
    description: '',
    imageUrl: '',
    itemType: 'skill',
    triggerType: 'active',
    cost: 5,
    effects: [],
    visibility: AttributeVisibility.PUBLIC
  }));

  const addEffect = () => {
    const newEffect: Effect = {
      id: Date.now().toString(),
      name: '附加效果',
      targetType: 'specific_char',
      targetId: '',
      targetAttribute: '健康',
      value: 0, 
      dynamicValue: false,
      conditionDescription: '无 (默认跟随命中)', 
      conditionContextKeys: []
    };
    setCard({ ...card, effects: [...(card.effects || []), newEffect] });
  };

  const updateEffect = (index: number, updates: Partial<Effect>) => {
    const newEffects = [...(card.effects || [])];
    newEffects[index] = { ...newEffects[index], ...updates };
    setCard({ ...card, effects: newEffects });
  };

  const removeEffect = (index: number) => {
    // Prevent deleting the last effect if it's the only one (keep at least one hit check)
    if ((card.effects || []).length <= 1) {
        alert("卡牌必须至少包含一个效果（通常为命中判定）。");
        return;
    }
    setCard({ ...card, effects: (card.effects || []).filter((_, i) => i !== index) });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 shadow-2xl rounded-lg flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-lg shrink-0">
          <h2 className="font-bold text-lg text-slate-100">卡牌 / 技能编辑器</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Basic Card Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="flex justify-between items-center">
                  <Label>名称</Label>
                  <button 
                    className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded ${card.visibility === AttributeVisibility.PRIVATE ? 'bg-red-900/50 text-red-300' : 'bg-slate-800 text-slate-400'}`}
                    onClick={() => setCard({...card, visibility: card.visibility === AttributeVisibility.PUBLIC ? AttributeVisibility.PRIVATE : AttributeVisibility.PUBLIC})}
                  >
                      {card.visibility === AttributeVisibility.PRIVATE ? <><EyeOff size={10}/> 隐藏 (本人可见)</> : <><Eye size={10}/> 公开</>}
                  </button>
              </div>
              <Input value={card.name} onChange={e => setCard({ ...card, name: e.target.value })} />
            </div>
            <div>
              <Label>图片</Label>
              <ImageUploader value={card.imageUrl || ''} onChange={(val) => setCard({...card, imageUrl: val})} placeholder="URL or Paste"/>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
               <div>
                   <Label>类型</Label>
                   <div className="flex gap-4 mt-2 bg-gray-950 p-2 rounded border border-slate-800">
                       <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                           <input type="radio" checked={card.itemType === 'skill'} onChange={() => setCard({...card, itemType: 'skill'})} />
                           <Zap size={14} className="text-amber-400"/> 技能
                       </label>
                       <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                           <input type="radio" checked={card.itemType === 'consumable'} onChange={() => setCard({...card, itemType: 'consumable'})} />
                           <Box size={14} className="text-blue-400"/> 物品
                       </label>
                   </div>
               </div>
               <div className="sm:col-span-2">
                   <Label>触发方式</Label>
                   <div className="flex flex-wrap gap-3 mt-2 bg-gray-950 p-2 rounded border border-slate-800">
                       <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer" title="手动使用">
                           <input type="radio" checked={card.triggerType === 'active'} onChange={() => setCard({...card, triggerType: 'active'})} />
                           主动
                       </label>
                       <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer" title="手动使用，但先触发目标反应">
                           <input type="radio" checked={card.triggerType === 'reaction'} onChange={() => setCard({...card, triggerType: 'reaction'})} />
                           <MessageSquare size={14} className="text-green-400"/> 反应
                       </label>
                       <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                           <input type="radio" checked={card.triggerType === 'passive'} onChange={() => setCard({...card, triggerType: 'passive'})} />
                           被动
                       </label>
                       <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer" title="回合结束时自动判定">
                           <input type="radio" checked={card.triggerType === 'settlement'} onChange={() => setCard({...card, triggerType: 'settlement'})} />
                           <Hourglass size={14} className="text-purple-400"/> 结算
                       </label>
                       <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer" title="回合结束时触发，但不显示来源">
                           <input type="radio" checked={card.triggerType === 'hidden_settlement'} onChange={() => setCard({...card, triggerType: 'hidden_settlement'})} />
                           <EyeOff size={14} className="text-red-400"/> 隐藏结算
                       </label>
                   </div>
               </div>
               <div>
                  <Label>价格 (CP)</Label>
                  <div className="flex items-center gap-2 mt-2">
                      <Coins size={16} className="text-yellow-500"/>
                      <Input 
                          type="number" 
                          value={card.cost} 
                          onChange={e => setCard({...card, cost: parseInt(e.target.value) || 0})} 
                          className="flex-1"
                      />
                  </div>
               </div>
          </div>

          <div>
            <Label>描述</Label>
            <TextArea 
              rows={2}
              value={card.description}
              onChange={e => setCard({ ...card, description: e.target.value })}
              placeholder="请填写自然语言描述（如：使用者用力挥舞巨剑...）。此描述将作为AI判断效果的依据。"
            />
            <p className="text-[10px] text-slate-500 mt-1">提示: 描述不只是展示文本，它定义了动作的具体方式，AI会参考此内容来生成动态效果。</p>
          </div>

          {/* Effects Section */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-slate-300 flex items-center gap-2"><Sparkles size={16}/> 效果配置序列</h3>
              <Button size="sm" onClick={addEffect} variant="secondary"><Plus size={14} className="mr-1" /> 添加效果</Button>
            </div>
            
            <p className="text-xs text-slate-500 mb-4 bg-slate-800/30 p-2 rounded border border-slate-800">
               系统提示: 
               1. <b>序列1</b> 通常为「命中/条件判定」，修改值建议设为 0。如果此判定失败，后续效果将不执行。<br/>
               2. <b>序列2+</b> 为实际效果（如伤害）。请使用中文自然语言描述判定条件。
            </p>

            <div className="space-y-4">
              {(card.effects || []).map((effect, idx) => {
                const isHitEffect = idx === 0;
                return (
                  <div key={effect.id} className={`bg-gray-950 p-4 rounded border ${isHitEffect ? 'border-indigo-900/50 bg-indigo-900/10' : 'border-slate-800'} text-sm relative group hover:border-slate-600 transition-colors`}>
                    {isHitEffect && (
                        <div className="absolute -top-2 -left-2 bg-indigo-600 text-white text-[10px] px-2 py-0.5 rounded shadow flex items-center gap-1 z-10">
                            <ShieldAlert size={10}/> 基础命中/触发判定
                        </div>
                    )}
                    
                    <div className={`absolute top-2 right-2 transition-opacity ${isHitEffect ? '' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
                         <button onClick={() => removeEffect(idx)} className="text-red-400 hover:bg-red-900/50 p-1 rounded" title="删除效果"><Trash2 size={16} /></button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3 mt-2">
                      {/* Column 1: Target Scope */}
                      <div>
                          <Label>目标范围</Label>
                          <select 
                              className="w-full bg-gray-950 border border-slate-700 rounded px-2 py-2.5 text-slate-200 mb-2 focus:outline-none focus:border-indigo-500"
                              value={effect.targetType}
                              onChange={e => updateEffect(idx, { targetType: e.target.value as any, targetId: '' })}
                          >
                              <option value="specific_char">指定角色 (运行时选)</option>
                              <option value="ai_choice">AI 自主选择 (Smart)</option>
                              <option value="self">使用者自身 (Self)</option>
                              <option value="all_chars">所有角色 (All)</option>
                              <option value="world">世界环境 (World)</option>
                              {!isHitEffect && <option value="hit_target">命中目标 (同首位)</option>}
                          </select>

                          {effect.targetType === 'specific_char' && (
                              <select 
                                  className="w-full bg-gray-950 border border-slate-700 rounded px-2 py-2 text-slate-200 focus:outline-none focus:border-indigo-500"
                                  value={effect.targetId || ''}
                                  onChange={e => updateEffect(idx, { targetId: e.target.value })}
                              >
                                  <option value="">-- 固定目标 (可选) --</option>
                                  {(Object.values(gameState.characters) as Character[]).map(c => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                              </select>
                          )}
                      </div>

                      {/* Column 2: Attribute Input */}
                      <div>
                          <Label>目标属性</Label>
                          <Input 
                              value={effect.targetAttribute}
                              onChange={e => updateEffect(idx, { targetAttribute: e.target.value })}
                              placeholder="例如: 健康"
                          />
                      </div>

                      {/* Column 3: Modification Value */}
                      <div className="relative">
                          <div className="flex justify-between items-center">
                              <Label>修改值/状态</Label>
                              <label className="text-[10px] text-indigo-400 flex items-center gap-1 cursor-pointer" title="勾选后，数值将由AI根据上下文决定">
                                  <input 
                                      type="checkbox" 
                                      checked={effect.dynamicValue || false}
                                      onChange={e => updateEffect(idx, { dynamicValue: e.target.checked })}
                                      className="accent-indigo-500"
                                  /> 
                                  <Wand2 size={10}/> AI 决定
                              </label>
                          </div>
                          <Input 
                              value={effect.value} 
                              onChange={e => updateEffect(idx, { value: e.target.value })} 
                              placeholder={effect.dynamicValue ? "参考范围 (如: 10-50)" : "+10, -5, 或 文本"}
                              disabled={false} 
                              className={effect.dynamicValue ? "border-indigo-500/50 text-indigo-300" : ""}
                          />
                          {isHitEffect && Number(effect.value) === 0 && (
                               <span className="text-[9px] text-indigo-400 absolute bottom-[-18px] left-0">命中判定建议值为 0</span>
                          )}
                      </div>
                    </div>

                    {/* Condition Logic */}
                    <div>
                      <Label>生效条件 (中文自然语言 / Natural Language)</Label>
                      <TextArea 
                          value={effect.conditionDescription} 
                          onChange={e => updateEffect(idx, { conditionDescription: e.target.value })} 
                          placeholder={isHitEffect ? "无 (默认为真) 或: 目标健康值小于30" : "无 (默认跟随命中)"}
                          className={`w-full resize-none ${isHitEffect ? "border-indigo-500/30" : ""}`}
                          rows={3}
                      />
                      <span className="text-[10px] text-slate-500">示例: "使用者是男性", "目标处于虚弱状态"。</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950 rounded-b-lg flex justify-end gap-2 shrink-0">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={() => onSave(card)}>保存配置</Button>
        </div>
      </div>
    </div>
  );
};
