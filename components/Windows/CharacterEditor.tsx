
import React, { useState, useEffect } from 'react';
import { Character, Provider, AttributeType, Card, GameState, GameAttribute, AttributeVisibility, Drive, MapLocation, GlobalContextMessage, Conflict } from '../../types';
import { Button, Input, Label, TextArea } from '../ui/Button';
import { X, Save, BrainCircuit, Plus, Edit, Trash, Eye, EyeOff, List, Briefcase, Backpack, CheckSquare, Square, Coins, Lightbulb, Cpu, Archive, FileJson, Bot, User, MapPin, AlertTriangle, Footprints, Dices, MessageSquare, Heart, VenetianMask } from 'lucide-react';
import { CardEditor } from './CardEditor';
import { ImageUploader } from '../ui/ImageUploader';
import { generateRandomFlagAvatar } from '../../assets/imageLibrary';
import { getCharacterMemory } from '../../services/aiService';
import { defaultAcquireCard, defaultInteractCard, defaultTradeCard } from '../../services/DefaultSettings';

interface CharacterEditorProps {
  character?: Character;
  onSave: (char: Character, locationId?: string) => void; 
  onClose: () => void;
  gameState: GameState; 
  onUpdatePoolCard?: (card: Card) => void; 
  isTemplate?: boolean;
}

export const CharacterEditor: React.FC<CharacterEditorProps> = ({ character, onSave, onClose, gameState, onUpdatePoolCard, isTemplate = false }) => {
  
  // Helper to generate next ID
  const generateNextId = () => {
      const existingIds = Object.keys(gameState.characters).map(id => Number(id)).filter(n => !isNaN(n));
      let next = 1;
      while (existingIds.includes(next)) {
          next++;
      }
      return next.toString();
  };

  // Initialize from Template if creating new
  const getInitialState = (): Character => {
      if (character) return character;
      
      const tmpl = JSON.parse(JSON.stringify(gameState.defaultSettings.templates.character));
      tmpl.id = generateNextId();
      
      // Auto generate avatar for new characters
      if (!tmpl.avatarUrl) {
          tmpl.avatarUrl = generateRandomFlagAvatar();
      }
      
      // Override CP with gameplay settings
      if (tmpl.attributes.cp) {
          tmpl.attributes.cp.value = gameState.defaultSettings.gameplay.defaultInitialCP;
      }
      
      // Use global judge config as default AI config
      tmpl.aiConfig = gameState.judgeConfig ? { ...gameState.judgeConfig } : {
          provider: Provider.XAI,
          model: 'grok-4-1-fast-reasoning',
          temperature: 1.0
      };

      // Ensure default skills (Trade, Interact, Acquire) are present for manual creation
      // This handles cases where the template might be old or missing them
      if (!tmpl.skills) tmpl.skills = [];
      const currentSkillIds = new Set(tmpl.skills.map((s: Card) => s.id));
      
      if (!currentSkillIds.has(defaultAcquireCard.id)) tmpl.skills.push(defaultAcquireCard);
      if (!currentSkillIds.has(defaultTradeCard.id)) tmpl.skills.push(defaultTradeCard);
      if (!currentSkillIds.has(defaultInteractCard.id)) tmpl.skills.push(defaultInteractCard);
      
      return tmpl;
  };

  const [char, setChar] = useState<Character>(getInitialState());

  // EFFECT: Sync state if external character prop updates (e.g. Force Apply Global AI Config)
  useEffect(() => {
      if (character && character.id === char.id) {
          // Check if key properties changed (specifically AI config)
          // We do a shallow check or specific check to avoid loop if we just type in input
          // Here we specifically care about AI Config updates from "Force Apply"
          const extConfig = character.aiConfig;
          const localConfig = char.aiConfig;
          
          if (extConfig && localConfig) {
               if (extConfig.provider !== localConfig.provider || extConfig.model !== localConfig.model || extConfig.apiKey !== localConfig.apiKey) {
                   setChar(prev => ({ ...prev, aiConfig: extConfig }));
               }
          }
      }
  }, [character]);

  // Initial Location Logic
  const currentPos = gameState.map.charPositions[char.id];
  const [selectedLocationId, setSelectedLocationId] = useState<string>(currentPos?.locationId || gameState.map.activeLocationId || '');

  const [editingCard, setEditingCard] = useState<{ card: Card, source: 'deck' | 'pool' } | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'attributes' | 'deck' | 'inventory' | 'brain'>('basic');
  const [showInitialState, setShowInitialState] = useState(false);
  const [confirmDeleteSkillId, setConfirmDeleteSkillId] = useState<string | null>(null);

  // Filter known locations for dropdown
  const knownLocations = (Object.values(gameState.map.locations) as MapLocation[]).filter(l => l.isKnown);

  // Attribute Management
  const updateAttr = (key: string, field: keyof GameAttribute, val: any) => {
      setChar(prev => ({
          ...prev,
          attributes: {
              ...prev.attributes,
              [key]: { ...prev.attributes[key], [field]: val }
          }
      }));
  };

  const addAttribute = () => {
      const id = `attr_${Date.now()}`;
      setChar(prev => ({
          ...prev,
          attributes: {
              ...prev.attributes,
              [id]: { id, name: '新属性', type: AttributeType.NUMBER, value: 0, visibility: AttributeVisibility.PUBLIC }
          }
      }));
  };

  const removeAttribute = (key: string) => {
      const cores = ['cp', 'health', 'physique', 'pleasure', 'energy'];
      if (cores.includes(key)) {
          alert("核心属性无法删除");
          return;
      }
      const newAttrs = { ...char.attributes };
      delete newAttrs[key];
      setChar(prev => ({ ...prev, attributes: newAttrs }));
  };

  // Drive Management
  const addDrive = () => {
      setChar(prev => ({
          ...prev,
          drives: [...(prev.drives || []), { id: `drive_${Date.now()}`, condition: '', amount: 10, weight: 50 }]
      }));
  };
  
  const updateDrive = (index: number, field: keyof Drive, val: any) => {
      const newDrives = [...(char.drives || [])];
      newDrives[index] = { ...newDrives[index], [field]: val };
      setChar(prev => ({ ...prev, drives: newDrives }));
  };

  const removeDrive = (index: number) => {
      setChar(prev => ({ ...prev, drives: (prev.drives || []).filter((_, i) => i !== index) }));
  };

  // Conflict Management - Use Global Sequential ID
  const addConflict = () => {
      let maxId = 0;
      // Scan all existing characters for conflicts to find max ID
      (Object.values(gameState.characters) as Character[]).forEach(c => {
          c.conflicts?.forEach(x => {
              const n = parseInt(x.id);
              if(!isNaN(n) && n > maxId) maxId = n;
          });
      });
      // Also scan current edited character's conflicts in state
      char.conflicts?.forEach(x => {
          const n = parseInt(x.id);
          if(!isNaN(n) && n > maxId) maxId = n;
      });

      setChar(prev => ({
          ...prev,
          conflicts: [...(prev.conflicts || []), { id: String(maxId + 1), desc: '', apReward: 5, solved: false }]
      }));
  };

  const updateConflict = (index: number, field: keyof Conflict, val: any) => {
      const newConf = [...(char.conflicts || [])];
      newConf[index] = { ...newConf[index], [field]: val };
      setChar(prev => ({ ...prev, conflicts: newConf }));
  };

  const removeConflict = (index: number) => {
      setChar(prev => ({ ...prev, conflicts: (prev.conflicts || []).filter((_, i) => i !== index) }));
  };

  // Context Management (New)
  const addContextMsg = () => {
      setChar(prev => ({
          ...prev,
          contextConfig: {
              ...prev.contextConfig,
              messages: [...(prev.contextConfig?.messages || []), { role: 'system', content: '' }]
          }
      }));
  };

  const updateContextMsg = (index: number, field: keyof GlobalContextMessage, val: string) => {
      setChar(prev => {
          const newMsgs = [...(prev.contextConfig?.messages || [])];
          newMsgs[index] = { ...newMsgs[index], [field]: val };
          return {
              ...prev,
              contextConfig: { ...prev.contextConfig, messages: newMsgs }
          };
      });
  };

  const removeContextMsg = (index: number) => {
      setChar(prev => ({
          ...prev,
          contextConfig: {
              ...prev.contextConfig,
              messages: (prev.contextConfig?.messages || []).filter((_, i) => i !== index)
          }
      }));
  };

  // Card Management
  const handleCardSave = (updatedCard: Card) => {
      if (editingCard?.source === 'deck') {
          setChar(prev => ({
              ...prev,
              skills: prev.skills.map(c => c.id === updatedCard.id ? updatedCard : c)
          }));
      } else {
          // It's from pool, update in pool directly via parent callback if provided
          if (onUpdatePoolCard) onUpdatePoolCard(updatedCard);
      }
      setEditingCard(null);
  };

  const addSkill = () => {
      const newCard: Card = {
          id: `skill_${Date.now()}`,
          name: '新技能',
          description: '',
          itemType: 'skill',
          triggerType: 'active',
          cost: 0,
          effects: []
      };
      setChar(prev => ({ ...prev, skills: [...prev.skills, newCard] }));
      setEditingCard({ card: newCard, source: 'deck' });
  };

  const removeSkill = (id: string) => {
      if (confirmDeleteSkillId === id) {
          setChar(prev => ({ ...prev, skills: prev.skills.filter(c => c.id !== id) }));
          setConfirmDeleteSkillId(null);
      } else {
          setConfirmDeleteSkillId(id);
          setTimeout(() => setConfirmDeleteSkillId(null), 3000);
      }
  };

  // Generate Random Avatar
  const refreshAvatar = () => {
      const newUrl = generateRandomFlagAvatar();
      setChar(prev => ({ ...prev, avatarUrl: newUrl }));
  };

  // Helper to get a special attribute safely
  const getAttrValue = (key: string) => {
      const attr = char.attributes[key];
      return attr ? attr.value : 0;
  };

  // Render
  return (
    <div className={`w-full h-full bg-slate-900 border border-slate-700 rounded-lg flex flex-col ${!isTemplate ? 'fixed inset-0 z-50' : ''}`}>
        {editingCard && (
            <CardEditor 
                initialCard={editingCard.card}
                onClose={() => setEditingCard(null)}
                onSave={handleCardSave}
                gameState={gameState}
            />
        )}

        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-lg shrink-0">
            <div className="flex items-center gap-4">
                <h2 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                    <User size={20}/> {isTemplate ? '编辑角色模版' : '角色编辑器'}
                </h2>
                <div className="flex bg-slate-900 rounded p-1 border border-slate-800">
                    <button onClick={() => setActiveTab('basic')} className={`px-3 py-1 text-xs rounded ${activeTab === 'basic' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>基本信息</button>
                    <button onClick={() => setActiveTab('attributes')} className={`px-3 py-1 text-xs rounded ${activeTab === 'attributes' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>属性状态</button>
                    <button onClick={() => setActiveTab('deck')} className={`px-3 py-1 text-xs rounded ${activeTab === 'deck' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>固有能力</button>
                    <button onClick={() => setActiveTab('inventory')} className={`px-3 py-1 text-xs rounded ${activeTab === 'inventory' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>背包物品</button>
                    <button onClick={() => setActiveTab('brain')} className={`px-3 py-1 text-xs rounded ${activeTab === 'brain' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>AI 大脑</button>
                </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-900/95">
            
            {/* BASIC TAB */}
            {activeTab === 'basic' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="flex flex-col items-center gap-4">
                        <div className="flex items-start gap-2 w-full justify-center">
                            <ImageUploader value={char.avatarUrl || ''} onChange={url => setChar({...char, avatarUrl: url})} />
                            <Button 
                                size="sm" 
                                variant="secondary" 
                                onClick={refreshAvatar} 
                                title="随机生成旗帜头像"
                                className="h-8 w-8 p-0 flex items-center justify-center"
                            >
                                <Dices size={16} />
                            </Button>
                        </div>
                        <div className="text-xs text-slate-500 text-center">点击头像上传/绘制，或随机生成</div>
                        
                        <div className="w-full border-t border-slate-800 pt-4 mt-2 space-y-2">
                            <label className="flex items-center gap-2 p-2 rounded bg-slate-950 border border-slate-800 cursor-pointer hover:border-indigo-500">
                                <input type="checkbox" checked={char.isPlayer} onChange={e => setChar({...char, isPlayer: e.target.checked})} />
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-indigo-400">玩家角色 (PC)</div>
                                    <div className="text-[10px] text-slate-500">由玩家手动操控</div>
                                </div>
                                <User size={16} className={char.isPlayer ? "text-indigo-500" : "text-slate-600"}/>
                            </label>

                            <label className="flex items-center gap-2 p-2 rounded bg-slate-950 border border-slate-800 cursor-pointer hover:border-teal-500">
                                <input type="checkbox" checked={char.isFollowing || false} onChange={e => setChar({...char, isFollowing: e.target.checked})} />
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-teal-400">跟随模式 (Follow)</div>
                                    <div className="text-[10px] text-slate-500">随玩家移动到新地点</div>
                                </div>
                                <Footprints size={16} className={char.isFollowing ? "text-teal-500" : "text-slate-600"}/>
                            </label>
                        </div>
                    </div>
                    <div className="md:col-span-2 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>姓名</Label>
                                <Input value={char.name} onChange={e => setChar({...char, name: e.target.value})} />
                            </div>
                            {!isTemplate && (
                                <div>
                                    <Label>当前位置 (传送)</Label>
                                    <select 
                                        className="w-full h-10 bg-gray-950 border border-slate-700 rounded px-3 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                                        value={selectedLocationId}
                                        onChange={e => setSelectedLocationId(e.target.value)}
                                    >
                                        <option value="">(未知/虚空)</option>
                                        {knownLocations.map(l => (
                                            <option key={l.id} value={l.id}>{l.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                        
                        {/* New Appearance Field - RESIZED */}
                        <div className="flex flex-col flex-1">
                            <Label className="flex items-center gap-1 text-teal-400"><VenetianMask size={12}/> 外观描述 (公开可见)</Label>
                            <TextArea 
                                rows={6}
                                value={char.appearance || ""}
                                onChange={e => setChar({...char, appearance: e.target.value})}
                                placeholder="描述角色的外貌特征，如身高、体型、衣着、配饰等。场景中所有人可见。"
                                className="border-teal-500/30 bg-teal-900/10 min-h-[8rem] resize-y"
                            />
                        </div>

                        <div>
                            <Label>人设描述 / 个人传记 (私密)</Label>
                            <TextArea 
                                rows={6} 
                                value={char.description} 
                                onChange={e => setChar({...char, description: e.target.value})}
                                placeholder="描述角色的性格、背景故事、私人秘密以及行为逻辑..."
                            />
                        </div>
                        
                        {/* Pleasure Attribute Prominently Displayed */}
                        <div className="bg-pink-900/10 border border-pink-900/30 p-3 rounded flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Heart size={18} className="text-pink-500" fill="currentColor"/>
                                <div>
                                    <div className="text-sm font-bold text-pink-400">快感 (Pleasure)</div>
                                    <div className="text-[10px] text-pink-300/70">驱动角色行为的核心动力</div>
                                </div>
                            </div>
                            <Input 
                                type="number" 
                                className="w-24 text-center font-bold text-pink-400 border-pink-900/50"
                                value={getAttrValue('快感') || getAttrValue('pleasure')}
                                onChange={e => {
                                    // Update logic to handle key existence
                                    const key = char.attributes['快感'] ? '快感' : 'pleasure';
                                    if (char.attributes[key]) {
                                        updateAttr(key, 'value', parseFloat(e.target.value));
                                    } else {
                                        // Create if missing
                                        setChar(prev => ({
                                            ...prev,
                                            attributes: {
                                                ...prev.attributes,
                                                '快感': { id: '快感', name: '快感', type: AttributeType.NUMBER, value: parseFloat(e.target.value), visibility: AttributeVisibility.PUBLIC }
                                            }
                                        }));
                                    }
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* ATTRIBUTES TAB */}
            {activeTab === 'attributes' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">核心属性与状态</span>
                        <Button size="sm" variant="secondary" onClick={addAttribute}><Plus size={14} className="mr-1"/> 添加属性</Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {(Object.values(char.attributes) as GameAttribute[])
                            .filter(attr => attr.name !== '快感' && attr.name !== 'pleasure') // Hide Pleasure here as it's on Basic tab
                            .map((attr) => (
                            <div key={attr.id} className="bg-slate-950 p-3 rounded border border-slate-800 flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                    <Input 
                                        className="h-7 text-xs w-24 border-transparent bg-transparent font-bold text-indigo-300 p-0" 
                                        value={attr.name} 
                                        onChange={e => updateAttr(attr.id, 'name', e.target.value)}
                                    />
                                    <div className="flex gap-1">
                                        <button 
                                            onClick={() => updateAttr(attr.id, 'visibility', attr.visibility === AttributeVisibility.PUBLIC ? AttributeVisibility.PRIVATE : AttributeVisibility.PUBLIC)}
                                            className="text-slate-500 hover:text-white p-1"
                                            title={attr.visibility === AttributeVisibility.PUBLIC ? "公开" : "隐藏"}
                                        >
                                            {attr.visibility === AttributeVisibility.PUBLIC ? <Eye size={14}/> : <EyeOff size={14}/>}
                                        </button>
                                        <button onClick={() => removeAttribute(attr.id)} className="text-slate-500 hover:text-red-400 p-1"><Trash size={14}/></button>
                                    </div>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <Input 
                                        className="h-8 text-sm" 
                                        value={attr.value} 
                                        onChange={e => updateAttr(attr.id, 'value', attr.type === AttributeType.NUMBER ? parseFloat(e.target.value) : e.target.value)}
                                        type={attr.type === AttributeType.NUMBER ? "number" : "text"}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* DECK TAB */}
            {activeTab === 'deck' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">固有技能与能力 (Deck)</span>
                        <Button size="sm" variant="secondary" onClick={addSkill}><Plus size={14} className="mr-1"/> 新建技能</Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {char.skills.map(skill => (
                            <div key={skill.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 relative group hover:border-indigo-500 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-sm text-slate-200 truncate">{skill.name}</h4>
                                    <div className="flex gap-1">
                                        <button onClick={() => setEditingCard({ card: skill, source: 'deck' })} className="text-slate-500 hover:text-white"><Edit size={14}/></button>
                                        <button onClick={() => removeSkill(skill.id)} className={confirmDeleteSkillId === skill.id ? "text-red-500" : "text-slate-500 hover:text-red-400"}>
                                            <Trash size={14}/>
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-slate-500 line-clamp-3 h-10">{skill.description}</p>
                                <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-400">
                                    <span>{skill.triggerType}</span>
                                    <span className="text-yellow-500">{skill.cost} CP</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* INVENTORY TAB */}
            {activeTab === 'inventory' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">背包物品 (Inventory References)</span>
                        <span className="text-[10px] text-slate-600">物品定义在公共卡池中，此处仅存储引用。</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {char.inventory.map(itemId => {
                            const item = gameState.cardPool.find(c => c.id === itemId);
                            if (!item) return null;
                            return (
                                <div key={itemId} className="bg-slate-950 border border-slate-800 rounded-lg p-3 relative group hover:border-blue-500 transition-colors">
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-sm text-slate-200 truncate">{item.name}</h4>
                                        <div className="flex gap-1">
                                             <button 
                                                onClick={() => setEditingCard({ card: item, source: 'pool' })} 
                                                className="text-slate-500 hover:text-white"
                                                title="编辑公共卡牌定义"
                                             >
                                                <Edit size={14}/>
                                             </button>
                                             <button 
                                                onClick={() => setChar(prev => ({...prev, inventory: prev.inventory.filter(id => id !== itemId)}))}
                                                className="text-slate-500 hover:text-red-400"
                                                title="从背包移除"
                                             >
                                                <Trash size={14}/>
                                             </button>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-slate-500 line-clamp-2">{item.description}</p>
                                </div>
                            );
                        })}
                        {char.inventory.length === 0 && (
                            <div className="col-span-full text-center py-10 text-slate-600 border-2 border-dashed border-slate-800 rounded">
                                背包空空如也。请在卡池中将物品分配给角色。
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* BRAIN TAB */}
            {activeTab === 'brain' && (
                <div className="space-y-6">
                    {/* AI Config */}
                    <div className="bg-slate-950 p-4 rounded border border-slate-800">
                        <h3 className="text-xs font-bold text-indigo-400 uppercase mb-4 flex items-center gap-2">
                            <Cpu size={14}/> AI 模型配置 (Model Override)
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <Label>Provider</Label>
                                <select 
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-slate-200"
                                    value={char.aiConfig?.provider}
                                    onChange={e => setChar({...char, aiConfig: { ...char.aiConfig, provider: e.target.value as Provider }})}
                                >
                                    <option value={Provider.XAI}>xAI (Grok)</option>
                                    <option value={Provider.GEMINI}>Google Gemini</option>
                                    <option value={Provider.VOLCANO}>Volcengine</option>
                                    <option value={Provider.OPENROUTER}>OpenRouter</option>
                                    <option value={Provider.OPENAI}>OpenAI</option>
                                    <option value={Provider.CLAUDE}>Anthropic (Claude)</option>
                                </select>
                            </div>
                            <div>
                                <Label>Model Name</Label>
                                <Input 
                                    value={char.aiConfig?.model || ''} 
                                    onChange={e => setChar({...char, aiConfig: { ...char.aiConfig!, model: e.target.value }})}
                                    placeholder="Inherit Global if empty"
                                />
                            </div>
                            <div>
                                <Label>Temperature</Label>
                                <Input 
                                    type="number" step="0.1"
                                    value={char.aiConfig?.temperature ?? 1.0} 
                                    onChange={e => setChar({...char, aiConfig: { ...char.aiConfig!, temperature: parseFloat(e.target.value) }})}
                                />
                            </div>
                            <div>
                                <Label>API Key (Optional Override)</Label>
                                <Input 
                                    type="password"
                                    value={char.aiConfig?.apiKey || ''} 
                                    onChange={e => setChar({...char, aiConfig: { ...char.aiConfig!, apiKey: e.target.value }})}
                                    placeholder="Leave empty to use global key"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Drives (Pleasure Sources) */}
                    <div className="bg-slate-950 p-4 rounded border border-slate-800">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-pink-500 uppercase flex items-center gap-2">
                                <Heart size={14}/> 驱力 / 快感获取 (Drives & Pleasure)
                            </h3>
                            <Button size="sm" variant="secondary" onClick={addDrive}><Plus size={12}/></Button>
                        </div>
                        <div className="space-y-2">
                            {(char.drives || []).map((drv, idx) => (
                                <div key={drv.id} className="flex gap-2 items-center">
                                    <Input 
                                        className="flex-1 text-xs" 
                                        value={drv.condition} 
                                        onChange={e => updateDrive(idx, 'condition', e.target.value)}
                                        placeholder="条件描述 (如: 探索未知)"
                                    />
                                    <div className="flex items-center gap-1 w-20">
                                        <span className="text-xs text-slate-500">奖励:</span>
                                        <Input 
                                            type="number" className="w-10 text-xs border-pink-900/50 focus:border-pink-500" 
                                            value={drv.amount} 
                                            onChange={e => updateDrive(idx, 'amount', parseInt(e.target.value))}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1 w-20" title="权重 (决定被选中概率)">
                                        <span className="text-xs text-slate-500">权重:</span>
                                        <Input 
                                            type="number" className="w-10 text-xs border-slate-700 focus:border-indigo-500" 
                                            value={drv.weight || 50} 
                                            onChange={e => updateDrive(idx, 'weight', parseInt(e.target.value))}
                                        />
                                    </div>
                                    <button onClick={() => removeDrive(idx)} className="text-slate-500 hover:text-red-400"><Trash size={14}/></button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Conflicts */}
                    <div className="bg-slate-950 p-4 rounded border border-slate-800">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-orange-500 uppercase flex items-center gap-2">
                                <AlertTriangle size={14}/> 内在与外在矛盾 (Conflicts)
                            </h3>
                            <Button size="sm" variant="secondary" onClick={addConflict}><Plus size={12}/></Button>
                        </div>
                        <div className="space-y-2">
                            {(char.conflicts || []).map((conf, idx) => (
                                <div key={conf.id} className={`flex gap-2 items-start p-2 rounded border ${conf.solved ? 'border-green-900/30 bg-green-900/10 opacity-50' : 'border-orange-900/30 bg-orange-900/10'}`}>
                                    <div className="text-[10px] font-mono text-slate-500 pt-2 w-6">#{conf.id}</div>
                                    <div className="flex-1 space-y-1">
                                        <TextArea 
                                            className="w-full h-10 text-xs resize-none bg-transparent border-slate-700" 
                                            value={conf.desc} 
                                            onChange={e => updateConflict(idx, 'desc', e.target.value)}
                                            placeholder="矛盾描述"
                                        />
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                                <span>奖励(CP/AP):</span>
                                                <Input 
                                                    type="number" className="w-12 h-6 text-[10px]" 
                                                    value={conf.apReward} 
                                                    onChange={e => updateConflict(idx, 'apReward', parseInt(e.target.value))}
                                                />
                                            </div>
                                            <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                                                <input 
                                                    type="checkbox" 
                                                    checked={conf.solved} 
                                                    onChange={e => updateConflict(idx, 'solved', e.target.checked)}
                                                /> 已解决
                                            </label>
                                        </div>
                                    </div>
                                    <button onClick={() => removeConflict(idx)} className="text-slate-500 hover:text-red-400 pt-2"><Trash size={14}/></button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Context Engineering */}
                    <div className="bg-slate-950 p-4 rounded border border-slate-800">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-blue-400 uppercase flex items-center gap-2">
                                <MessageSquare size={14}/> 角色专属上下文 (Context Engineering)
                            </h3>
                            <Button size="sm" variant="secondary" onClick={addContextMsg}><Plus size={12}/></Button>
                        </div>
                        <div className="space-y-3">
                            {(char.contextConfig?.messages || []).map((msg, idx) => (
                                <div key={idx} className="bg-slate-900 p-2 rounded border border-slate-800 flex flex-col gap-2">
                                    <div className="flex justify-between items-center">
                                        <select
                                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                                            value={msg.role}
                                            onChange={e => updateContextMsg(idx, 'role', e.target.value as any)}
                                        >
                                            <option value="system">System</option>
                                            <option value="user">User</option>
                                            <option value="model">Assistant (Model)</option>
                                        </select>
                                        <button onClick={() => removeContextMsg(idx)} className="text-slate-500 hover:text-red-400"><Trash size={14}/></button>
                                    </div>
                                    <TextArea
                                        className="w-full min-h-[80px] text-xs font-mono resize-y bg-black/20 border-slate-700"
                                        value={msg.content}
                                        onChange={e => updateContextMsg(idx, 'content', e.target.value)}
                                        placeholder="输入上下文内容..."
                                    />
                                </div>
                            ))}
                            {(char.contextConfig?.messages || []).length === 0 && (
                                <div className="text-center text-slate-600 text-xs italic py-4">暂无自定义上下文。点击右上角添加。</div>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">
                            此处定义的消息将作为"长期记忆"或"系统指令"在每次请求时发送给AI。
                        </p>
                    </div>

                    {/* Memory Viewer (Restored) */}
                    {!isTemplate && (
                        <div className="bg-slate-950 p-4 rounded border border-slate-800">
                             <h3 className="text-xs font-bold text-teal-400 uppercase mb-4 flex items-center gap-2">
                                <BrainCircuit size={14}/> 角色记忆查看 (Memory Dump)
                            </h3>
                            <TextArea 
                                readOnly
                                className="w-full h-48 font-mono text-xs text-slate-400 bg-black/20 border-slate-800 resize-none"
                                value={getCharacterMemory(gameState.world.history, char.id, gameState.map.activeLocationId, gameState.appSettings.maxCharacterMemoryRounds)}
                                placeholder="暂无记忆..."
                            />
                            <p className="text-[10px] text-slate-500 mt-2">
                                这是系统自动提取的、发送给AI作为该角色记忆的历史片段。
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900 rounded-b-lg flex justify-between items-center shrink-0">
            {/* Left side actions */}
            <div className="flex gap-2">
               {activeTab === 'attributes' && (
                   <Button size="sm" variant="secondary" onClick={() => {
                       if(confirm("确定恢复初始值？")) setChar(getInitialState());
                   }}>重置</Button>
               )}
            </div>

            {/* Right side actions */}
            <div className="flex gap-2">
                <Button variant="secondary" onClick={onClose}>取消</Button>
                <Button onClick={() => onSave(char, selectedLocationId)} className="px-6 font-bold">
                    <Save size={16} className="mr-2"/> 保存角色
                </Button>
            </div>
        </div>
    </div>
  );
};
