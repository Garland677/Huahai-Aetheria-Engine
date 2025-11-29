
import React, { useState } from 'react';
import { GameState, GameAttribute, AttributeType, AttributeVisibility } from '../../types';
import { Button, Input, Label } from '../ui/Button';
import { X, Save, Globe, Plus, Trash, Eye, EyeOff } from 'lucide-react';

interface WorldEditorProps {
  gameState: GameState;
  onSave: (newAttributes: Record<string, GameAttribute>) => void;
  onClose: () => void;
}

export const WorldEditor: React.FC<WorldEditorProps> = ({ gameState, onSave, onClose }) => {
  const [attributes, setAttributes] = useState<Record<string, GameAttribute>>(JSON.parse(JSON.stringify(gameState.world.attributes)));

  const updateAttr = (key: string, field: keyof GameAttribute, val: any) => {
      setAttributes(prev => ({
          ...prev,
          [key]: { ...prev[key], [field]: val }
      }));
  };

  const addAttribute = () => {
      const id = `w_attr_${Date.now()}`;
      setAttributes(prev => ({
          ...prev,
          [id]: { id, name: '新环境', type: AttributeType.TEXT, value: 'Normal', visibility: AttributeVisibility.PUBLIC }
      }));
  };

  const removeAttribute = (key: string) => {
      const newAttrs = { ...attributes };
      delete newAttrs[key];
      setAttributes(newAttrs);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 shadow-2xl rounded-lg flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950 rounded-t-lg shrink-0">
          <div className="flex items-center gap-2">
              <Globe className="text-indigo-400" size={20}/>
              <h2 className="font-bold text-lg text-slate-100">编辑世界状态</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
            <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">定义全局可见或隐藏的环境变量。</span>
                <Button size="sm" variant="secondary" onClick={addAttribute}><Plus size={12} className="mr-1"/> 添加属性</Button>
            </div>

            <div className="space-y-2">
              {(Object.entries(attributes) as [string, GameAttribute][]).map(([key, attr]) => (
                  <div key={key} className="bg-gray-950 p-3 rounded border border-slate-800 flex flex-col gap-2">
                       <div className="flex gap-2 items-center">
                          <Input 
                              className="h-8 w-1/3"
                              value={attr.name}
                              onChange={e => updateAttr(key, 'name', e.target.value)}
                              placeholder="名称"
                          />
                          <Input 
                              className="h-8 flex-1"
                              value={attr.value}
                              onChange={e => updateAttr(key, 'value', attr.type === AttributeType.NUMBER ? e.target.value : e.target.value)}
                              placeholder="值"
                          />
                           <button 
                              onClick={() => updateAttr(key, 'visibility', attr.visibility === AttributeVisibility.PUBLIC ? AttributeVisibility.PRIVATE : AttributeVisibility.PUBLIC)}
                              className={`p-1.5 rounded ${attr.visibility === AttributeVisibility.PUBLIC ? 'text-green-400 hover:bg-green-900/30' : 'text-red-400 hover:bg-red-900/30'}`}
                              title={attr.visibility === AttributeVisibility.PUBLIC ? "公开" : "隐藏"}
                          >
                              {attr.visibility === AttributeVisibility.PUBLIC ? <Eye size={14}/> : <EyeOff size={14}/>}
                          </button>
                          <button onClick={() => removeAttribute(key)} className="text-slate-500 hover:text-red-400 p-1.5"><Trash size={14}/></button>
                       </div>
                       <div className="flex gap-4 text-[10px] text-slate-500 px-1">
                          <label className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={attr.type === AttributeType.TEXT} onChange={() => updateAttr(key, 'type', AttributeType.TEXT)}/> 文本
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={attr.type === AttributeType.NUMBER} onChange={() => updateAttr(key, 'type', AttributeType.NUMBER)}/> 数字
                          </label>
                       </div>
                  </div>
              ))}
            </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950 rounded-b-lg flex justify-end gap-2 shrink-0">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={() => onSave(attributes)}><Save size={16} className="mr-2"/> 保存状态</Button>
        </div>
      </div>
    </div>
  );
};
