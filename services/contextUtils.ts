
import { AttributeVisibility, Card, Character, ContextSegment, GameAttribute, MapLocation, MapRegion, PrizePool } from "../types";

// --- Visibility Logic ---
export const getVisibleAttributes = (observerId: string, targetId: string, attributes: Record<string, GameAttribute>): Record<string, any> => {
    const filtered: Record<string, any> = {};
    
    // Environment characters (starting with env_) and 'system' have God View
    // They can see all attributes regardless of visibility settings.
    const hasGodView = observerId === 'system' || observerId.startsWith('env_');
    
    // A character can always see their own private attributes.
    const isSelf = observerId === targetId;

    Object.values(attributes).forEach(attr => {
        // Logic:
        // 1. If God View, show all.
        // 2. If Self, show all.
        // 3. If Public, show all.
        if (hasGodView || isSelf || attr.visibility === AttributeVisibility.PUBLIC) {
            filtered[attr.name] = {
                value: attr.value,
                type: attr.type,
            };
        } else {
            // 4. Otherwise (Private & Not Self & Not God):
            // Expose the existence of the attribute (Name/Type) but mask the Value.
            // This prevents the AI from hallucinating that the concept doesn't exist in this world.
            filtered[attr.name] = {
                value: "??? (未知/Hidden)",
                type: attr.type,
            };
        }
    });
    return filtered;
};

// --- Helper: Filter World Attributes (Remove Time) ---
export const filterWorldAttributes = (attributes: Record<string, GameAttribute>, includeTime: boolean = false): Record<string, any> => {
    const result: Record<string, any> = {};
    Object.values(attributes).forEach(attr => {
        if (!includeTime && attr.name === '世界时间' || attr.id === 'worldTime') {
            // Skip time unless requested
            return;
        }
        result[attr.name] = {
            value: attr.value,
            type: attr.type
        };
    });
    return result;
};

// --- Helper: Effect Formatter ---
const formatEffects = (effects: any[]) => {
    if (!effects || effects.length === 0) return "无特殊效果";
    return effects.map(e => {
        let targetStr = e.targetType;
        if (e.targetType === 'specific_char') targetStr = '指定目标';
        else if (e.targetType === 'self') targetStr = '自身';
        else if (e.targetType === 'world') targetStr = '世界环境';
        else if (e.targetType === 'ai_choice') targetStr = 'AI选择';
        else if (e.targetType === 'all_chars') targetStr = '全员';
        else if (e.targetType === 'hit_target') targetStr = '命中目标';
        
        const valStr = e.dynamicValue ? 'AI决定' : e.value;
        
        // Include condition if it's meaningful
        let condStr = "";
        if (e.conditionDescription && e.conditionDescription !== "True" && e.conditionDescription !== "无" && !e.conditionDescription.includes("默认为真")) {
            condStr = ` | 判定条件: ${e.conditionDescription}`;
        }

        return `[${e.targetAttribute} ${Number(valStr) > 0 ? '+' : ''}${valStr} 作用于 ${targetStr}${condStr}]`;
    }).join(', ');
};

// --- Strict Context Formatters ---

export const formatCharacterPersona = (char: Character): string => {
    return `
--- 角色与设定 ---
姓名: ${char.name} (ID: ${char.id})
[外观 (公开)]: ${char.appearance || "暂无外观描述"}
[描述/性格 (隐私)]:
${char.description || "无描述。"}
`.trim();
};

// Renamed from formatLocationAndWorld to reflect it only handles Location now
export const formatLocationInfo = (location: MapLocation | undefined): string => {
    return `
--- 当前地点 ---
地点: ${location ? `${location.name} (X:${location.coordinates.x.toFixed(0)}, Y:${location.coordinates.y.toFixed(0)})` : "未知 / 荒野"}
描述: ${location ? location.description : "你正身处荒野之中。"}
`.trim();
};

export const formatKnownRegions = (regions: Record<string, MapRegion> | undefined): string => {
    if (!regions) return "暂无已探明的宏观区域信息。";
    const list = Object.values(regions);
    if (list.length === 0) return "暂无已探明的宏观区域信息。";
    return list.map(r => `* 【${r.name}】: ${r.description}`).join('\n');
};

export const formatPrizePools = (
    pools: Record<string, PrizePool> | undefined, 
    currentLocationId: string | undefined,
    allLocations: Record<string, MapLocation> | undefined
): string => {
    if (!pools) return "(无可用奖池)";
    const list = Object.values(pools);
    if (list.length === 0) return "(无可用奖池)";
    
    // Sort: Local pools first
    const localPools: PrizePool[] = [];
    const remotePools: PrizePool[] = [];

    list.forEach(p => {
        // Check if pool has location constraint
        if (currentLocationId && p.locationIds && p.locationIds.includes(currentLocationId)) {
            localPools.push(p);
        } else {
            remotePools.push(p);
        }
    });

    let output = "";

    if (localPools.length > 0) {
        output += "[当前地点可用奖池]\n";
        output += localPools.map(p => {
            const limits = `(抽取限制: ${p.minDraws || 1}-${p.maxDraws || 1})`;
            return `* [ID:${p.id}] ${p.name} ${limits} : ${p.description}`;
        }).join('\n');
    } else {
        output += "[当前地点可用奖池]\n(无)";
    }

    if (remotePools.length > 0) {
        output += "\n[传闻中的其他奖池 (不可操作)]\n";
        output += remotePools.map(p => {
            const locNames = (p.locationIds || []).map(lid => allLocations && allLocations[lid] ? allLocations[lid].name : "未知").join(', ');
            return `* ${p.name} (位于: ${locNames || '未知'})`;
        }).join('\n');
    }

    return output;
};

export const formatOtherCharacters = (charId: string, allChars: Character[], currentLocId?: string, cardPool: Card[] = []): string => {
    // Filter characters in the same location (or close by) - Logic usually handled by caller, but filter ID here
    const nearby = allChars.filter(c => c.id !== charId); 
    
    if (nearby.length === 0) return "\n--- 其他角色 ---\n(无可见角色)";

    // Is observer an Environment Character (God View)?
    const isEnvironment = charId.startsWith('env_');

    const othersStr = nearby.map(c => {
        const attrs = getVisibleAttributes(charId, c.id, c.attributes);
        
        // Combine skills and inventory cards
        const allCards = [
            ...c.skills,
            ...c.inventory.map(id => cardPool.find(cp => cp.id === id)).filter(Boolean) as Card[]
        ];

        // Filter Cards Visibility
        // 1. Not Hidden Settlement (Secret) - unless it's the Environment seeing it
        // 2. Not Private Visibility - unless it's the Environment seeing it
        const visibleCards = allCards.filter(card => {
            const isSecret = card.triggerType === 'hidden_settlement';
            const isPrivate = card.visibility === AttributeVisibility.PRIVATE;
            
            // Environment sees everything
            if (isEnvironment) return true;

            // Regular chars don't see secret or private cards of others
            if (isSecret) return false;
            if (isPrivate) return false;

            return true; 
        });

        const cardListStr = visibleCards.length > 0
            ? visibleCards.map(card => {
                let typeLabel = '';
                if (card.triggerType === 'active') typeLabel = '主动';
                else if (card.triggerType === 'reaction') typeLabel = '反应';
                else if (card.triggerType === 'passive') typeLabel = '被动';
                else typeLabel = '结算';

                // Include description for context so AI can "play cards" against each other
                return `  * [${typeLabel}] ${card.name}: ${card.description}`;
            }).join('\n')
            : "  (无可见能力/物品)";

        // Explicitly include Appearance. 
        // If it's missing, provide a fallback.
        const appearanceStr = c.appearance || "(模糊的身影)";

        // Include Conflicts (New Feature)
        // Updated to use specific character name instead of generic [他人矛盾]
        const conflictStr = c.conflicts && c.conflicts.length > 0
            ? c.conflicts.filter(conf => !conf.solved).map(conf => `  ! [${c.name}的矛盾] ${conf.desc}`).join('\n')
            : "  (无活跃矛盾)";

        return `> ${c.name} (ID: ${c.id}): 
  [外观]: ${appearanceStr}
  - 属性: ${JSON.stringify(attrs)}
  - 已知能力/物品:
${cardListStr}
  - 当前状态/矛盾:
${conflictStr}`;
    }).join('\n');

    return `
--- 其他角色 (Other Characters) ---
(注意：你可以看到他人的[活跃矛盾]，这代表了该角色当前面临的困境或剧情驱动力。)
${othersStr}
`.trim();
};

export const formatSelfDetailed = (char: Character, cardPool: Card[], locationId?: string): string => {
    const attrs = getVisibleAttributes(char.id, char.id, char.attributes);
    
    // 1. Goals / CP Triggers
    const goals = (char.drives && char.drives.length > 0)
        ? char.drives.map(t => `- 条件: "${t.condition}" (奖励: ${t.amount})`).join('\n')
        : "- 无特定目标。";
        
    // 2. Conflicts
    const conflicts = char.conflicts && char.conflicts.length > 0
        ? char.conflicts.filter(c => !c.solved).map(c => `! [自身矛盾] ${c.desc}`).join('\n')
        : "- 无活跃矛盾。";

    // 3. Cards Logic - Separate Active/Reaction vs Passive/Settlement
    // AND distinguish between Innate vs Inventory
    
    interface CardEntry { card: Card; source: '固有' | '背包'; }
    
    const allEntries: CardEntry[] = [];
    
    // Add Skills
    char.skills.forEach(c => allEntries.push({ card: c, source: '固有' }));
    
    // Add Inventory
    char.inventory.forEach(id => {
        const c = cardPool.find(item => item.id === id);
        if (c) allEntries.push({ card: c, source: '背包' });
    });

    const activeEntries = allEntries.filter(e => e.card.triggerType === 'active' || e.card.triggerType === 'reaction');
    const passiveEntries = allEntries.filter(e => e.card.triggerType !== 'active' && e.card.triggerType !== 'reaction');

    const activeStr = activeEntries.length > 0
        ? activeEntries.map(e => {
            const c = e.card;
            const triggerLabel = c.triggerType === 'reaction' ? '[反应]' : '[主动]';
            return `  * [ID:${c.id}] [${e.source}] ${triggerLabel} ${c.name} (${c.itemType}) : ${c.description} | 消耗:${c.cost} | ${formatEffects(c.effects)}${c.visibility === AttributeVisibility.PRIVATE ? ' [隐藏]' : ''}`
        }).join('\n')
        : "  (无可用行动)";

    const passiveStr = passiveEntries.length > 0
        ? passiveEntries.map(e => {
            const c = e.card;
            return `  * [ID:${c.id}] [${e.source}] ${c.name} (${c.triggerType}) : ${c.description} | ${formatEffects(c.effects)}${c.visibility === AttributeVisibility.PRIVATE ? ' [隐藏]' : ''}`
        }).join('\n')
        : "  (无)";

    return `
--- 自身信息 (Self) ---
LocationID: ${locationId || 'Unknown'}
[外观]: ${char.appearance || "(未设定)"}
属性: ${JSON.stringify(attrs)}

[目标 / 驱力 (Drives)]
${goals}

[当前矛盾 (Self Conflicts)]
${conflicts}

[主动/反应行动 (本轮可用)]
(注意：只有标记为 [背包] 的物品可以被【放入】奖池。标记为 [固有] 的能力不可放入。)
${activeStr}

[被动/结算效果 (自动触发 - 请勿手动使用)]
${passiveStr}
`.trim();
};
