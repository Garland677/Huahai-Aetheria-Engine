
import React, { useState, useRef } from 'react';
import { AppSettings, AIConfig, GlobalContextConfig, DefaultSettings, Provider, Character, Card, MapLocation, GameAttribute, AttributeType, AttributeVisibility, Conflict, WeatherType, LockedFeatures, GlobalVariable } from '../../types';
import { Button, Input, Label, TextArea } from '../ui/Button';
import { X, Lock, Unlock, Plus, Trash, Terminal, RefreshCw, FileJson, Settings, Code, LayoutTemplate, Edit, MapPin, Trash2, CloudRain, Wind, Key, ShieldCheck, LockKeyhole, MessageSquare, History, Gift, User, Scissors, Clock, Variable, AlertTriangle, CheckCircle, Globe, FastForward } from 'lucide-react';
import { DEFAULT_AI_CONFIG } from '../../config';
import { CharacterEditor } from './CharacterEditor';
import { CardEditor } from './CardEditor';

const PROVIDER_DEFAULTS: Record<string, string> = {
    [Provider.XAI]: 'grok-beta',
    [Provider.GEMINI]: 'gemini-1.5-flash',
    [Provider.OPENAI]: 'gpt-4o-mini',
    [Provider.CLAUDE]: 'claude-3-5-sonnet-20240620',
    [Provider.VOLCANO]: 'doubao-pro-32k',
    [Provider.OPENROUTER]: 'google/gemini-flash-1.5'
};

interface SettingsWindowProps {
    settings: AppSettings;
    judgeConfig: AIConfig;
    globalContext: GlobalContextConfig;
    defaultSettings: DefaultSettings;
    devMode: boolean;
    onSave: (settings: AppSettings, judge: AIConfig, ctx: GlobalContextConfig, defaults: DefaultSettings, devMode: boolean) => void;
    onSyncAllChars?: (config: AIConfig, settings: AppSettings) => void;
    onClose: () => void;
}

export const SettingsWindow: React.FC<SettingsWindowProps> = ({ settings, judgeConfig, globalContext, defaultSettings, devMode, onSave, onClose, onSyncAllChars }) => {
    const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
    const [localJudge, setLocalJudge] = useState<AIConfig>(judgeConfig || DEFAULT_AI_CONFIG);
    const [localContext, setLocalContext] = useState<GlobalContextConfig>(globalContext);
    const [localDefaults, setLocalDefaults] = useState<DefaultSettings>(defaultSettings);
    const [localDevMode, setLocalDevMode] = useState(devMode);
    
    const [passwordInput, setPasswordInput] = useState("");
    const [activeTab, setActiveTab] = useState<'general' | 'developer'>('general');
    const [promptKey, setPromptKey] = useState<keyof typeof defaultSettings.prompts>('determineCharacterAction');
    
    // Confirm Modal State
    const [showSyncConfirm, setShowSyncConfirm] = useState(false);

    // State for Visual Editors
    const [editingTemplateType, setEditingTemplateType] = useState<'character' | 'location' | 'card_skill' | 'card_item' | 'card_event' | null>(null);

    // Dev Options Lock State (Derived from settings, but we update localSettings immediately on unlock)
    const isKeysUnlocked = localSettings.devOptionsUnlocked;

    // Helper to convert ISO string to datetime-local string (YYYY-MM-DDTHH:mm)
    const toLocalISO = (isoStr: string | undefined) => {
        if (!isoStr) return "";
        try {
            const d = new Date(isoStr);
            // Shift to local time for input
            const tzOffset = d.getTimezoneOffset() * 60000;
            const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
            return localISOTime;
        } catch(e) { return ""; }
    };

    const fromLocalISO = (localStr: string) => {
        if (!localStr) return "";
        const d = new Date(localStr);
        return d.toISOString();
    };

    const unlockKeys = () => {
        // Check against stored password (default empty)
        const targetPwd = localSettings.devPassword || "";
        if (passwordInput === targetPwd) {
            const newSettings = { ...localSettings, devOptionsUnlocked: true };
            setLocalSettings(newSettings);
        } else {
            alert("密码错误 (Invalid Password)");
        }
    };
    
    const handlePasswordKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            unlockKeys();
        }
    };

    const toggleLock = (key: keyof LockedFeatures) => {
        setLocalSettings(prev => ({
            ...prev,
            lockedFeatures: {
                ...prev.lockedFeatures,
                [key]: !prev.lockedFeatures[key]
            }
        }));
    };

    const addContextMsg = () => {
        setLocalContext(prev => ({
            messages: [...prev.messages, { role: 'user', content: '' }]
        }));
    };

    const updateContextMsg = (idx: number, field: keyof typeof localContext.messages[0], val: any) => {
        const newMsgs = [...localContext.messages];
        newMsgs[idx] = { ...newMsgs[idx], [field]: val };
        setLocalContext({ messages: newMsgs });
    };

    const removeContextMsg = (idx: number) => {
        setLocalContext({ messages: localContext.messages.filter((_, i) => i !== idx) });
    };

    const handleSyncAllClick = () => {
        setShowSyncConfirm(true);
    };
    
    const confirmSyncAll = () => {
        if (onSyncAllChars) {
            onSyncAllChars(localJudge, localSettings);
        }
        setShowSyncConfirm(false);
    };
    
    const handleSaveTemplateChar = (char: Character) => {
        setLocalDefaults(prev => ({
            ...prev,
            templates: { ...prev.templates, character: char }
        }));
        setEditingTemplateType(null);
    };

    const handleSaveTemplateCard = (card: Card) => {
        if (editingTemplateType === 'card_skill') {
            setLocalDefaults(prev => ({ ...prev, templates: { ...prev.templates, cards: { ...prev.templates.cards, skill: card } } }));
        } else if (editingTemplateType === 'card_item') {
             setLocalDefaults(prev => ({ ...prev, templates: { ...prev.templates, cards: { ...prev.templates.cards, item: card } } }));
        } else if (editingTemplateType === 'card_event') {
             setLocalDefaults(prev => ({ ...prev, templates: { ...prev.templates, cards: { ...prev.templates.cards, event: card } } }));
        }
        setEditingTemplateType(null);
    };
    
    const handleSaveTemplateLocation = (loc: MapLocation) => {
         setLocalDefaults(prev => ({ ...prev, templates: { ...prev.templates, location: loc } }));
         setEditingTemplateType(null);
    };

    // Weather Config Helpers
    const updateWeather = (idx: number, field: keyof WeatherType, val: any) => {
        const newWeather = [...localDefaults.weatherConfig];
        newWeather[idx] = { ...newWeather[idx], [field]: val };
        setLocalDefaults(prev => ({ ...prev, weatherConfig: newWeather }));
    };

    const addWeather = () => {
        setLocalDefaults(prev => ({ 
            ...prev, 
            weatherConfig: [...prev.weatherConfig, { name: "新状态", weight: 1 }] 
        }));
    };

    const removeWeather = (idx: number) => {
         setLocalDefaults(prev => ({ 
            ...prev, 
            weatherConfig: prev.weatherConfig.filter((_, i) => i !== idx) 
        }));
    };

    // Global Variables Helpers
    const addGlobalVar = () => {
        const newVar: GlobalVariable = { id: `var_${Date.now()}`, key: 'NewVar', value: '' };
        setLocalSettings(prev => ({ ...prev, globalVariables: [...(prev.globalVariables || []), newVar] }));
    };

    const updateGlobalVar = (idx: number, field: keyof GlobalVariable, val: string) => {
        const newVars = [...(localSettings.globalVariables || [])];
        // Remove brackets if user types them for key
        if (field === 'key') val = val.replace(/[{}]/g, '').trim();
        newVars[idx] = { ...newVars[idx], [field]: val };
        setLocalSettings(prev => ({ ...prev, globalVariables: newVars }));
    };

    const removeGlobalVar = (idx: number) => {
        setLocalSettings(prev => ({
            ...prev,
            globalVariables: prev.globalVariables.filter((_, i) => i !== idx)
        }));
    };

    // Dummy GameState for visual editors
    const dummyState: any = {
        characters: {},
        map: { charPositions: {}, activeLocationId: '', locations: {} },
        cardPool: [],
        defaultSettings: localDefaults,
        judgeConfig: localJudge
    };

    // --- Inline Location Editor Component ---
    const LocationTemplateEditor = ({ initialLoc, onSave, onClose }: { initialLoc: MapLocation, onSave: (l: MapLocation) => void, onClose: () => void }) => {
        const [loc, setLoc] = useState(initialLoc);
        
        // Attribute Helpers
        const updateAttr = (key: string, field: keyof GameAttribute, val: any) => {
            setLoc(prev => ({
                ...prev,
                attributes: { ...prev.attributes, [key]: { ...prev.attributes![key], [field]: val } }
            }));
        };
        const addAttribute = () => {
            const id = `loc_attr_${Date.now()}`;
            setLoc(prev => ({
                ...prev,
                attributes: { ...prev.attributes, [id]: { id, name: '新属性', type: AttributeType.TEXT, value: '', visibility: AttributeVisibility.PUBLIC } }
            }));
        };
        const removeAttribute = (key: string) => {
            const newAttrs = { ...loc.attributes };
            delete newAttrs[key];
            setLoc(prev => ({ ...prev, attributes: newAttrs }));
        };

        return (
            <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-[110] p-4">
                <div className="w-full max-w-[700px] bg-slate-900 border border-slate-700 rounded-lg flex flex-col shadow-2xl max-h-[85vh]">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-lg">
                        <h2 className="font-bold text-white flex items-center gap-2"><MapPin size={18}/> 编辑地点模版</h2>
                        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20}/></button>
                    </div>
                    <div className="p-6 flex-1 overflow-y-auto space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <Label>默认名称</Label>
                                <Input value={loc.name} onChange={e => setLoc({...loc, name: e.target.value})} />
                            </div>
                            <div>
                                <Label>默认半径 (米)</Label>
                                <Input type="number" value={loc.radius} onChange={e => setLoc({...loc, radius: parseInt(e.target.value)})} />
                            </div>
                        </div>
                        <div>
                            <Label>默认描述</Label>
                            <TextArea className="h-20" value={loc.description} onChange={e => setLoc({...loc, description: e.target.value})} />
                        </div>

                        <div className="border border-slate-800 rounded p-3 bg-gray-950">
                            <div className="flex justify-between items-center mb-2">
                                <Label>默认属性 (Attributes)</Label>
                                <Button size="sm" variant="secondary" onClick={addAttribute}><Plus size={12}/></Button>
                            </div>
                            <div className="space-y-2 max-h-[150px] overflow-y-auto">
                                    {(Object.entries(loc.attributes || {}) as [string, GameAttribute][]).map(([key, attr]) => (
                                    <div key={key} className="flex gap-1 items-center bg-slate-900 p-1.5 rounded border border-slate-800">
                                        <Input className="h-6 text-xs w-16" value={attr.name} onChange={e => updateAttr(key, 'name', e.target.value)} placeholder="Name"/>
                                        <Input className="h-6 text-xs flex-1" value={attr.value} onChange={e => updateAttr(key, 'value', e.target.value)} placeholder="Val"/>
                                        <button onClick={() => removeAttribute(key)} className="text-slate-500 hover:text-red-400"><Trash2 size={12}/></button>
                                    </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                    <div className="p-4 border-t border-slate-800 bg-slate-900 rounded-b-lg flex justify-end gap-2">
                        <Button variant="secondary" onClick={onClose}>取消</Button>
                        <Button onClick={() => onSave(loc)}>保存模版</Button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-4xl bg-slate-900 border border-slate-700 shadow-2xl rounded-lg flex flex-col max-h-[95vh] relative">
                
                {/* In-window Confirmation Modal */}
                {showSyncConfirm && (
                    <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 rounded-lg">
                        <div className="bg-slate-950 border border-red-500/50 p-6 rounded-lg shadow-2xl max-w-md w-full animate-in zoom-in-95">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <AlertTriangle size={20} className="text-red-500"/> 确认强制应用？
                            </h3>
                            <p className="text-sm text-slate-300 mb-6 leading-relaxed">
                                此操作将把当前的 <b>AI 模型配置</b> 和 <b>API 密钥</b> 强制覆盖到游戏中的<b>所有角色</b>身上。<br/><br/>
                                <span className="text-red-400">角色原有的个性化模型设置将被丢失。</span>
                            </p>
                            <div className="flex justify-end gap-3">
                                <Button variant="secondary" onClick={() => setShowSyncConfirm(false)}>取消</Button>
                                <Button onClick={confirmSyncAll} className="bg-red-600 hover:bg-red-500 text-white border-transparent">
                                    <RefreshCw size={14} className="mr-2"/> 确认覆盖
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Visual Editor Overlays */}
                {editingTemplateType === 'character' && (
                     <div className="absolute inset-0 z-[100] bg-slate-950 flex items-center justify-center">
                          <CharacterEditor 
                              character={localDefaults.templates.character}
                              onClose={() => setEditingTemplateType(null)}
                              onSave={handleSaveTemplateChar}
                              gameState={dummyState}
                              isTemplate={true}
                          />
                     </div>
                )}
                {editingTemplateType === 'location' && (
                    <LocationTemplateEditor 
                        initialLoc={localDefaults.templates.location}
                        onSave={handleSaveTemplateLocation}
                        onClose={() => setEditingTemplateType(null)}
                    />
                )}
                {editingTemplateType && ['card_skill', 'card_item', 'card_event'].includes(editingTemplateType) && (
                     <div className="absolute inset-0 z-[100] bg-slate-950/95 flex items-center justify-center p-4">
                          <CardEditor 
                              initialCard={
                                  editingTemplateType === 'card_skill' ? localDefaults.templates.cards.skill :
                                  editingTemplateType === 'card_item' ? localDefaults.templates.cards.item :
                                  localDefaults.templates.cards.event
                              }
                              onClose={() => setEditingTemplateType(null)}
                              onSave={handleSaveTemplateCard}
                              gameState={dummyState}
                          />
                     </div>
                )}

                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-lg shrink-0">
                    <h2 className="font-bold text-lg text-slate-100">引擎配置 (Engine Config)</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
                </div>
                
                <div className="flex bg-slate-900 border-b border-slate-800 p-1 gap-1 shrink-0">
                    <button onClick={() => setActiveTab('general')} className={`flex-1 py-2 text-xs font-bold rounded flex items-center justify-center gap-2 ${activeTab === 'general' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
                        <Settings size={14}/> 常规配置
                    </button>
                    <button onClick={() => setActiveTab('developer')} className={`flex-1 py-2 text-xs font-bold rounded flex items-center justify-center gap-2 ${activeTab === 'developer' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
                       {!isKeysUnlocked && <Lock size={12}/>} 开发者与默认值 (Developer)
                    </button>
                </div>

                <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-900">
                    {activeTab === 'general' && (
                        <div className="space-y-6">
                            <div className="bg-gray-950 p-4 rounded border border-slate-800">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <Label className="text-indigo-400 mb-1">System/World AI (Judge)</Label>
                                        <p className="text-xs text-slate-500">此模型处理规则、世界事件和默认行为。</p>
                                    </div>
                                    <Button size="sm" variant="secondary" onClick={handleSyncAllClick} title="将此配置应用为全局默认并覆盖所有角色" className="text-xs h-8">
                                        <RefreshCw size={12} className="mr-1"/> 强制应用到所有角色
                                    </Button>
                                </div>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <Label>Provider</Label>
                                        <select 
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-2 text-sm text-slate-200"
                                            value={localJudge.provider}
                                            onChange={e => {
                                                const newProvider = e.target.value as any;
                                                setLocalJudge({
                                                    ...localJudge, 
                                                    provider: newProvider,
                                                    model: PROVIDER_DEFAULTS[newProvider] || '' 
                                                });
                                            }}
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
                                        <Label>Model Name / Endpoint ID</Label>
                                        <Input 
                                            value={localJudge.model} 
                                            onChange={e => setLocalJudge({...localJudge, model: e.target.value})} 
                                            placeholder={PROVIDER_DEFAULTS[localJudge.provider] || "e.g. grok-beta"} 
                                        />
                                        <p className="text-[10px] text-slate-500 mt-1">切换 Provider 会自动填充推荐模型。</p>
                                    </div>
                                </div>
                                
                                <div>
                                    <Label>Temperature (创意度)</Label>
                                    <div className="flex items-center gap-3">
                                        <input 
                                            type="range" 
                                            min="0" max="2" step="0.1"
                                            className="flex-1 accent-indigo-500"
                                            value={localJudge.temperature ?? 1.0}
                                            onChange={e => setLocalJudge({...localJudge, temperature: parseFloat(e.target.value)})}
                                        />
                                        <Input 
                                            type="number" 
                                            className="w-16 text-center h-8"
                                            value={localJudge.temperature ?? 1.0}
                                            onChange={e => setLocalJudge({...localJudge, temperature: parseFloat(e.target.value)})}
                                            step="0.1"
                                        />
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-1">
                                        温度越高 (0-2)，AI 回复越有创意但越不可控。推荐 0.7 - 1.2。
                                    </p>
                                </div>
                            </div>

                            {/* Game Rules / World Time Section (New) */}
                            <div className="bg-gray-950 p-4 rounded border border-slate-800">
                                <Label className="text-teal-400 uppercase tracking-wider font-bold flex items-center gap-2 mb-4">
                                    <Clock size={16}/> 游戏世界规则 (Game Rules)
                                </Label>
                                <div>
                                    <Label className="flex items-center gap-1"><FastForward size={12}/> 时间流逝倍率 (World Time Scale)</Label>
                                    <div className="flex gap-2 items-center">
                                         <Input 
                                            type="number" 
                                            step="0.1"
                                            min="0.1"
                                            className="w-full"
                                            value={localDefaults.gameplay.worldTimeScale || 1} 
                                            onChange={e => setLocalDefaults({...localDefaults, gameplay: {...localDefaults.gameplay, worldTimeScale: parseFloat(e.target.value) || 1}})} 
                                        />
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-1">
                                        控制现实时间与游戏时间的比例。例如设为 60，则现实 1 秒 = 游戏 1 分钟。默认 1。
                                    </p>
                                </div>
                            </div>

                             <div className="bg-gray-950 p-4 rounded border border-slate-800 space-y-4">
                                 <Label className="text-indigo-400 uppercase tracking-wider font-bold flex items-center gap-2">
                                     <MessageSquare size={16}/> 上下文设置 (Context Settings)
                                 </Label>
                                 
                                 <div>
                                     <Label>Max Output Tokens (单次生成最大长度)</Label>
                                     <Input 
                                         type="number"
                                         value={localSettings.maxContextSize || 32000}
                                         onChange={e => setLocalSettings({...localSettings, maxContextSize: parseInt(e.target.value) || 32000})}
                                         className="font-mono text-xs"
                                     />
                                     <p className="text-[10px] text-slate-500 mt-1">
                                         这决定了 AI 单次回复的最大字数。通常建议 2000-4000，过大会增加延迟。
                                     </p>
                                 </div>

                                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-800 pt-4 mt-2">
                                    <div>
                                        <Label className="flex items-center gap-2"><History size={12}/> 全局历史轮数 (Long)</Label>
                                        <Input 
                                            type="number" 
                                            value={localSettings.maxHistoryRounds || 20} 
                                            onChange={e => setLocalSettings({...localSettings, maxHistoryRounds: parseInt(e.target.value) || 20})}
                                        />
                                        <p className="text-[10px] text-slate-500 mt-1">用于角色扮演和世界演化的长历史上下文。</p>
                                    </div>
                                    <div>
                                        <Label className="flex items-center gap-2"><Scissors size={12}/> 逻辑判定轮数 (Short)</Label>
                                        <Input 
                                            type="number" 
                                            value={localSettings.maxShortHistoryRounds || 5} 
                                            onChange={e => setLocalSettings({...localSettings, maxShortHistoryRounds: parseInt(e.target.value) || 5})}
                                        />
                                        <p className="text-[10px] text-slate-500 mt-1">用于技能/条件判定的短历史上下文，节省 Token。</p>
                                    </div>
                                    <div>
                                        <Label className="flex items-center gap-2"><User size={12}/> 角色记忆轮数</Label>
                                        <Input 
                                            type="number" 
                                            value={localSettings.maxCharacterMemoryRounds || 20} 
                                            onChange={e => setLocalSettings({...localSettings, maxCharacterMemoryRounds: parseInt(e.target.value) || 20})}
                                        />
                                        <p className="text-[10px] text-slate-500 mt-1">AI 思考时参考的个人视角历史轮数。</p>
                                    </div>
                                </div>
                            </div>

                            {/* Global Variables Section */}
                            <div className="bg-gray-950 p-4 rounded border border-slate-800 space-y-4">
                                <div className="flex justify-between items-center">
                                    <Label className="text-indigo-400 uppercase tracking-wider font-bold flex items-center gap-2">
                                        <Variable size={16}/> 通用变量 (Global Variables)
                                    </Label>
                                    <Button size="sm" variant="secondary" onClick={addGlobalVar}><Plus size={12} className="mr-1"/> 添加变量</Button>
                                </div>
                                <p className="text-[10px] text-slate-500">
                                    定义的变量可以在游戏中的任何文本框（提示词、设定、对话等）中使用 {`{{变量名}}`} 进行引用。系统将在提交给 AI 前自动替换。
                                </p>
                                <div className="space-y-2">
                                    {(localSettings.globalVariables || []).map((v, idx) => (
                                        <div key={v.id} className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-800">
                                            <div className="flex items-center bg-slate-950 px-2 rounded border border-slate-700 text-slate-400 text-xs font-mono shrink-0">
                                                {'{{'}
                                                <input 
                                                    className="bg-transparent border-none outline-none text-indigo-300 w-24 px-1 py-1" 
                                                    value={v.key} 
                                                    onChange={e => updateGlobalVar(idx, 'key', e.target.value)}
                                                    placeholder="Key"
                                                />
                                                {'}}'}
                                            </div>
                                            <span className="text-slate-500 text-xs">=</span>
                                            <Input 
                                                className="flex-1 h-8 text-xs font-mono" 
                                                value={v.value} 
                                                onChange={e => updateGlobalVar(idx, 'value', e.target.value)}
                                                placeholder="Value"
                                            />
                                            <button onClick={() => removeGlobalVar(idx)} className="text-slate-500 hover:text-red-400 p-1"><Trash2 size={14}/></button>
                                        </div>
                                    ))}
                                    {(localSettings.globalVariables || []).length === 0 && (
                                        <div className="text-center text-slate-600 text-xs italic py-2">暂无通用变量</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'developer' && (
                        <div className="space-y-4">
                            {!isKeysUnlocked ? (
                                <div className="flex flex-col items-center justify-center h-64 bg-gray-950 rounded border border-slate-800 gap-4">
                                    <Lock size={32} className="text-slate-500"/>
                                    <p className="text-slate-400 text-sm text-center px-4">请输入密码以访问开发者设置、API 密钥及默认模版。</p>
                                    <div className="flex gap-2">
                                        <Input 
                                            type="password" 
                                            placeholder="输入密码" 
                                            className="w-40" 
                                            value={passwordInput} 
                                            onChange={e => setPasswordInput(e.target.value)}
                                            onKeyDown={handlePasswordKeyDown}
                                        />
                                        <Button onClick={unlockKeys}>解锁</Button>
                                    </div>
                                    {!localSettings.devPassword && (
                                        <p className="text-[10px] text-slate-600">提示: 当前未设置密码，请直接点击解锁。</p>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-6 animate-in fade-in">
                                    <div className="flex justify-between items-center bg-green-900/10 p-2 rounded border border-green-900/30">
                                        <div className="flex items-center gap-2 text-green-400">
                                            <Unlock size={16}/> <span className="text-xs font-bold">开发者模式已解锁 (Session Unlocked)</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-500 hidden sm:inline">设置访问密码:</span>
                                            <Input 
                                                type="password" 
                                                placeholder="留空为无密码" 
                                                className="h-6 w-24 sm:w-32 text-xs"
                                                value={localSettings.devPassword || ""}
                                                onChange={e => setLocalSettings({...localSettings, devPassword: e.target.value})}
                                            />
                                        </div>
                                    </div>

                                    {/* Debug Mode Toggle (Moved to top) */}
                                    <div className="bg-slate-950 p-3 rounded border border-slate-800">
                                        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer hover:text-white transition-colors">
                                            <input type="checkbox" checked={localDevMode} onChange={e => setLocalDevMode(e.target.checked)} className="accent-green-500"/> 
                                            <Terminal size={14} className="text-green-500"/>
                                            <span className="font-bold">Debug Mode (显示 AI 原始 Prompt)</span>
                                        </label>
                                        <p className="text-[10px] text-slate-500 mt-1 ml-6">开启后，可以在主界面顶部访问 Debug Console 查看 AI 的原始输入输出。</p>
                                    </div>
                                    
                                    {/* Feature Locking */}
                                    <div className="space-y-4 border-b border-slate-800 pb-6">
                                        <Label className="text-red-400 uppercase tracking-wider font-bold flex items-center gap-2"><LockKeyhole size={16}/> 功能锁定 (Locked Features)</Label>
                                        <p className="text-[10px] text-slate-500">锁定后，普通用户将无法使用这些编辑功能。仅供发布使用。</p>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-950 p-3 rounded border border-slate-800">
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.cardPoolEditor} onChange={() => toggleLock('cardPoolEditor')} className="accent-red-500"/>
                                                卡池编辑器
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.characterEditor} onChange={() => toggleLock('characterEditor')} className="accent-red-500"/>
                                                角色编辑器
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.locationEditor} onChange={() => toggleLock('locationEditor')} className="accent-red-500"/>
                                                地点编辑器
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.prizePoolEditor} onChange={() => toggleLock('prizePoolEditor')} className="accent-red-500"/>
                                                奖池编辑器
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.actionPoints} onChange={() => toggleLock('actionPoints')} className="accent-red-500"/>
                                                行动点数编辑
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.locationReset} onChange={() => toggleLock('locationReset')} className="accent-red-500"/>
                                                地点重置功能
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.worldState} onChange={() => toggleLock('worldState')} className="accent-red-500"/>
                                                世界状态编辑
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.directorInstructions} onChange={() => toggleLock('directorInstructions')} className="accent-red-500"/>
                                                导演指令/设定
                                            </label>
                                            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                <input type="checkbox" checked={localSettings.lockedFeatures?.triggerEditor} onChange={() => toggleLock('triggerEditor')} className="accent-red-500"/>
                                                触发器编辑器
                                            </label>
                                        </div>
                                    </div>

                                    {/* Security Options */}
                                    <div className="space-y-4 border-b border-slate-800 pb-6">
                                        <Label className="text-indigo-400 uppercase tracking-wider font-bold flex items-center gap-2"><ShieldCheck size={16}/> 安全设置 (Security)</Label>
                                        <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-4">
                                            <div className="space-y-1">
                                                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={localSettings.encryptSaveFiles || false} 
                                                        onChange={e => setLocalSettings({...localSettings, encryptSaveFiles: e.target.checked})}
                                                        className="accent-indigo-500"
                                                    /> 
                                                    <span>启用存档加密 (Encrypt Save Files)</span>
                                                </label>
                                                <p className="text-[10px] text-slate-500 ml-5">
                                                    启用后，存档文件内容将被加密，且只能通过文件名作为密钥进行解密。
                                                </p>
                                            </div>

                                            <div className="border-t border-slate-800 pt-2">
                                                <div className="flex items-center justify-between mb-1">
                                                    <Label className="text-xs flex items-center gap-1"><Clock size={12}/> 存档过期时间 (Save Expiration)</Label>
                                                    {localSettings.saveExpirationDate && (
                                                        <button 
                                                            onClick={() => setLocalSettings({...localSettings, saveExpirationDate: ""})} 
                                                            className="text-[10px] text-red-400 hover:underline"
                                                        >
                                                            清除限制
                                                        </button>
                                                    )}
                                                </div>
                                                <Input 
                                                    type="datetime-local" 
                                                    className="w-full text-xs"
                                                    value={toLocalISO(localSettings.saveExpirationDate)}
                                                    onChange={e => setLocalSettings({...localSettings, saveExpirationDate: fromLocalISO(e.target.value)})}
                                                />
                                                <p className="text-[10px] text-slate-500 mt-1">
                                                    设置一个绝对时间。在此时间之后，加载存档将强制要求输入开发者密码进行在线验证。
                                                    (当前: {localSettings.saveExpirationDate ? new Date(localSettings.saveExpirationDate).toLocaleString() : "无限制"})
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* API Keys Section */}
                                    <div className="space-y-4 border-b border-slate-800 pb-6">
                                        <Label className="text-indigo-400 uppercase tracking-wider font-bold">API 密钥管理</Label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <Label>Google Gemini Key</Label>
                                                <Input 
                                                    type="password" 
                                                    value={localSettings.apiKeys.gemini || ''} 
                                                    onChange={e => setLocalSettings({...localSettings, apiKeys: {...localSettings.apiKeys, gemini: e.target.value}})}
                                                    placeholder="Env Var Override"
                                                />
                                            </div>
                                            <div>
                                                <Label>xAI Key (Grok)</Label>
                                                <Input 
                                                    type="password" 
                                                    value={localSettings.apiKeys.xai || ''} 
                                                    onChange={e => setLocalSettings({...localSettings, apiKeys: {...localSettings.apiKeys, xai: e.target.value}})}
                                                />
                                            </div>
                                            <div>
                                                <Label>Volcengine Key (Doubao)</Label>
                                                <Input 
                                                    type="password" 
                                                    value={localSettings.apiKeys.volcano || ''} 
                                                    onChange={e => setLocalSettings({...localSettings, apiKeys: {...localSettings.apiKeys, volcano: e.target.value}})}
                                                />
                                            </div>
                                            <div>
                                                <Label>OpenRouter Key</Label>
                                                <Input 
                                                    type="password" 
                                                    value={localSettings.apiKeys.openrouter || ''} 
                                                    onChange={e => setLocalSettings({...localSettings, apiKeys: {...localSettings.apiKeys, openrouter: e.target.value}})}
                                                />
                                            </div>
                                            <div>
                                                <Label>OpenAI Key</Label>
                                                <Input 
                                                    type="password" 
                                                    value={localSettings.apiKeys.openai || ''} 
                                                    onChange={e => setLocalSettings({...localSettings, apiKeys: {...localSettings.apiKeys, openai: e.target.value}})}
                                                />
                                            </div>
                                            <div>
                                                <Label>Claude Key (Anthropic)</Label>
                                                <Input 
                                                    type="password" 
                                                    value={localSettings.apiKeys.claude || ''} 
                                                    onChange={e => setLocalSettings({...localSettings, apiKeys: {...localSettings.apiKeys, claude: e.target.value}})}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Defaults & Templates Section */}
                                    <div className="space-y-4 border-b border-slate-800 pb-6">
                                        <Label className="text-teal-400 uppercase tracking-wider font-bold flex items-center gap-2"><LayoutTemplate size={16}/> 默认值与模版 (Defaults)</Label>
                                        
                                        <div className="bg-slate-950 p-4 rounded border border-slate-800">
                                            <Label className="mb-2 text-xs text-slate-500 uppercase">初始参数</Label>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                                                <div>
                                                    <Label>初始 CP</Label>
                                                    <Input type="number" value={localDefaults.gameplay.defaultInitialCP} onChange={e => setLocalDefaults({...localDefaults, gameplay: {...localDefaults.gameplay, defaultInitialCP: parseInt(e.target.value)}})} />
                                                </div>
                                                <div>
                                                    <Label>创造基础消耗 (CP)</Label>
                                                    <Input type="number" value={localDefaults.gameplay.defaultCreationCost} onChange={e => setLocalDefaults({...localDefaults, gameplay: {...localDefaults.gameplay, defaultCreationCost: parseInt(e.target.value)}})} />
                                                </div>
                                                <div>
                                                    <Label>初始行动点 (AP)</Label>
                                                    <Input type="number" value={localDefaults.gameplay.defaultInitialAP} onChange={e => setLocalDefaults({...localDefaults, gameplay: {...localDefaults.gameplay, defaultInitialAP: parseInt(e.target.value)}})} />
                                                </div>
                                                {/* Removed World Time Scale from here */}
                                            </div>

                                            <Label className="mb-2 text-xs text-slate-500 uppercase flex items-center gap-2">
                                                <Globe size={12}/> 初始世界设定 (Initial World Config)
                                            </Label>
                                            <div className="space-y-3 mb-4 bg-black/20 p-3 rounded border border-slate-800/50">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <Label>初始区域名称</Label>
                                                        <Input 
                                                            value={localDefaults.initialWorldConfig?.startRegionName || ""} 
                                                            onChange={e => setLocalDefaults({...localDefaults, initialWorldConfig: {...localDefaults.initialWorldConfig!, startRegionName: e.target.value}})}
                                                            placeholder="旧世边缘"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label>初始地点名称</Label>
                                                        <Input 
                                                            value={localDefaults.initialWorldConfig?.startLocationName || ""} 
                                                            onChange={e => setLocalDefaults({...localDefaults, initialWorldConfig: {...localDefaults.initialWorldConfig!, startLocationName: e.target.value}})}
                                                            placeholder="起始营地"
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <Label>初始地点/区域描述</Label>
                                                    <Input 
                                                        value={localDefaults.initialWorldConfig?.startRegionDesc || ""} 
                                                        onChange={e => setLocalDefaults({...localDefaults, initialWorldConfig: {...localDefaults.initialWorldConfig!, startRegionDesc: e.target.value}})}
                                                        placeholder="区域描述"
                                                        className="mb-2"
                                                    />
                                                     <Input 
                                                        value={localDefaults.initialWorldConfig?.startLocationDesc || ""} 
                                                        onChange={e => setLocalDefaults({...localDefaults, initialWorldConfig: {...localDefaults.initialWorldConfig!, startLocationDesc: e.target.value}})}
                                                        placeholder="地点描述"
                                                    />
                                                </div>
                                                <div className="grid grid-cols-3 gap-4">
                                                    <div className="col-span-1">
                                                        <Label>环境角色后缀</Label>
                                                        <Input 
                                                            value={localDefaults.initialWorldConfig?.environmentCharNameSuffix || ""} 
                                                            onChange={e => setLocalDefaults({...localDefaults, initialWorldConfig: {...localDefaults.initialWorldConfig!, environmentCharNameSuffix: e.target.value}})}
                                                            placeholder="的环境"
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <Label>环境角色描述模版 (使用 {'{{LOCATION_NAME}}'})</Label>
                                                        <Input 
                                                            value={localDefaults.initialWorldConfig?.environmentCharDescTemplate || ""} 
                                                            onChange={e => setLocalDefaults({...localDefaults, initialWorldConfig: {...localDefaults.initialWorldConfig!, environmentCharDescTemplate: e.target.value}})}
                                                            placeholder="【系统代理】..."
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <Label className="mb-2 text-xs text-slate-500 uppercase">实体模版 (Visual Editor)</Label>
                                            <div className="flex flex-wrap gap-2 mb-4">
                                                <Button size="sm" variant="secondary" onClick={() => setEditingTemplateType('character')} className="flex items-center gap-2">
                                                    <Edit size={14}/> 编辑角色模版
                                                </Button>
                                                <Button size="sm" variant="secondary" onClick={() => setEditingTemplateType('location')} className="flex items-center gap-2">
                                                    <Edit size={14}/> 编辑地点模版
                                                </Button>
                                                <Button size="sm" variant="secondary" onClick={() => setEditingTemplateType('card_skill')} className="flex items-center gap-2">
                                                    <Edit size={14}/> 编辑技能模版
                                                </Button>
                                                <Button size="sm" variant="secondary" onClick={() => setEditingTemplateType('card_item')} className="flex items-center gap-2">
                                                    <Edit size={14}/> 编辑物品模版
                                                </Button>
                                                <Button size="sm" variant="secondary" onClick={() => setEditingTemplateType('card_event')} className="flex items-center gap-2">
                                                    <Edit size={14}/> 编辑事件模版
                                                </Button>
                                            </div>

                                            <Label className="mb-2 text-xs text-slate-500 uppercase">Prompt Engineering</Label>
                                            <div className="bg-black/20 p-2 rounded border border-slate-800">
                                                <div className="flex mb-2">
                                                    <select 
                                                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-full"
                                                        value={promptKey}
                                                        onChange={e => setPromptKey(e.target.value as any)}
                                                    >
                                                        {Object.keys(localDefaults.prompts).map(k => (
                                                            <option key={k} value={k}>{k}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <TextArea 
                                                    className="h-32 font-mono text-xs leading-relaxed w-full"
                                                    value={localDefaults.prompts[promptKey]}
                                                    onChange={e => setLocalDefaults(prev => ({
                                                        ...prev,
                                                        prompts: { ...prev.prompts, [promptKey]: e.target.value }
                                                    }))}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Weather/Status Config */}
                                    <div className="space-y-4 border-b border-slate-800 pb-6">
                                         <div className="flex justify-between items-center">
                                             <Label className="text-orange-400 uppercase tracking-wider font-bold flex items-center gap-2"><Wind size={16}/> 世界状态配置 (World Status)</Label>
                                             <Button size="sm" variant="secondary" onClick={addWeather}><Plus size={12} className="mr-1"/> 添加状态</Button>
                                         </div>
                                         <div className="bg-slate-950 p-4 rounded border border-slate-800">
                                             <div className="mb-4 border-b border-slate-800 pb-4">
                                                 <div className="flex justify-between items-center mb-2">
                                                     <Label>状态变化概率 (每轮结算)</Label>
                                                     <span className="text-xs text-teal-400 font-mono font-bold">
                                                         {(localDefaults.weatherChangeProbability || 0.1) * 100}%
                                                     </span>
                                                 </div>
                                                 <input 
                                                     type="range" 
                                                     min="0" max="1" step="0.01"
                                                     className="w-full accent-teal-500"
                                                     value={localDefaults.weatherChangeProbability ?? 0.1}
                                                     onChange={e => setLocalDefaults(prev => ({
                                                         ...prev,
                                                         weatherChangeProbability: parseFloat(e.target.value)
                                                     }))}
                                                 />
                                                 <p className="text-[10px] text-slate-500 mt-1">每一轮结束时触发世界状态重新随机的概率。设为 0 则完全不自动变化。</p>
                                             </div>

                                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                  {localDefaults.weatherConfig.map((w, idx) => (
                                                      <div key={idx} className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-800">
                                                          <Input value={w.name} onChange={e => updateWeather(idx, 'name', e.target.value)} placeholder="名称" className="flex-1"/>
                                                          <div className="flex items-center gap-1">
                                                              <span className="text-xs text-slate-500">权重:</span>
                                                              <Input type="number" value={w.weight} onChange={e => updateWeather(idx, 'weight', parseFloat(e.target.value))} className="w-16"/>
                                                          </div>
                                                          <button onClick={() => removeWeather(idx)} className="text-slate-500 hover:text-red-400 p-1"><Trash size={14}/></button>
                                                      </div>
                                                  ))}
                                             </div>
                                         </div>
                                    </div>

                                    {/* Global Context Section */}
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center">
                                            <Label className="text-blue-400 uppercase tracking-wider font-bold">全局上下文工程 (Global Context)</Label>
                                            <Button size="sm" variant="secondary" onClick={addContextMsg}><Plus size={12} className="mr-1"/> 添加消息</Button>
                                        </div>
                                        
                                        <div className="space-y-2">
                                            {localContext.messages.map((msg, idx) => (
                                                <div key={idx} className="bg-gray-950 p-3 rounded border border-slate-800 flex flex-col gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-24 shrink-0">
                                                            <select 
                                                                className="w-full bg-slate-900 border border-slate-700 rounded px-1 py-1 text-xs text-slate-300"
                                                                value={msg.role}
                                                                onChange={e => updateContextMsg(idx, 'role', e.target.value)}
                                                            >
                                                                <option value="user">User</option>
                                                                <option value="model">Assistant</option>
                                                                <option value="system">System</option>
                                                            </select>
                                                        </div>
                                                        <div className="flex-1"></div>
                                                        <button onClick={() => removeContextMsg(idx)} className="text-slate-600 hover:text-red-400"><Trash size={14}/></button>
                                                    </div>
                                                    <TextArea 
                                                        className="min-h-[100px] resize-y font-mono text-xs"
                                                        value={msg.content}
                                                        onChange={e => updateContextMsg(idx, 'content', e.target.value)}
                                                        placeholder="输入上下文内容..."
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-800 bg-slate-900 rounded-b-lg flex justify-end gap-2 shrink-0">
                    <Button variant="secondary" onClick={onClose}>取消</Button>
                    <Button onClick={() => onSave(localSettings, localJudge, localContext, localDefaults, localDevMode)}>保存全局设置</Button>
                </div>
            </div>
        </div>
    );
};
