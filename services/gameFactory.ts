
import { GameState, LogEntry, PrizePool, InitialWorldConfig, Provider } from '../types';
import { initialWorldAttributes } from '../constants';
import { DEFAULT_API_CONFIG } from '../config';
import { generateInitialMap } from './mapUtils';
import { INITIAL_DEFAULT_SETTINGS } from './DefaultSettings';
import { DEFAULT_THEME_CONFIG } from './themeService';

export const createInitialGameState = (initialWorldConfig?: InitialWorldConfig): GameState => {
  const { map, characters } = generateInitialMap(initialWorldConfig || INITIAL_DEFAULT_SETTINGS.initialWorldConfig);
  
  const initialLog: LogEntry = {
      id: `log_init_${Date.now()}`,
      round: 1,
      turnIndex: 0,
      content: "系统: 欢迎使用花海引擎。",
      timestamp: Date.now(),
      type: 'system',
      snapshot: {
          roundNumber: 1, turnIndex: 0, phase: 'init', currentOrder: [], defaultOrder: [], 
          isReverse: false, isPaused: true, autoAdvance: false, autoAdvanceCount: 0, actionPoints: 50
      }
  };

  const startLog: LogEntry = {
      id: `log_start_${Date.now()}`,
      round: 1,
      turnIndex: 0,
      content: "--- 第 1 轮 开始 ---",
      timestamp: Date.now() + 1,
      type: 'system',
      snapshot: {
          roundNumber: 1, turnIndex: 0, phase: 'init', currentOrder: [], defaultOrder: [], 
          isReverse: false, isPaused: true, autoAdvance: false, autoAdvanceCount: 0, actionPoints: 50
      }
  };

  const startLocId = map.activeLocationId || 'loc_start_0_0';

  const defaultPrizePool: PrizePool = {
      id: 'pool_01',
      name: '神秘补给箱',
      description: '散落在世界各地的旧世界补给箱，里面可能含有有用的物资，也可能只有垃圾。',
      locationIds: [startLocId],
      items: [
          { id: 'item_01', name: '过期罐头', description: '虽然过期了，但也许还能吃...', weight: 50 },
          { id: 'item_02', name: '生锈的匕首', description: '一把勉强能用的防身武器。', weight: 30 },
          { id: 'item_03', name: '急救包', description: '珍贵的医疗物资。', weight: 15 },
          { id: 'item_04', name: '旧世界芯片', description: '珍贵的科技数据。', weight: 5 }
      ]
  };

  return {
    world: {
      attributes: initialWorldAttributes,
      history: [startLog, initialLog],
      worldGuidance: "近未来背景，人口大幅缩减。城市科技高度发达，但充斥着欲望与犯罪。部分人自愿离开城市，在衰败的村镇或野外生活。一个地点应该与周边地点的文化与玩法不同。"
    },
    map,
    round: {
      roundNumber: 1,
      turnIndex: 0,
      phase: 'init',
      defaultOrder: [],
      currentOrder: [],
      isReverse: false,
      isPaused: true,
      autoAdvance: false,
      autoAdvanceCount: 0,
      actionPoints: 50,
      lastErrorMessage: undefined,
      useManualTurnOrder: false,
      isWaitingForManualOrder: false,
      skipSettlement: false,
      autoReaction: false, // Default to Manual Reaction
      isWorldTimeFlowPaused: false
    },
    characters,
    cardPool: [],
    prizePools: {
        [defaultPrizePool.id]: defaultPrizePool
    },
    triggers: {},
    judgeConfig: {
      provider: Provider.XAI,
      model: 'grok-4-1-fast-reasoning',
      temperature: 1
    },
    charGenConfig: {
      provider: Provider.XAI,
      model: 'grok-4-1-fast-reasoning',
      temperature: 1
    },
    charBehaviorConfig: {
      provider: Provider.XAI,
      model: 'grok-4-1-fast-reasoning',
      temperature: 1
    },
    globalContext: {
        messages: []
    },
    appSettings: {
        apiKeys: DEFAULT_API_CONFIG,
        maxOutputTokens: 2000, 
        maxInputTokens: 64000, 
        reactionContextTurns: 5,
        devOptionsUnlocked: false,
        devPassword: "",
        encryptSaveFiles: false,
        maxHistoryRounds: 20,
        maxShortHistoryRounds: 5,
        maxCharacterMemoryRounds: 10, 
        maxEnvMemoryRounds: 5, // Default 5 for env
        actionMemoryDropoutProbability: 0.34, // Default Action Dropout
        reactionMemoryDropoutProbability: 0.34, // Default Reaction Dropout
        saveExpirationDate: "",
        globalVariables: [],
        storyLogLightMode: false,
        themeConfig: DEFAULT_THEME_CONFIG,
        lockedFeatures: {
            cardPoolEditor: false,
            characterEditor: false,
            locationEditor: false,
            actionPoints: false,
            worldState: false,
            directorInstructions: false,
            prizePoolEditor: false,
            triggerEditor: false,
            mapView: false,
            modelInterface: false
        },
        imageSettings: {
            maxShortEdge: 896,
            maxLongEdge: 4480,
            compressionQuality: 0.8
        },
        useNativeChooser: false,
        enableStreaming: true,
        autoScrollOnNewLog: false
    },
    defaultSettings: INITIAL_DEFAULT_SETTINGS,
    devMode: false,
    debugLogs: []
  };
};
