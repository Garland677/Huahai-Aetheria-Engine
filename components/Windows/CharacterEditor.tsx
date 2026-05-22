
import React, { useState, useEffect } from 'react';
import { Character, Provider, AttributeType, Card, GameState, GameAttribute, AttributeVisibility, Drive, MapLocation, Conflict, GameImage, Secret, WindowState } from '../../types';
import { Button, Input, Label, TextArea } from '../ui/Button';
import { Save, BrainCircuit, Plus, Edit, Trash, Eye, EyeOff, Coins, Cpu, User, AlertTriangle, Footprints, Dices, MessageSquare, Heart, VenetianMask, Info, Activity, Layers, Package, Upload, RefreshCw, Eraser, Settings2, Globe, TrendingUp, History, CheckCircle, Lock, Unlock, BookOpen, ChevronRight, FileClock, Briefcase } from 'lucide-react';
import { CardEditor } from './CardEditor';
import { generateRandomFlagAvatar } from '../../assets/imageLibrary';
import { getAllCharacterLogs } from '../../services/ai/memoryUtils';
import { defaultAcquireCard, defaultInteractCard, defaultTradeCard } from '../../services/DefaultSettings';
import { ContextEditorModal } from './Settings/ContextEditorModal';
import { Window } from '../ui/Window';
import { ImageAttachmentList } from '../ui/ImageAttachmentList';
import { ImageUploadModal } from '../Modals/ImageUploadModal';
import { generateCharacterId, generateConflictId, generateDriveId, generateCardId } from '../../services/idUtils';

interface CharacterEditorProps {
  character?: Character; // Or Partial with special config
  onSave: (char: Character, locationId?: string) => void; 
  onClose: () => void;
  gameState: GameState; 
  onUpdatePoolCard?: (card: Card) => void; 
  isTemplate?: boolean;
  openWindow?: (type: WindowState['type'], data?: any) => void;
}

export const CharacterEditor: React.FC<CharacterEditorProps> = ({ character, onSave, onClose, gameState, onUpdatePoolCard, isTemplate = false, openWindow }) => {
  
  const getInitialState = (): Character => {
      if (character && character.id) return character;
      
      const tmpl = JSON.parse(JSON.stringify(gameState.defaultSettings.templates.character));
      
      // Use standardized ID generation
      tmpl.id = generateCharacterId(gameState.characters);
      
      if (!tmpl.avatarUrl) {
          tmpl.avatarUrl = generateRandomFlagAvatar();
      }
      
      if (tmpl.attributes.cp) {
          tmpl.attributes.cp.value = gameState.defaultSettings.gameplay.defaultInitialCP;
      }
      
      // Default to FALSE for overrides on new characters
      tmpl.useAiOverride = false;
      tmpl.memoryConfig = {
          useOverride: false,
          maxMemoryRounds: gameState.appSettings.maxCharacterMemoryRounds || 10,
          actionDropoutProbability: gameState.appSettings.actionMemoryDropoutProbability || 0.34,
          reactionDropoutProbability: gameState.appSettings.reactionMemoryDropoutProbability || 0.34
      };

      // Ensure AI config structure exists even if disabled, populated with global defaults for reference
      tmpl.aiConfig = gameState.charBehaviorConfig || gameState.judgeConfig || {
          provider: Provider.XAI,
          model: 'grok-4-1-fast-reasoning',
          temperature: 1.0
      };

      if (!tmpl.skills) tmpl.skills = [];
      const currentSkillIds = new Set(tmpl.skills.map((s: Card) => s.id));
      
      if (!currentSkillIds.has(defaultAcquireCard.id)) tmpl.skills.push(defaultAcquireCard);
      if (!currentSkillIds.has(defaultTradeCard.id)) tmpl.skills.push(defaultTradeCard);
      if (!currentSkillIds.has(defaultInteractCard.id)) tmpl.skills.push(defaultInteractCard);
      
      return tmpl;
  };

  const [char, setChar] = useState<Character>(getInitialState());

  // Effect to sync external character prop changes (if any)
  useEffect(() => {
      if (character && character.id && character.id === char.id) {
          // If character prop updates from outside, we might want to sync
          // But usually this component manages local state until save.
          // Skipping deep sync for now to avoid overwriting local edits.
      }
  }, [character]);

  // Determine initial location logic
  const currentPos = gameState.map.charPositions[char.id];
  const passedInitialLoc = (character as any)?.initialLocationId;
  const initialLocId = currentPos?.locationId || passedInitialLoc || gameState.map.activeLocationId || '';

  const [selectedLocationId, setSelectedLocationId] = useState<string>(initialLocId);

  const [editingCard, setEditingCard] = useState<{ card: Card, source: 'deck' | 'pool' } | null>(null);
  const [activeTab, setActiveTab] = useState<'basic' | 'attributes' | 'deck' | 'inventory' | 'brain'>('basic');
  const [confirmDeleteSkillId, setConfirmDeleteSkillId] = useState<string | null>(null);

  const [showContextModal, setShowContextModal] = useState(false);
  const [showConflictHistory, setShowConflictHistory] = useState(false);
  const [showSecretsModal, setShowSecretsModal] = useState(false);
  
  // Image Upload State - Extended to include 'avatar'
  const [showImageUpload, setShowImageUpload] = useState<{ target: 'appearance' | 'description' | 'avatar' } | null>(null);
  const [editingImage, setEditingImage] = useState<{ target: 'appearance' | 'description', image: GameImage } | null>(null);

  const knownLocations = (Object.values(gameState.map.locations) as MapLocation[]).filter(l => l.isKnown);

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
      // Enhanced protection for core attributes including Chinese keys
      const cores = ['cp', 'health', 'physique', 'pleasure', 'energy', 'active', '健康', '体能', '快感', '能量', '创造点', '活跃'];
      if (cores.includes(key) || cores.includes(key.toLowerCase())) {
          alert("核心属性无法删除");
          return;
      }
      const newAttrs = { ...char.attributes };
      delete newAttrs[key];
      setChar(prev => ({ ...prev, attributes: newAttrs }));
  };

  const addDrive = () => {
      setChar(prev => ({
          ...prev,
          drives: [...(prev.drives || []), { id: generateDriveId(prev.drives || []), condition: '', amount: 10, weight: 50 }]
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

  const addConflict = () => {
      setChar(prev => ({
          ...prev,
          conflicts: [...(prev.conflicts || []), { id: generateConflictId(prev.conflicts || []), desc: '', apReward: 5, solved: false }]
      }));
  };

  // Find index in main array by ID to update correctly even when filtered
  const updateConflictById = (id: string, field: keyof Conflict, val: any) => {
      const idx = (char.conflicts || []).findIndex(c => c.id === id);
      if (idx === -1) return;
      
      const newConf = [...(char.conflicts || [])];
      newConf[idx] = { ...newConf[idx], [field]: val };
      setChar(prev => ({ ...prev, conflicts: newConf }));
  };

  const removeConflictById = (id: string) => {
      setChar(prev => ({ ...prev, conflicts: (prev.conflicts || []).filter(c => c.id !== id) }));
  };

  const removeSecretById = (id: string) => {
      setChar(prev => ({ ...prev, secrets: (prev.secrets || []).filter(s => s.id !== id) }));
  };

  const updateSecretById = (id: string, field: keyof Secret, val: any) => {
      const idx = (char.secrets || []).findIndex(s => s.id === id);
      if (idx === -1) return;
      
      const newSecrets = [...(char.secrets || [])];
      newSecrets[idx] = { ...newSecrets[idx], [field]: val };
      setChar(prev => ({ ...prev, secrets: newSecrets }));
  };

  const handleCardSave = (updatedCard: Card) => {
      if (editingCard?.source === 'deck') {
          setChar(prev => ({
              ...prev,
              skills: prev.skills.map(c => c.id === updatedCard.id ? updatedCard : c)
          }));
      } else {
          if (onUpdatePoolCard) onUpdatePoolCard(updatedCard);
      }
      setEditingCard(null);
  };

  const addSkill = () => {
      // Use standard card ID generator against card pool to ensure uniqueness
      const newCard: Card = {
          id: generateCardId(gameState.cardPool),
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

  const refreshAvatar = () => {
      const newUrl = generateRandomFlagAvatar();
      setChar(prev => ({ ...prev, avatarUrl: newUrl }));
  };

  const getAttrValue = (key: string) => {
      const attr = char.attributes[key];
      return attr ? attr.value : 0;
  };

  const handleReadRawMemory = () => {
        if (!openWindow) return;
        
        // Get full RAW logs for editor view (No decay)
        const memoryLogs = getAllCharacterLogs(
            gameState.world.history, 
            char.id
        );

        openWindow('reading_mode', {
            title: `角色原始记忆: ${char.name}`,
            content: memoryLogs, // Pass LogEntry[] array for nice rendering
            type: 'history' // Use history renderer
        });
    };
    
  const handleReadLegacyMemory = () => {
      if (!openWindow) return;
      if (!char.previousLifeLogs || char.previousLifeLogs.length === 0) {
          alert("该角色暂无前世记忆。");
          return;
      }
      
      openWindow('reading_mode', {
          title: `[前世] ${char.name} 的旧日记忆`,
          content: char.previousLifeLogs, // Pass LogEntry[]
          type: 'history'
      });
  };

  // Image Handling Helpers
  const handleAddOrUpdateImage = (image: GameImage) => {
      const target = showImageUpload?.target || editingImage?.target;
      if (!target) return;

      if (target === 'avatar') {
          // Special handling for avatar update
          setChar(prev => ({ ...prev, avatarUrl: image.base64 }));
      } else if (target === 'appearance') {
          setChar(prev => {
              const currentList = prev.appearanceImages || [];
              const exists = currentList.some(img => img.id === image.id);
              if (exists) {
                  return { ...prev, appearanceImages: currentList.map(img => img.id === image.id ? image : img) };
              }
              return { ...prev, appearanceImages: [...currentList, image] };
          });
      } else {
          setChar(prev => {
              const currentList = prev.descriptionImages || [];
              const exists = currentList.some(img => img.id === image.id);
              if (exists) {
                  return { ...prev, descriptionImages: currentList.map(img => img.id === image.id ? image : img) };
              }
              return { ...prev, descriptionImages: [...currentList, image] };
          });
      }
      setShowImageUpload(null);
      setEditingImage(null);
  };

  const handleRemoveImage = (target: 'appearance' | 'description', id: string) => {
      if (target === 'appearance') {
          setChar(prev => ({
              ...prev,
              appearanceImages: (prev.appearanceImages || []).filter(img => img.id !== id)
          }));
      } else {
          setChar(prev => ({
              ...prev,
              descriptionImages: (prev.descriptionImages || []).filter(img => img.id !== id)
          }));
      }
  };

  const openImageEditor = (target: 'appearance' | 'description', image: GameImage) => {
      setEditingImage({ target, image });
  };
  
  // Life Trajectory Helper
  const lifeTrajectory = char.lifeTrajectory || { past: "", current: "", future: "" };

  // Filter Conflicts
  const activeConflicts = (char.conflicts || []).filter(c => !c.solved);
  const solvedConflicts = (char.conflicts || []).filter(c => c.solved);

  const TabButton = ({ id, label, icon: Icon }: { id: typeof activeTab, label: string, icon: any }) => (
      <button 
          onClick={() => setActiveTab(id)} 
          className={`px-3 py-1.5 rounded transition-colors flex items-center justify-center gap-1.5 ${activeTab === id ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-surface-highlight hover:text-body'}`}
          title={label}
      >
          <Icon size={14}/>
          <span className="hidden sm:inline text-xs font-bold">{label}</span>
      </button>
  );

  // Helper for safe number input
  const handleNumericInput = (val: string, callback: (v: number | string) => void) => {
      if (val === '' || val === '-' || val.endsWith('.') || (val.includes('.') && val.endsWith('0'))) {
          callback(val);
      } else {
          const num = parseFloat(val);
          callback(isNaN(num) ? val : num);
      }
  };

  return (
    <Window
        title={isTemplate ? '编辑角色模版' : '角色编辑器'}
        icon={<User size={20}/>}
        onClose={onClose}
        isOverlay={!isTemplate}
        maxWidth="max-w-4xl"
        height="max-h-[95vh] h-full"
        className={isTemplate ? "h-full border-none shadow-none" : ""}
        headerActions={
            <div className="flex bg-surface rounded p-1 border border-border overflow-x-auto scrollbar-hide max-w-[200px] sm:max-w-none">
                <TabButton id="basic" label="信息" icon={Info} />
                <TabButton id="attributes" label="属性" icon={Activity} />
                <TabButton id="deck" label="能力" icon={Layers} />
                <TabButton id="inventory" label="物品" icon={Package} />
                <TabButton id="brain" label="大脑" icon={BrainCircuit} />
            </div>
        }
        footer={
            <div className="flex justify-between w-full items-center">
                <div className="flex gap-2">
                   {activeTab === 'attributes' && (
                       <Button size="sm" variant="secondary" onClick={() => {
                           if(confirm("确定恢复初始值？")) setChar(getInitialState());
                       }}>重置</Button>
                   )}
                </div>

                <div className="flex gap-2">
                    <Button variant="secondary" onClick={onClose}>取消</Button>
                    <Button onClick={() => onSave(char, selectedLocationId)} className="px-6 font-bold">
                        <Save size={16} className="mr-2"/> 保存
                    </Button>
                </div>
            </div>
        }
    >
        {/* ... (rest of render code unchanged) ... */}
        {editingCard && (
            <CardEditor 
                initialCard={editingCard.card}
                onClose={() => setEditingCard(null)}
                onSave={handleCardSave}
                gameState={gameState}
            />
        )}

        {showContextModal && (
            <ContextEditorModal
                title={`虚拟空间: ${char.name}`}
                messages={char.contextConfig?.messages || []}
                onMessagesChange={(msgs) => setChar({...char, contextConfig: { ...char.contextConfig, messages: msgs }})}
                onClose={() => setShowContextModal(false)}
            />
        )}
        
        {/* Solved Conflicts History Modal */}
        {showConflictHistory && (
            <Window
                title={<span className="flex items-center gap-2"><History size={18}/> 历史矛盾 (已解决)</span>}
                onClose={() => setShowConflictHistory(false)}
                maxWidth="max-w-md"
                height="h-auto max-h-[70vh]"
                zIndex={200}
            >
                <div className="space-y-3 p-4">
                    {solvedConflicts.length === 0 ? (
                        <div className="text-center text-muted text-sm italic py-4">暂无已解决的历史矛盾。</div>
                    ) : (
                        solvedConflicts.map((conf) => (
                            <div key={conf.id} className="bg-surface-light border border-success/30 rounded p-3 opacity-80">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-muted font-mono">#{conf.id}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-success-fg font-mono text-[10px] flex items-center gap-1">
                                            <CheckCircle size={10}/> 已解决
                                        </span>
                                        <button 
                                            onClick={() => updateConflictById(conf.id, 'solved', false)} // Reopen
                                            className="text-muted hover:text-warning-fg underline text-[10px]"
                                        >
                                            重开
                                        </button>
                                        <button 
                                            onClick={() => removeConflictById(conf.id)} 
                                            className="text-muted hover:text-danger-fg"
                                        >
                                            <Trash size={12}/>
                                        </button>
                                    </div>
                                </div>
                                <div className="text-sm text-body line-through decoration-success-fg decoration-2">{conf.desc}</div>
                            </div>
                        ))
                    )}
                </div>
            </Window>
        )}

        {/* Secrets Modal */}
        {showSecretsModal && (
             <Window
                title={<span className="flex items-center gap-2"><Lock size={18}/> 角色秘密 (Secrets)</span>}
                onClose={() => setShowSecretsModal(false)}
                maxWidth="max-w-2xl"
                height="h-[70vh]"
                zIndex={200}
                noPadding={true}
             >
                 <div className="p-4 flex flex-col gap-4 bg-surface/30">
                     <p className="text-xs text-muted">这些秘密未解开前不会公开。解开后将自动转化为角色属性。</p>
                     
                     <div className="space-y-3">
                         {(char.secrets || []).length === 0 && <div className="text-center text-muted text-xs italic py-4">暂无秘密。</div>}
                         {(char.secrets || []).map((secret, idx) => (
                             <div key={secret.id} className="bg-surface p-3 rounded border border-border">
                                 <div className="flex justify-between items-center mb-2">
                                     <div className="flex items-center gap-2">
                                         {secret.solved ? <Unlock size={14} className="text-success-fg"/> : <Lock size={14} className="text-muted"/>}
                                         <span className={`text-xs font-bold ${secret.solved ? 'text-success-fg' : 'text-primary'}`}>秘密 #{idx+1}</span>
                                     </div>
                                     <button onClick={() => removeSecretById(secret.id)} className="text-muted hover:text-danger-fg"><Trash size={14}/></button>
                                 </div>
                                 <div className="grid grid-cols-2 gap-3 mb-2">
                                     <div>
                                         <Label>问题</Label>
                                         <Input 
                                             value={secret.question} 
                                             onChange={e => updateSecretById(secret.id, 'question', e.target.value)} 
                                             className="text-xs"
                                         />
                                     </div>
                                     <div>
                                         <Label>正确答案</Label>
                                         <Input 
                                             value={secret.correctAnswer} 
                                             onChange={e => updateSecretById(secret.id, 'correctAnswer', e.target.value)} 
                                             className="text-xs bg-success-base/10 border-success-base/30"
                                         />
                                     </div>
                                 </div>
                                 <div className="grid grid-cols-2 gap-3">
                                     <div>
                                         <Label>错误答案 A</Label>
                                         <Input 
                                             value={secret.wrongAnswerA} 
                                             onChange={e => updateSecretById(secret.id, 'wrongAnswerA', e.target.value)} 
                                             className="text-xs bg-danger-base/10 border-danger-base/30"
                                         />
                                     </div>
                                     <div>
                                         <Label>错误答案 B</Label>
                                         <Input 
                                             value={secret.wrongAnswerB} 
                                             onChange={e => updateSecretById(secret.id, 'wrongAnswerB', e.target.value)} 
                                             className="text-xs bg-danger-base/10 border-danger-base/30"
                                         />
                                     </div>
                                 </div>
                             </div>
                         ))}
                     </div>
                 </div>
             </Window>
        )}

        {(showImageUpload || editingImage) && (
            <ImageUploadModal 
                onClose={() => { setShowImageUpload(null); setEditingImage(null); }}
                onConfirm={handleAddOrUpdateImage}
                initialImage={editingImage?.image}
                initialUrl={showImageUpload?.target === 'avatar' ? char.avatarUrl : undefined}
            />
        )}

        <div className="h-full">
            {/* BASIC TAB */}
            {activeTab === 'basic' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full overflow-y-auto pr-2">
                    <div className="flex flex-col items-center gap-4 shrink-0">
                        {/* Avatar Area with New Upload Logic */}
                        <div className="flex items-start gap-2 w-full justify-center">
                            <div 
                                className="w-24 h-24 relative group cursor-pointer rounded-xl overflow-hidden border-2 border-border hover:border-primary transition-all shadow-md"
                                onClick={() => setShowImageUpload({ target: 'avatar' })}
                                title="点击更换头像"
                            >
                                {char.avatarUrl ? (
                                    <img src={char.avatarUrl} className="w-full h-full object-cover pixelated" style={{ imageRendering: 'pixelated' }} alt="Avatar"/>
                                ) : (
                                    <div className="w-full h-full bg-surface-highlight flex items-center justify-center text-muted">
                                        <User size={32}/>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs gap-1">
                                    <Upload size={16}/>
                                    <span>更换</span>
                                </div>
                            </div>
                            
                            <Button 
                                size="sm" 
                                variant="secondary" 
                                onClick={refreshAvatar} 
                                title="随机生成旗帜头像"
                                className="h-8 w-8 p-0 flex items-center justify-center mt-2"
                            >
                                <Dices size={16} />
                            </Button>
                        </div>
                        <div className="text-xs text-muted text-center">点击头像上传，或随机生成</div>
                        
                        <div className="w-full border-t border-border pt-4 mt-2 space-y-2">
                            <label className="flex items-center gap-2 p-2 rounded bg-surface-highlight border border-border cursor-pointer hover:border-primary">
                                <input type="checkbox" checked={char.isPlayer} onChange={e => setChar({...char, isPlayer: e.target.checked})} />
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-primary">玩家角色 (PC)</div>
                                    <div className="text-[10px] text-muted">由玩家手动操控</div>
                                </div>
                                <User size={16} className={char.isPlayer ? "text-primary" : "text-faint"}/>
                            </label>

                            <label className="flex items-center gap-2 p-2 rounded bg-surface-highlight border border-border cursor-pointer hover:border-secondary">
                                <input type="checkbox" checked={char.isFollowing || false} onChange={e => setChar({...char, isFollowing: e.target.checked})} />
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-secondary-fg">跟随模式 (Follow)</div>
                                    <div className="text-[10px] text-muted">随玩家移动到新地点</div>
                                </div>
                                <Footprints size={16} className={char.isFollowing ? "text-secondary-fg" : "text-faint"}/>
                            </label>

                            <label className="flex items-center gap-2 p-2 rounded bg-surface-highlight border border-border cursor-pointer hover:border-accent-teal">
                                <input type="checkbox" checked={char.isProfessional || false} onChange={e => setChar({...char, isProfessional: e.target.checked})} />
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-accent-teal">专业模式 (Pro)</div>
                                    <div className="text-[10px] text-muted">专注于解决专业问题</div>
                                </div>
                                <Briefcase size={16} className={char.isProfessional ? "text-accent-teal" : "text-faint"}/>
                            </label>
                        </div>
                    </div>
                    <div className="md:col-span-2 space-y-4 w-full">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>姓名</Label>
                                <Input value={char.name} onChange={e => setChar({...char, name: e.target.value})} />
                            </div>
                            {!isTemplate && (
                                <div>
                                    <Label>所在地</Label>
                                    <select 
                                        className="w-full h-10 bg-surface-light border border-border rounded px-3 text-sm text-body focus:outline-none focus:border-primary"
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
                        
                        <div className="flex flex-col w-full">
                            <Label className="flex items-center gap-1 text-secondary-fg justify-between">
                                <span className="flex items-center gap-1"><VenetianMask size={12}/> 外观</span>
                            </Label>
                            <TextArea 
                                rows={4}
                                value={char.appearance || ""}
                                onChange={e => setChar({...char, appearance: e.target.value})}
                                placeholder="描述角色的气质、体形等，不建议在这里定义服装，这会导致故事中服装被锁死。场景中所有人可见。"
                                className="border-border bg-surface-highlight w-full resize-y mb-2"
                            />
                            <ImageAttachmentList 
                                images={char.appearanceImages || []}
                                onRemove={(id) => handleRemoveImage('appearance', id)}
                                onAdd={() => setShowImageUpload({ target: 'appearance' })}
                                onImageClick={(img) => openImageEditor('appearance', img)}
                                maxImages={1}
                                label="外观参考图"
                            />
                        </div>

                        <div className="flex flex-col w-full">
                            <Label>自我介绍</Label>
                            <TextArea 
                                rows={6} 
                                value={char.description} 
                                onChange={e => setChar({...char, description: e.target.value})}
                                placeholder="第一人称描述角色的性格、背景故事、私人秘密以及行为逻辑..."
                                className="w-full mb-2"
                            />
                            <ImageAttachmentList 
                                images={char.descriptionImages || []}
                                onRemove={(id) => handleRemoveImage('description', id)}
                                onAdd={() => setShowImageUpload({ target: 'description' })}
                                onImageClick={(img) => openImageEditor('description', img)}
                                maxImages={3}
                                label="设定参考图"
                            />
                        </div>

                        {/* Virtual Space (Replaces Speech Style) */}
                        <div className="bg-surface-highlight p-3 rounded border border-border">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-xs font-bold text-info-fg uppercase flex items-center gap-2">
                                    <MessageSquare size={14}/> 虚拟空间
                                </h3>
                                <Button size="sm" variant="secondary" onClick={() => setShowContextModal(true)}>
                                    <Edit size={12} className="mr-1"/> 编辑虚拟空间
                                </Button>
                            </div>
                            <div className="text-[10px] text-muted leading-relaxed">
                                {char.contextConfig?.messages?.length > 0 ? (
                                    <span>包含 {char.contextConfig.messages.length} 条虚拟内容。</span>
                                ) : (
                                    <span className="italic">暂无虚拟内容。</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ATTRIBUTES TAB */}
            {activeTab === 'attributes' && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-muted">核心属性与状态</span>
                        <Button size="sm" variant="secondary" onClick={addAttribute}><Plus size={14} className="mr-1"/> 添加属性</Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {/* Removed filtering for pleasure/快感 so they appear in this list */}
                        {(Object.entries(char.attributes) as [string, GameAttribute][])
                            .map(([key, attr]) => (
                            <div key={key} className="bg-surface-highlight p-3 rounded border border-border flex flex-col gap-2">
                                <div className="flex justify-between items-center gap-2">
                                    <Input 
                                        className="h-7 text-xs flex-1 border-transparent bg-transparent font-bold text-primary p-0 min-w-0" 
                                        value={attr.name} 
                                        onChange={e => updateAttr(key, 'name', e.target.value)} 
                                    />
                                    <div className="flex gap-1 shrink-0">
                                        <button 
                                            onClick={() => updateAttr(key, 'visibility', attr.visibility === AttributeVisibility.PUBLIC ? AttributeVisibility.PRIVATE : AttributeVisibility.PUBLIC)}
                                            className="text-muted hover:text-body p-1"
                                            title={attr.visibility === AttributeVisibility.PUBLIC ? "公开" : "隐藏"}
                                        >
                                            {attr.visibility === AttributeVisibility.PUBLIC ? <Eye size={14}/> : <EyeOff size={14}/>}
                                        </button>
                                        <button onClick={() => removeAttribute(key)} className="text-muted hover:text-danger-fg p-1"><Trash size={14}/></button>
                                    </div>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <Input 
                                        className="h-8 text-sm" 
                                        value={attr.value} 
                                        onChange={e => {
                                            const rawVal = e.target.value;
                                            const numVal = parseFloat(rawVal);
                                            // Check if input is a valid number format to decide type
                                            // Must handle integers, decimals, negative signs
                                            const isNum = !isNaN(numVal) && isFinite(numVal) && rawVal.trim() !== '';
                                            
                                            if (isNum) {
                                                updateAttr(key, 'type', AttributeType.NUMBER);
                                                // Handle intermediate typing states (e.g. "1." or "-" or "1.0") to prevent cursor jump or input rejection
                                                if (rawVal.endsWith('.') || rawVal === '-' || (rawVal.includes('.') && rawVal.endsWith('0'))) {
                                                    updateAttr(key, 'value', rawVal);
                                                } else {
                                                    updateAttr(key, 'value', numVal);
                                                }
                                            } else {
                                                // Empty string or text -> TEXT type
                                                updateAttr(key, 'type', AttributeType.TEXT);
                                                updateAttr(key, 'value', rawVal);
                                            }
                                        }}
                                        placeholder="数值或文本"
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
                        <span className="text-xs text-muted">固有技能与能力 (Deck)</span>
                        <Button size="sm" variant="secondary" onClick={addSkill}><Plus size={14} className="mr-1"/> 新建技能</Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {char.skills.map(skill => (
                            <div key={skill.id} className="bg-surface-highlight border border-border rounded-lg p-3 relative group hover:border-primary transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-sm text-highlight truncate">{skill.name}</h4>
                                    <div className="flex gap-1">
                                        <button onClick={() => setEditingCard({ card: skill, source: 'deck' })} className="text-muted hover:text-body"><Edit size={14}/></button>
                                        <button onClick={() => removeSkill(skill.id)} className={confirmDeleteSkillId === skill.id ? "text-danger-fg" : "text-muted hover:text-danger-fg"}>
                                            <Trash size={14}/>
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted line-clamp-3 h-10">{skill.description}</p>
                                <div className="mt-2 pt-2 border-t border-border flex justify-between text-[10px] text-faint">
                                    <span>{skill.triggerType}</span>
                                    <span className="text-dopamine">{skill.cost} CP</span>
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
                        <span className="text-xs text-muted">背包物品 (Inventory References)</span>
                        <span className="text-[10px] text-faint">物品定义在公共卡池中，此处仅存储引用。</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {char.inventory.map(itemId => {
                            const item = gameState.cardPool.find(c => c.id === itemId);
                            if (!item) return null;
                            return (
                                <div key={itemId} className="bg-surface-highlight border border-border rounded-lg p-3 relative group hover:border-info-fg transition-colors">
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-sm text-highlight truncate">{item.name}</h4>
                                        <div className="flex gap-1">
                                             <button 
                                                onClick={() => setEditingCard({ card: item, source: 'pool' })} 
                                                className="text-muted hover:text-body"
                                                title="编辑公共卡牌定义"
                                             >
                                                <Edit size={14}/>
                                             </button>
                                             <button 
                                                onClick={() => setChar(prev => ({...prev, inventory: prev.inventory.filter(id => id !== itemId)}))}
                                                className="text-muted hover:text-danger-fg"
                                                title="从背包移除"
                                             >
                                                <Trash size={14}/>
                                             </button>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-muted line-clamp-2">{item.description}</p>
                                </div>
                            );
                        })}
                        {char.inventory.length === 0 && (
                            <div className="col-span-full text-center py-10 text-muted border-2 border-dashed border-border rounded">
                                背包空空如也。请在卡池中将物品分配给角色。
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* BRAIN TAB */}
            {activeTab === 'brain' && (
                <div className="space-y-6 pb-10">
                    
                    {/* AI Config */}
                    <div className="bg-surface-highlight p-4 rounded border border-border">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-primary uppercase flex items-center gap-2">
                                <Cpu size={14}/> AI 模型配置 (Model Override)
                            </h3>
                            <label className="flex items-center gap-2 cursor-pointer text-xs">
                                <span className={char.useAiOverride ? "text-primary font-bold" : "text-muted"}>
                                    {char.useAiOverride ? "启用独立配置" : "使用全局配置"}
                                </span>
                                <div className="relative">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer"
                                        checked={char.useAiOverride || false}
                                        onChange={e => setChar({...char, useAiOverride: e.target.checked})}
                                    />
                                    <div className="w-9 h-5 bg-surface-light peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                </div>
                            </label>
                        </div>
                        
                        {char.useAiOverride ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in">
                                <div>
                                    <Label>Provider</Label>
                                    <select 
                                        className="w-full bg-surface border border-border rounded px-2 py-2 text-sm text-body"
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
                                        onChange={e => setChar({...char, aiConfig: { ...char.aiConfig!, temperature: parseFloat(e.target.value) || 0 }})}
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
                        ) : (
                            <div className="text-xs text-muted italic p-2 bg-black/10 rounded">
                                当前正在使用全局「角色行为 AI」配置。如需为该角色单独指定模型（例如更聪明的模型），请开启上方开关。
                            </div>
                        )}
                    </div>
                    
                    {/* Memory Config */}
                    <div className="bg-surface-highlight p-4 rounded border border-border">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-secondary-fg uppercase flex items-center gap-2">
                                <BrainCircuit size={14}/> 记忆与遗忘 (Memory & Dropout)
                            </h3>
                            <label className="flex items-center gap-2 cursor-pointer text-xs">
                                <span className={char.memoryConfig?.useOverride ? "text-secondary-fg font-bold" : "text-muted"}>
                                    {char.memoryConfig?.useOverride ? "启用独立设置" : "使用全局设置"}
                                </span>
                                <div className="relative">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer"
                                        checked={char.memoryConfig?.useOverride || false}
                                        onChange={e => setChar({
                                            ...char, 
                                            memoryConfig: { 
                                                ...(char.memoryConfig || { maxMemoryRounds: 10, actionDropoutProbability: 0.34, reactionDropoutProbability: 0.34 }), 
                                                useOverride: e.target.checked 
                                            }
                                        })}
                                    />
                                    <div className="w-9 h-5 bg-surface-light peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary-base"></div>
                                </div>
                            </label>
                        </div>
                        
                        {char.memoryConfig?.useOverride ? (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-in fade-in">
                                <div>
                                    <Label>记忆能力 (Rounds)</Label>
                                    <Input 
                                        type="number"
                                        value={char.memoryConfig.maxMemoryRounds}
                                        onChange={e => setChar({...char, memoryConfig: { ...char.memoryConfig!, maxMemoryRounds: parseInt(e.target.value) || 0 }})}
                                    />
                                    <p className="text-[9px] text-muted mt-1">长期记忆的采样密度。</p>
                                </div>
                                <div>
                                    <Label>行动遗忘率 (Action Dropout)</Label>
                                    <Input 
                                        type="number" step="0.01" max="1" min="0"
                                        value={char.memoryConfig.actionDropoutProbability}
                                        onChange={e => setChar({...char, memoryConfig: { ...char.memoryConfig!, actionDropoutProbability: parseFloat(e.target.value) || 0 }})}
                                    />
                                    <p className="text-[9px] text-muted mt-1">主动回合降低记忆以防止复读。</p>
                                </div>
                                <div>
                                    <Label>反应遗忘率 (Reaction Dropout)</Label>
                                    <Input 
                                        type="number" step="0.01" max="1" min="0"
                                        value={char.memoryConfig.reactionDropoutProbability}
                                        onChange={e => setChar({...char, memoryConfig: { ...char.memoryConfig!, reactionDropoutProbability: parseFloat(e.target.value) || 0 }})}
                                    />
                                    <p className="text-[9px] text-muted mt-1">被动回合大幅降低记忆以专注当下。</p>
                                </div>
                            </div>
                        ) : (
                            <div className="text-xs text-muted italic p-2 bg-black/10 rounded flex flex-col gap-1">
                                <div>当前正在使用全局记忆设置。</div>
                                <div className="opacity-70">
                                    全局设定：
                                    记忆能力 {char.id.startsWith('env_') ? (gameState.appSettings.maxEnvMemoryRounds || 5) + " (环境)" : gameState.appSettings.maxCharacterMemoryRounds} 轮 | 
                                    行动遗忘 {gameState.appSettings.actionMemoryDropoutProbability} | 
                                    反应遗忘 {gameState.appSettings.reactionMemoryDropoutProbability}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Drives (Pleasure Sources) - REFACTORED TO MATCH CONFLICT STYLE */}
                    <div className="bg-surface-highlight p-4 rounded border border-border">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-accent-pink uppercase flex items-center gap-2">
                                <Heart size={14}/> 驱力 / 快感获取 (Drives & Pleasure)
                            </h3>
                            <Button size="sm" variant="secondary" onClick={addDrive}><Plus size={12}/></Button>
                        </div>
                        <div className="space-y-2">
                            {(char.drives || []).map((drv, idx) => (
                                <div key={drv.id} className="bg-surface border border-accent-pink/30 rounded p-2 flex items-start gap-2">
                                    <div className="flex-1 space-y-1">
                                        <TextArea
                                            className="w-full h-10 text-xs resize-none bg-surface-light border-border focus:border-accent-pink"
                                            value={drv.condition}
                                            onChange={e => updateDrive(idx, 'condition', e.target.value)}
                                            placeholder="条件描述 (如: 探索未知)"
                                        />
                                        <div className="flex justify-between items-center">
                                             <div className="flex items-center gap-1 text-[10px] text-muted">
                                                <span>奖励:</span>
                                                <Input 
                                                    type="number" className="w-12 h-6 text-[10px] border-pink-900/50 focus:border-pink-500" 
                                                    value={drv.amount} 
                                                    onChange={e => handleNumericInput(e.target.value, (v) => updateDrive(idx, 'amount', v))}
                                                />
                                            </div>
                                            <div className="flex items-center gap-1 text-[10px] text-muted">
                                                <span>权重:</span>
                                                <Input 
                                                    type="number" className="w-12 h-6 text-[10px] border-border focus:border-primary" 
                                                    value={drv.weight || 50} 
                                                    onChange={e => handleNumericInput(e.target.value, (v) => updateDrive(idx, 'weight', v))}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => removeDrive(idx)} className="text-muted hover:text-danger-fg pt-2"><Trash size={14}/></button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Conflicts */}
                    <div className="bg-surface-highlight p-4 rounded border border-border">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-warning-fg uppercase flex items-center gap-2">
                                <AlertTriangle size={14}/> 内在与外在矛盾 (Active Conflicts)
                            </h3>
                            <div className="flex gap-2">
                                <Button size="sm" variant="secondary" onClick={() => setShowConflictHistory(true)}>
                                    <History size={12} className="mr-1"/> 历史 ({solvedConflicts.length})
                                </Button>
                                <Button size="sm" variant="secondary" onClick={addConflict}><Plus size={12}/></Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {activeConflicts.length === 0 && <div className="text-xs text-muted italic text-center py-2">暂无活跃矛盾</div>}
                            {activeConflicts.map((conf) => (
                                <div key={conf.id} className="bg-surface border border-warning-base/30 rounded p-2 flex items-start gap-2">
                                    <div className="flex-1 space-y-1">
                                        <TextArea 
                                            className="w-full h-10 text-xs resize-none bg-surface-light border-border focus:border-warning-base" 
                                            value={conf.desc} 
                                            onChange={e => updateConflictById(conf.id, 'desc', e.target.value)}
                                            placeholder="矛盾描述"
                                        />
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-1 text-[10px] text-muted">
                                                <span>奖励(CP/AP):</span>
                                                <Input 
                                                    type="number" className="w-12 h-6 text-[10px]" 
                                                    value={conf.apReward} 
                                                    onChange={e => handleNumericInput(e.target.value, (v) => updateConflictById(conf.id, 'apReward', v))}
                                                />
                                            </div>
                                            <label className="flex items-center gap-1 text-[10px] cursor-pointer bg-success-base/20 px-2 py-0.5 rounded text-success-fg hover:bg-success-base/30">
                                                <input 
                                                    type="checkbox" 
                                                    checked={conf.solved} 
                                                    onChange={e => updateConflictById(conf.id, 'solved', e.target.checked)}
                                                    className="accent-success-base"
                                                /> 标记为解决
                                            </label>
                                        </div>
                                    </div>
                                    <button onClick={() => removeConflictById(conf.id)} className="text-muted hover:text-danger-fg pt-2"><Trash size={14}/></button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Secrets (New Section) */}
                    <div className="bg-surface-highlight p-4 rounded border border-border">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-primary uppercase flex items-center gap-2">
                                <Lock size={14}/> 角色秘密 (Secrets)
                            </h3>
                            <Button size="sm" variant="secondary" onClick={() => setShowSecretsModal(true)}>
                                <Edit size={12} className="mr-1"/> 查看/编辑 ({char.secrets?.length || 0})
                            </Button>
                        </div>
                        <p className="text-[10px] text-muted">这些秘密由 AI 在反应阶段生成，解开前处于隐藏状态。解开后将转化为角色属性。</p>
                    </div>

                    {/* Life Trajectory Section (Moved here & Resized) */}
                    <div className="bg-surface-highlight p-4 rounded border border-border">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-accent-teal uppercase flex items-center gap-2">
                                <TrendingUp size={14}/> 人生轨迹 (Life Trajectory)
                            </h3>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <Label className="text-muted">过去 (Past - Context Only)</Label>
                                <TextArea 
                                    className="w-full h-20 text-xs bg-black/10 border-border resize-y"
                                    value={lifeTrajectory.past}
                                    onChange={e => setChar(prev => ({ ...prev, lifeTrajectory: { ...lifeTrajectory, past: e.target.value } }))}
                                    placeholder="描述角色已完成的过去章节..."
                                />
                            </div>
                            <div className="border-l-2 border-primary pl-3">
                                <Label className="text-primary font-bold">现在 (Current - Active Plot)</Label>
                                <TextArea 
                                    className="w-full h-24 text-xs bg-surface border-primary/50 focus:border-primary resize-y"
                                    value={lifeTrajectory.current}
                                    onChange={e => setChar(prev => ({ ...prev, lifeTrajectory: { ...lifeTrajectory, current: e.target.value } }))}
                                    placeholder="描述角色当前正在经历的人生阶段和目标..."
                                />
                                <p className="text-[10px] text-muted mt-1">此内容将作为宏观剧情引导注入到行动和结算中。</p>
                            </div>
                            <div>
                                <Label className="text-muted">未来 (Future - Planned)</Label>
                                <TextArea 
                                    className="w-full h-20 text-xs bg-black/10 border-border resize-y"
                                    value={lifeTrajectory.future}
                                    onChange={e => setChar(prev => ({ ...prev, lifeTrajectory: { ...lifeTrajectory, future: e.target.value } }))}
                                    placeholder="描述预设的下一章节剧情走向..."
                                />
                            </div>
                        </div>
                    </div>

                    {/* Memory Viewer - REPLACEMENT */}
                    <div className="bg-surface-highlight p-4 rounded border border-border flex flex-col gap-2">
                        <div className="flex justify-between items-center mb-2">
                             <h3 className="text-xs font-bold text-highlight uppercase flex items-center gap-2">
                                <BookOpen size={14}/> 记忆回顾 (Memory)
                             </h3>
                        </div>
                        
                        {/* New Raw Current Memory Button */}
                        <button 
                            onClick={handleReadRawMemory}
                            disabled={!openWindow}
                            className="w-full bg-surface hover:bg-surface-light border border-border rounded-lg p-3 flex items-center justify-between group transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                             <div className="flex items-center gap-3">
                                <div className="p-2 rounded-full bg-primary/10 text-primary group-hover:bg-primary/20">
                                    <BookOpen size={18}/>
                                </div>
                                <div className="text-left">
                                    <div className="text-sm font-bold text-body group-hover:text-highlight">阅读当前记忆 (原始记录)</div>
                                    <div className="text-[10px] text-muted">查看未经 AI 概括的完整日志</div>
                                </div>
                            </div>
                            <ChevronRight size={16} className="text-muted group-hover:translate-x-1 transition-transform"/>
                        </button>
                        
                        {/* Legacy Memory Button */}
                        <button 
                            onClick={handleReadLegacyMemory}
                            disabled={!openWindow || !char.previousLifeLogs || char.previousLifeLogs.length === 0}
                            className={`w-full bg-surface hover:bg-surface-light border border-border rounded-lg p-3 flex items-center justify-between group transition-all disabled:opacity-50 disabled:cursor-not-allowed ${(!char.previousLifeLogs || char.previousLifeLogs.length === 0) ? 'opacity-50' : ''}`}
                        >
                             <div className="flex items-center gap-3">
                                <div className="p-2 rounded-full bg-secondary/10 text-secondary-fg group-hover:bg-secondary/20">
                                    <FileClock size={18}/>
                                </div>
                                <div className="text-left">
                                    <div className="text-sm font-bold text-body group-hover:text-highlight">阅读前世记忆</div>
                                    <div className="text-[10px] text-muted">
                                        {char.previousLifeLogs && char.previousLifeLogs.length > 0 
                                            ? `查看来自旧存档的 ${char.previousLifeLogs.length} 条记录`
                                            : "暂无前世记忆"}
                                    </div>
                                </div>
                            </div>
                            <ChevronRight size={16} className="text-muted group-hover:translate-x-1 transition-transform"/>
                        </button>
                    </div>

                </div>
            )}
        </div>
    </Window>
  );
};
