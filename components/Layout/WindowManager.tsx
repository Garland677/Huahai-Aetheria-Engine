import React from 'react';
import { GameState, WindowState, Character, Card, GameAttribute, AppSettings, AIConfig, GlobalContextConfig, DefaultSettings, LogEntry, DebugLog } from '../../types';
import { CharacterEditor } from '../Windows/CharacterEditor';
import { CardEditor } from '../Windows/CardEditor';
import { WorldEditor } from '../Windows/WorldEditor';
import { SettingsWindow } from '../Windows/SettingsWindow';
import { DevConsole } from '../Windows/DevConsole';
import { CharacterPoolWindow, CardPoolWindow, LocationPoolWindow, AiGenWindow } from '../Windows/PoolWindows';
import { PrizePoolWindow } from '../Windows/PrizePoolWindow'; 
import { TriggerPoolWindow } from '../Windows/TriggerPoolWindow'; // New
import { ShopWindow } from '../Windows/ShopWindow';

interface WindowManagerProps {
    windows: WindowState[];
    closeWindow: (id: number) => void;
    state: GameState;
    updateState: (updater: (current: GameState) => GameState) => void;
    openWindow: (type: WindowState['type'], data?: any) => void;
    addLog: (text: string, overrides?: Partial<LogEntry>) => void;
    selectedCharId: string | null;
    addDebugLog: (log: DebugLog) => void; // New Prop
}

export const WindowManager: React.FC<WindowManagerProps> = ({ 
    windows, closeWindow, state, updateState, openWindow, addLog, selectedCharId, addDebugLog
}) => {

  const handleSaveCharacter = (char: Character, locationId?: string) => {
    // Diff Logic to detect manual changes
    const oldChar = state.characters[char.id];
    let changesLog = "";
    let locationChanged = false;
    
    if (oldChar) {
        const changes: string[] = [];
        
        // Name/Desc
        if (oldChar.name !== char.name) changes.push(`姓名 '${oldChar.name}'->'${char.name}'`);
        if (oldChar.description !== char.description) changes.push(`设定变更`);

        // Attributes
        Object.keys(char.attributes).forEach(key => {
             const oldVal = oldChar.attributes[key]?.value;
             const newVal = char.attributes[key]?.value;
             if (oldVal !== newVal) {
                 changes.push(`${char.attributes[key].name} ${oldVal}->${newVal}`);
             }
        });

        // Location
        const oldPos = state.map.charPositions[char.id];
        if (locationId && (!oldPos || oldPos.locationId !== locationId)) {
            const oldLocName = oldPos?.locationId ? state.map.locations[oldPos.locationId]?.name : "未知";
            const newLocName = state.map.locations[locationId]?.name || locationId;
            changes.push(`位置转移 ${oldLocName}->${newLocName}`);
            locationChanged = true;
        }

        if (changes.length > 0) {
            changesLog = `因为神秘原因发生了如下意想不到的变化: ${changes.join(', ')}`;
        }
    }

    updateState(prev => {
      let finalChar = char;
      
      if (locationChanged) {
          let maxId = 0;
          (Object.values(prev.characters) as Character[]).forEach(c => {
              c.conflicts?.forEach(x => {
                  const n = parseInt(x.id);
                  if (!isNaN(n) && n > maxId) maxId = n;
              });
          });
          const nextId = maxId + 1;
          
          finalChar = {
              ...finalChar,
              conflicts: [
                  ...(finalChar.conflicts || []),
                  {
                      id: String(nextId),
                      desc: "刚到此地，对当地情况不熟悉",
                      apReward: 2,
                      solved: false
                  }
              ]
          };
      }

      const newChars = { ...prev.characters };
      newChars[finalChar.id] = finalChar;

      let newDefaultOrder = prev.round.defaultOrder;
      // Only add to default order if not present
      if (!newDefaultOrder.includes(finalChar.id)) {
           newDefaultOrder = [...newDefaultOrder, finalChar.id].sort((a,b) => Number(a) - Number(b));
      }
      
      // For initial adds, if order is empty, populate it
      let newCurrentOrder = prev.round.currentOrder;
      if (newCurrentOrder.length === 0) {
           newCurrentOrder = [finalChar.id];
      }

      // Update Location if provided
      const newCharPositions = { ...prev.map.charPositions };
      if (locationId) {
          const targetLoc = prev.map.locations[locationId];
          if (targetLoc) {
              newCharPositions[finalChar.id] = {
                  x: targetLoc.coordinates.x,
                  y: targetLoc.coordinates.y,
                  locationId: locationId
              };
          }
      }

      return {
        ...prev,
        characters: newChars,
        map: { ...prev.map, charPositions: newCharPositions },
        round: { ...prev.round, defaultOrder: newDefaultOrder, currentOrder: newCurrentOrder }
      };
    });
    
    if (changesLog) {
        // Log "Mysterious Change" visible to ALL at the location (standard system behavior)
        // We do NOT restrict visibility to [char.id] anymore.
        addLog(`系统: ${char.name} ${changesLog}`, { 
            locationId: locationId || state.map.activeLocationId, 
            type: 'system' 
        });
    }
    
    // Close the editor window
    const win = windows.find(w => w.type === 'char' && (w.data ? w.data.id === char.id : true));
    if(win) closeWindow(win.id);
    else windows.filter(w => w.type === 'char').forEach(w => closeWindow(w.id));
  };

  const handleSaveCard = (card: Card) => {
    updateState(prev => {
        const exists = prev.cardPool.some(c => c.id === card.id);
        return {
            ...prev,
            cardPool: exists ? prev.cardPool.map(c => c.id === card.id ? card : c) : [...prev.cardPool, card]
        }
    });
    windows.filter(w => w.type === 'card').forEach(w => closeWindow(w.id));
  };

  const handleSaveWorld = (attrs: Record<string, GameAttribute>) => {
      updateState(prev => ({
          ...prev,
          world: { ...prev.world, attributes: attrs }
      }));
      addLog("系统: 世界属性已被修正。");
      windows.filter(w => w.type === 'world').forEach(w => closeWindow(w.id));
  };

  const handleSaveSettings = (settings: AppSettings, judge: AIConfig, ctx: GlobalContextConfig, defaults: DefaultSettings, devMode: boolean) => {
      updateState(prev => ({
          ...prev,
          appSettings: settings,
          judgeConfig: judge,
          globalContext: ctx,
          defaultSettings: defaults,
          devMode: devMode
      }));
      addLog("系统: 引擎全局设置已更新。");
      windows.filter(w => w.type === 'settings').forEach(w => closeWindow(w.id));
  };
  
  const handleSyncAllChars = (config: AIConfig, settings?: AppSettings) => {
      updateState(prev => {
          // 1. Override all characters
          const newChars = { ...prev.characters };
          Object.keys(newChars).forEach(key => {
              newChars[key] = { ...newChars[key], aiConfig: { ...config } };
          });

          // 2. Update Global Judge & Settings (if provided)
          const newState = { 
              ...prev, 
              characters: newChars,
              judgeConfig: config 
          };

          if (settings) {
              newState.appSettings = settings;
          }
          return newState;
      });
      
      let msg = "系统: 全局判定模型及所有角色的 AI 配置已强制覆盖。";
      if (settings) msg += " (API Key 已同步)";
      addLog(msg);
  };

  return (
      <>
        {windows.map(win => (
          <div key={win.id}>
              {win.type === 'char' && (
                  <CharacterEditor 
                    character={win.data} 
                    gameState={state}
                    onClose={() => closeWindow(win.id)} 
                    onSave={handleSaveCharacter} 
                    onUpdatePoolCard={handleSaveCard}
                  />
              )}
              {win.type === 'card' && (
                  <CardEditor
                    gameState={state} 
                    onClose={() => closeWindow(win.id)}
                    onSave={handleSaveCard}
                  />
              )}
              {win.type === 'world' && (
                  <WorldEditor
                    gameState={state}
                    onClose={() => closeWindow(win.id)}
                    onSave={handleSaveWorld}
                  />
              )}
              {win.type === 'settings' && (
                  <SettingsWindow
                    settings={state.appSettings}
                    judgeConfig={state.judgeConfig!}
                    globalContext={state.globalContext}
                    defaultSettings={state.defaultSettings}
                    devMode={state.devMode}
                    onClose={() => closeWindow(win.id)}
                    onSave={handleSaveSettings}
                    onSyncAllChars={handleSyncAllChars}
                  />
              )}
              {win.type === 'pool' && (
                  <CardPoolWindow 
                    winId={win.id}
                    state={state}
                    updateState={updateState}
                    closeWindow={closeWindow}
                    openWindow={openWindow}
                    addLog={addLog}
                    selectedCharId={selectedCharId}
                    onSaveCard={handleSaveCard}
                  />
              )}
              {win.type === 'char_pool' && (
                  <CharacterPoolWindow 
                    winId={win.id} 
                    state={state}
                    updateState={updateState}
                    closeWindow={closeWindow}
                    openWindow={openWindow}
                    addLog={addLog}
                    selectedCharId={selectedCharId}
                    addDebugLog={addDebugLog} // Passed
                  />
              )}
              {win.type === 'char_gen' && (
                  <AiGenWindow
                    state={state}
                    updateState={updateState}
                    addLog={addLog}
                    onClose={() => closeWindow(win.id)}
                    isPlayerMode={true} // Dedicated Player Generation Mode
                    addDebugLog={addDebugLog} // Passed
                  />
              )}
              {win.type === 'location_pool' && (
                  <LocationPoolWindow
                    winId={win.id}
                    state={state}
                    updateState={updateState}
                    closeWindow={closeWindow}
                    openWindow={openWindow}
                    addLog={addLog}
                    selectedCharId={selectedCharId}
                  />
              )}
              {win.type === 'prize_pool' && (
                  <PrizePoolWindow
                    winId={win.id}
                    state={state}
                    updateState={updateState}
                    closeWindow={closeWindow}
                    addLog={addLog}
                  />
              )}
              {win.type === 'trigger_pool' && (
                  <TriggerPoolWindow
                    winId={win.id}
                    state={state}
                    updateState={updateState}
                    closeWindow={closeWindow}
                    addLog={addLog}
                  />
              )}
              {win.type === 'shop' && (
                  <ShopWindow
                    winId={win.id}
                    state={state}
                    updateState={updateState}
                    closeWindow={closeWindow}
                    addLog={addLog}
                    activeCharId={selectedCharId || undefined}
                  />
              )}
              {win.type === 'dev' && (
                  <DevConsole logs={state.debugLogs} onClose={() => closeWindow(win.id)} />
              )}
          </div>
      ))}
      </>
  );
};