

import { GameState, Character, MapLocation, MapRegion, AIConfig, DebugLog } from "../types";
import { 
    filterWorldAttributes, 
    formatCharacterPersona, 
    formatLocationInfo, 
    formatOtherCharacters, 
    formatSelfDetailed, 
    formatPrizePools, 
    formatRegionConflicts, 
    formatLifeTrajectoryNow, 
    getRoundParticipants, 
    formatCharacterSecrets,
    formatFavorTags,
    formatKnownRegions,
    formatAllTags
} from "./contextUtils";
import { replaceGlobalVariables, formatReaderComments, getPleasureInstruction } from "./ai/promptUtils";
import { ImageContextBuilder } from "./ai/ImageContextBuilder";
import { getGlobalMemory, getCharacterMemory } from "./ai/memoryUtils";
import { calculateLastPresentTime } from "./timeUtils";
import { getAttr } from "./attributeUtils";

/**
 * 宏执行上下文
 * 提供宏计算所需的运行时数据
 */
export interface MacroContext {
    gameState: GameState;
    activeCharId?: string;     // 当前视角的角色 (Actor)
    targetCharId?: string;     // 交互目标角色 (Target)
    activeLocationId?: string; // 当前所处地点
    imageBuilder?: ImageContextBuilder; // 用于注册图片
    aiConfig?: AIConfig;       // 用于读取读者评论等配置
    onDebug?: (log: DebugLog) => void; // 用于调试日志
    
    // 动态参数：用于传递无法从 GameState 直接推导的临时数据
    // 例如：用户输入的 prompt, 逻辑判定时的 items 列表, 生成地点时的坐标等
    dynamicParams?: Record<string, any>;
}

// 宏解析函数类型
type MacroResolver = (context: MacroContext) => string | Promise<string>;

/**
 * 辅助函数：获取当前角色对象
 */
const getActiveChar = (ctx: MacroContext): Character | undefined => {
    if (!ctx.activeCharId) return undefined;
    return ctx.gameState.characters[ctx.activeCharId];
};

/**
 * 辅助函数：获取当前地点对象
 */
const getActiveLocation = (ctx: MacroContext): MapLocation | undefined => {
    const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
    if (!locId) return undefined;
    return ctx.gameState.map.locations[locId];
};

/**
 * 辅助函数：获取当前区域对象
 */
const getActiveRegion = (ctx: MacroContext): MapRegion | undefined => {
    const loc = getActiveLocation(ctx);
    // 优先尝试从 dynamicParams 获取 region 信息 (用于地点生成时的新区域)
    if (ctx.dynamicParams?.regionInfo) {
        // Mock region object for macro usage if provided in params
        return {
            id: 'temp_region',
            name: ctx.dynamicParams.regionInfo.name,
            description: ctx.dynamicParams.regionInfo.description,
            vertices: [], center: {x:0,y:0}, color: ''
        };
    }
    
    if (!loc || !loc.regionId) return undefined;
    return ctx.gameState.map.regions[loc.regionId];
};

/**
 * 宏注册表
 * 集中定义所有系统级宏的计算逻辑
 */
const MACRO_REGISTRY: Record<string, MacroResolver> = {
    // --- 基础世界与规则 ---
    'TIME': (ctx) => {
        const val = ctx.gameState.world.attributes['worldTime']?.value;
        return val ? String(val) : "未知时间";
    },
    
    'WORLD_STATE': (ctx) => {
        const attrs = filterWorldAttributes(ctx.gameState.world.attributes);
        return JSON.stringify(attrs, null, 2);
    },
    
    'WORLD': (ctx) => {
        const attrs = filterWorldAttributes(ctx.gameState.world.attributes);
        return JSON.stringify(attrs, null, 2);
    },

    'COST': (ctx) => {
        return String(ctx.gameState.defaultSettings.gameplay.defaultCreationCost);
    },
    
    'WORLD_GUIDANCE': (ctx) => {
        // Core Update: Inject trigger guidance if available
        const base = ctx.gameState.world.worldGuidance || "";
        const triggerGuidance = ctx.dynamicParams?.triggerGuidance || "";
        return triggerGuidance ? `${base}\n${triggerGuidance}` : base;
    },

    // --- 角色基础信息 ---
    'CHAR_NAME': (ctx) => getActiveChar(ctx)?.name || "未知角色",
    'CHAR_ID': (ctx) => ctx.activeCharId || "unknown",
    'CHAR_DESC': (ctx) => getActiveChar(ctx)?.description || "无描述",
    
    'VIRTUAL_SPACE': (ctx) => {
        const char = getActiveChar(ctx);
        if (!char || !char.contextConfig || !char.contextConfig.messages || char.contextConfig.messages.length === 0) {
            return "";
        }
        const spaceContent = char.contextConfig.messages.map(msg => {
            const role = msg.role === 'model' ? 'model' : 'user';
            if (msg.role === 'system') return ""; 
            return `<${role}>\n${msg.content}\n</${role}>`;
        }).filter(Boolean).join('\n');
        
        return spaceContent;
    },

    'PLEASURE_GOAL': (ctx) => {
        const char = getActiveChar(ctx);
        if (!char) return "无目标";
        const settings = ctx.gameState.defaultSettings.gameplay;
        return getPleasureInstruction(char, settings);
    },

    // --- 角色详细设定 ---
    'SELF_CONTEXT': (ctx) => {
        const char = getActiveChar(ctx);
        if (!char) return "无角色信息";
        const locId = ctx.activeLocationId || ctx.gameState.map.charPositions[char.id]?.locationId;
        return formatSelfDetailed(char, ctx.gameState.cardPool, locId, ctx.imageBuilder);
    },

    'SPECIFIC_CONTEXT': (ctx) => {
        const char = getActiveChar(ctx);
        if (!char) return "无角色信息";
        return formatCharacterPersona(char, ctx.imageBuilder);
    },

    'SPECIFIC_SECRET': (ctx) => {
        const char = getActiveChar(ctx);
        if (!char) return "无秘密";
        return formatCharacterSecrets(char);
    },
    
    'SCENE_SECRETS': (ctx) => {
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        if (!locId) return "无秘密";
        
        const chars = Object.values(ctx.gameState.characters).filter(c => 
            ctx.gameState.map.charPositions[c.id]?.locationId === locId
        );
        
        if (chars.length === 0) return "无秘密";
        
        const secretsText = chars.map(c => {
             const text = formatCharacterSecrets(c);
             if (text.includes("无秘密") || text.includes("已公开")) return null;
             return `[${c.name}] ${text}`;
        }).filter(Boolean).join('\n\n');

        return secretsText || "无秘密";
    },
    
    'LAST_PRESENT_TIME': (ctx) => {
        const char = getActiveChar(ctx);
        if (!char) return "未知时间";
        const currentTimeStr = String(ctx.gameState.world.attributes['worldTime']?.value || "2077:01:01:00:00:00");
        return calculateLastPresentTime(
            char.id, 
            ctx.gameState.world.history, 
            currentTimeStr, 
            ctx.onDebug,
            { skipFirst: ctx.dynamicParams?.isStreaming } // Pass streaming flag
        );
    },

    'CHAR_TEMPLATE': (ctx) => {
        return JSON.stringify(ctx.gameState.defaultSettings.templates.character, null, 2);
    },

    // --- 角色人生轨迹 ---
    'LIFE_PAST': (ctx) => getActiveChar(ctx)?.lifeTrajectory?.past || "(无)",
    'LIFE_CURRENT': (ctx) => getActiveChar(ctx)?.lifeTrajectory?.current || "(无)",
    'LIFE_FUTURE': (ctx) => getActiveChar(ctx)?.lifeTrajectory?.future || "(无)",
    'LIFE_CHANGE': (ctx) => ctx.dynamicParams?.lifeChangeReason || "角色思想受到现实冲击，需要调整。",
    
    'MOVE_WILLING': (ctx) => {
        const currentLocId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        const list = Object.values(ctx.gameState.characters)
            .filter(c => {
                if (!c.movePlan || !c.movePlan.trim() || c.movePlan === '无计划' || c.movePlan === '无法移动') return false;
                const hpAttr = c.attributes['健康'] || c.attributes['health'] || c.attributes['Health'];
                if (hpAttr) {
                    const hp = Number(hpAttr.value);
                    if (!isNaN(hp) && hp <= 0) return false;
                }
                const pos = ctx.gameState.map.charPositions[c.id];
                if (currentLocId && pos && pos.locationId === currentLocId) return false;
                return true;
            })
            .map(c => `${c.id}: ${c.movePlan}`);
        return list.length > 0 ? list.join('\n') : "无移动意愿";
    },

    // --- 地理环境 ---
    'LOCATION_NAME': (ctx) => getActiveLocation(ctx)?.name || ctx.dynamicParams?.locationName || "未知地点",
    
    'LOCATION_CONTEXT': (ctx) => {
        const loc = getActiveLocation(ctx);
        return formatLocationInfo(loc, ctx.imageBuilder);
    },

    'REGION_NAME': (ctx) => getActiveRegion(ctx)?.name || ctx.dynamicParams?.regionName || "未知区域",
    'REGION_DESC': (ctx) => getActiveRegion(ctx)?.description || ctx.dynamicParams?.regionDesc || "无区域描述",
    'KNOWN_REGIONS': (ctx) => formatKnownRegions(ctx.gameState.map.regions),

    'NEARBY_CONTEXT': (ctx) => {
        if (ctx.dynamicParams?.nearbyContext) return String(ctx.dynamicParams.nearbyContext);
        const currentLocation = getActiveLocation(ctx);
        if (!currentLocation) return "未知";
        const nearbyKnown: string[] = [];
        Object.values(ctx.gameState.map.locations).forEach(l => {
            if (l.id === currentLocation.id) return;
            const dist = Math.sqrt((l.coordinates.x - currentLocation.coordinates.x)**2 + (l.coordinates.y - currentLocation.coordinates.y)**2);
            if (dist <= 1000 || (l.isKnown && l.regionId === currentLocation.regionId)) {
                const regionName = (l.regionId && ctx.gameState.map.regions[l.regionId]) 
                    ? ctx.gameState.map.regions[l.regionId].name 
                    : "未知区域";
                const visibility = l.isKnown ? "[已知]" : "[未知]";
                nearbyKnown.push(`${visibility} ${l.name} (位于: ${regionName})`);
            }
        });
        return nearbyKnown.length > 0 ? nearbyKnown.join(", ") : "（附近无已知地点）";
    },

    // 地点生成专用
    'NEARBY_LOCATIONS_CONTEXT': (ctx) => MACRO_REGISTRY['NEARBY_CONTEXT'](ctx), 
    'X': (ctx) => String(ctx.dynamicParams?.x ?? getActiveLocation(ctx)?.coordinates.x ?? 0),
    'Y': (ctx) => String(ctx.dynamicParams?.y ?? getActiveLocation(ctx)?.coordinates.y ?? 0),
    'Z': (ctx) => String(ctx.dynamicParams?.z ?? getActiveLocation(ctx)?.coordinates.z ?? 0),
    'REGION_STATS_CONTEXT': (ctx) => ctx.dynamicParams?.regionStats ? `区域统计: ${JSON.stringify(ctx.dynamicParams.regionStats)}` : "",
    'TERRAIN_ANALYSIS': (ctx) => ctx.dynamicParams?.terrainAnalysis ? JSON.stringify(ctx.dynamicParams.terrainAnalysis, null, 2) : "无地形数据",
    'LOCATION_INSTRUCTION': (ctx) => ctx.dynamicParams?.locationInstruction || "",
    'CULTURE_INSTRUCTION': (ctx) => ctx.dynamicParams?.cultureInstruction || "",
    'REGION_CONTEXT_INSTRUCTION': (ctx) => ctx.dynamicParams?.regionContextInstruction || "",
    'REGION_GEN_INSTRUCTION': (ctx) => ctx.dynamicParams?.regionGenInstruction || "",
    'CHARS_LIST': (ctx) => {
        if (ctx.dynamicParams?.charsList) return String(ctx.dynamicParams.charsList);
        if (ctx.dynamicParams?.existingCharsContext) return String(ctx.dynamicParams.existingCharsContext);
        return "";
    },

    // --- 社交与剧情 ---
    'OTHERS_CONTEXT': (ctx) => {
        if (ctx.dynamicParams?.othersContext) return String(ctx.dynamicParams.othersContext);
        const char = getActiveChar(ctx);
        if (!char) {
             const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
             if (!locId) return "无";
             const chars = Object.values(ctx.gameState.characters).filter(c => ctx.gameState.map.charPositions[c.id]?.locationId === locId);
             if (chars.length === 0) return "暂无角色";
             return chars.map(c => `${c.name}: ${c.description.substring(0,50)}...`).join('\n');
        }
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        const otherChars = Object.values(ctx.gameState.characters).filter(c => {
            if (c.id === char.id) return false;
            const pos = ctx.gameState.map.charPositions[c.id];
            return pos && pos.locationId === locId;
        });
        return formatOtherCharacters(char.id, otherChars, locId, ctx.gameState.cardPool, ctx.imageBuilder);
    },
    
    'EXISTING_CHARS': (ctx) => MACRO_REGISTRY['OTHERS_CONTEXT'](ctx), 
    'EXISTING_CHARS_CONTEXT': (ctx) => {
        if (ctx.dynamicParams?.existingCharsContext) return String(ctx.dynamicParams.existingCharsContext);
        return MACRO_REGISTRY['OTHERS_CONTEXT'](ctx);
    },
    
    'PLAYER_LIST': (ctx) => {
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        if (!locId) return "无";
        const players = Object.values(ctx.gameState.characters).filter(c => {
            const pos = ctx.gameState.map.charPositions[c.id];
            return c.isPlayer && pos && pos.locationId === locId;
        });
        if (players.length === 0) return "无";
        return players.map(c => c.name).join(", ");
    },

    'REGION_CONFLICT': (ctx) => {
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        const regionId = locId ? ctx.gameState.map.locations[locId]?.regionId : undefined;
        return formatRegionConflicts(locId, regionId, ctx.gameState.characters, ctx.gameState.map.locations, ctx.gameState.map.charPositions);
    },

    'CHAR_LIFE_NOW': (ctx) => {
        const turnParticipants = getRoundParticipants(ctx.gameState);
        const livingParticipants = turnParticipants.filter(c => {
            const hpAttr = getAttr(c, '健康');
            if (!hpAttr) return true;
            return Number(hpAttr.value) > 0;
        });
        return formatLifeTrajectoryNow(livingParticipants);
    },

    // --- 逻辑/ID引用 ---
    'CHAR_IDS': (ctx) => {
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        if (!locId) return "无";
        const chars = Object.values(ctx.gameState.characters).filter(c => ctx.gameState.map.charPositions[c.id]?.locationId === locId);
        // Returns ID (Name) format to help AI map names to IDs
        return chars.map(c => `${c.id} (${c.name})`).join('\n');
    },

    // --- 记忆与历史 ---
    'SHORT_HISTORY': (ctx) => {
        const history = ctx.gameState.world.history;
        if (history.length === 0) return "(暂无历史)";
        const currentRound = history[history.length - 1].round;
        const rounds = ctx.dynamicParams?.shortHistoryRounds || ctx.gameState.appSettings.maxShortHistoryRounds || 5;
        return getGlobalMemory(history, currentRound, rounds, ctx.gameState.appSettings.maxInputTokens, ctx.imageBuilder);
    },
    
    'HISTORY_CONTEXT': (ctx) => {
        const char = getActiveChar(ctx);
        if (!char) return "(无记忆)";
        const isEnv = char.id.startsWith('env_');
        let capacity = ctx.dynamicParams?.memoryRounds;
        if (capacity === undefined) {
             if (char.memoryConfig?.useOverride) {
                capacity = char.memoryConfig.maxMemoryRounds;
            } else if (isEnv) {
                capacity = ctx.gameState.appSettings.maxEnvMemoryRounds ?? 5;
            } else {
                capacity = ctx.gameState.appSettings.maxCharacterMemoryRounds;
            }
        }
        const locId = ctx.activeLocationId || ctx.gameState.map.charPositions[char.id]?.locationId;
        return getCharacterMemory(ctx.gameState.world.history, char.id, locId, capacity, ctx.imageBuilder, ctx.gameState.appSettings.maxInputTokens, ctx.gameState.characters, ctx.gameState.map.locations, char.previousLifeLogs);
    },

    'RECENT_HISTORY': (ctx) => MACRO_REGISTRY['HISTORY_CONTEXT'](ctx),

    // --- 标签与建议 ---
    'FAVOR_TAGS': (ctx) => formatFavorTags(ctx.gameState.world.storyTags),
    'ALL_TAGS': (ctx) => formatAllTags(ctx.gameState.world.storyTags),
    'FUN_SUGGEST': (ctx) => ctx.gameState.world.lastFunSuggest || "无",
    
    'READER_COMMENTS': (ctx) => {
        const config = ctx.aiConfig || ctx.gameState.charBehaviorConfig || ctx.gameState.judgeConfig;
        return formatReaderComments(config);
    },

    // --- 商店与抽奖 ---
    'PRIZE_POOLS': (ctx) => {
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        return formatPrizePools(ctx.gameState.prizePools, locId, ctx.gameState.map.locations);
    },
    'SHOP_CONTEXT': (ctx) => "（此处可列出商店物品，暂略）",

    // --- 逻辑判定 (Logic Check) 特有 ---
    'ENTITIES': (ctx) => ctx.dynamicParams?.entities ? JSON.stringify(ctx.dynamicParams.entities, null, 2) : "{}",
    'ITEMS': (ctx) => String(ctx.dynamicParams?.itemsStr || ""), 
    'CONDITION': (ctx) => String(ctx.dynamicParams?.conditionStr || ""), 
    
    'CONFLICTS_LIST': (ctx) => {
        const list = ctx.dynamicParams?.conflictsList;
        if (!list || !Array.isArray(list) || list.length === 0) return "无活跃矛盾";
        return list.map((item: any) => `${item.id}（${item.charName}）：${item.desc}`).join('\n');
    },

    'DRIVES_LIST': (ctx) => {
        const list = ctx.dynamicParams?.drivesList;
        if (!list || !Array.isArray(list) || list.length === 0) return "无活跃驱力";
        return list.map((item: any) => `${item.drive.id}（${item.charName}）：${item.drive.condition}`).join('\n');
    },
    
    'LANGUAGE_TRIGGER': (ctx) => {
        const triggers = Object.values(ctx.gameState.triggers || {});
        const langConditions: string[] = [];
        triggers.filter(t => t.enabled).forEach(t => {
            t.conditions.forEach(c => {
                if (c.type === 'natural_language') {
                    langConditions.push(`${c.id}：${c.targetName || '无描述'}`);
                }
            });
        });
        if (langConditions.length === 0) return "无自定义语言触发条件";
        return langConditions.join('\n');
    },

    // --- 回合顺序 (Turn Order) 特有 ---
    'TURN_LIST': (ctx) => {
        const order = ctx.gameState.round.currentOrder || [];
        if (order.length === 0) return "无";
        return order.map(id => ctx.gameState.characters[id]?.name || id).join(', ');
    },

    'ACTIVE_CHARS': (ctx) => {
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        if (!locId) return "";
        const chars = Object.values(ctx.gameState.characters).filter(c => ctx.gameState.map.charPositions[c.id]?.locationId === locId);
        return chars.map(c => c.id).join(", ");
    },
    'CHAR_LIST': (ctx) => {
        const locId = ctx.activeLocationId || ctx.gameState.map.activeLocationId;
        if (!locId) return "";
        const chars = Object.values(ctx.gameState.characters).filter(c => ctx.gameState.map.charPositions[c.id]?.locationId === locId);
        return chars.map(c => `${c.name} (ID:${c.id})`).join("\n");
    },

    // --- 交互输入 (Inputs) ---
    'TRIGGER_EVENT': (ctx) => String(ctx.dynamicParams?.triggerEvent || ""),
    'QUERY': (ctx) => String(ctx.dynamicParams?.query || ""),
    'DESC': (ctx) => String(ctx.dynamicParams?.desc || ""),
    'STYLE': (ctx) => String(ctx.dynamicParams?.style || ""),
    'USER_REQUEST': (ctx) => String(ctx.dynamicParams?.userRequest || ""),
    'JSON_STRUCTURE_EXAMPLE': (ctx) => String(ctx.dynamicParams?.jsonStructureExample || ""),
    'SELECTED_LOGS': (ctx) => String(ctx.dynamicParams?.selectedLogs || ""),
    'TARGET_CHARS': (ctx) => String(ctx.dynamicParams?.targetCharsContext || ""),
    'SUGGESTED_NAMES': (ctx) => Array.isArray(ctx.dynamicParams?.suggestedNames) ? ctx.dynamicParams?.suggestedNames.join(", ") : "",

    // --- Legacy Aliases ---
    'PERSONA': (ctx) => MACRO_REGISTRY['SPECIFIC_CONTEXT'](ctx),
    'HISTORY': (ctx) => MACRO_REGISTRY['SHORT_HISTORY'](ctx),
    'SELF_STATUS': (ctx) => MACRO_REGISTRY['SELF_CONTEXT'](ctx),
    'OTHERS': (ctx) => MACRO_REGISTRY['OTHERS_CONTEXT'](ctx),
    'SKILLS': (ctx) => MACRO_REGISTRY['SELF_CONTEXT'](ctx),
    'POOL': (ctx) => MACRO_REGISTRY['PRIZE_POOLS'](ctx),
};

export const processMacros = (text: string, context: MacroContext): string => {
    if (!text) return "";
    let result = replaceGlobalVariables(text, context.gameState.appSettings);
    result = result.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
        const resolver = MACRO_REGISTRY[key];
        if (resolver) {
            try {
                const val = resolver(context);
                return String(val);
            } catch (e) {
                console.error(`Macro resolve error [${key}]:`, e);
                return `[Error: ${key}]`;
            }
        }
        return match;
    });
    return result;
};

export const hasMacro = (text: string, macroKey: string): boolean => {
    return text.includes(`{{${macroKey}}}`);
};
