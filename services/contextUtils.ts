
import { AttributeVisibility, Card, Character, ContextSegment, GameAttribute, MapLocation, MapRegion, PrizePool, CharPosition, GameImage, GameState, StoryTag } from "../types";
import { ImageContextBuilder } from "./ai/ImageContextBuilder";

// --- Visibility Logic ---
export const getVisibleAttributes = (observerId: string, targetId: string, attributes: Record<string, GameAttribute>): Record<string, any> => {
    const filtered: Record<string, any> = {};
    const hasGodView = observerId === 'system' || observerId.startsWith('env_');
    const isSelf = observerId === targetId;

    Object.values(attributes).forEach(attr => {
        if (hasGodView || isSelf || attr.visibility === AttributeVisibility.PUBLIC) {
            filtered[attr.name] = {
                value: attr.value,
                type: attr.type,
            };
        } else {
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
        
        let condStr = "";
        if (e.conditionDescription && e.conditionDescription !== "True" && e.conditionDescription !== "无" && !e.conditionDescription.includes("默认为真")) {
            condStr = ` | 判定条件: ${e.conditionDescription}`;
        }

        return `[${e.targetAttribute} ${Number(valStr) > 0 ? '+' : ''}${valStr} 作用于 ${targetStr}${condStr}]`;
    }).join(', ');
};

// --- Strict Context Formatters with Inline Image Support ---

export const formatCharacterSecrets = (char: Character): string => {
    if (!char.secrets || char.secrets.length === 0) return "无秘密。";
    
    // Filter unsolved secrets to warn AI
    const unsolvedSecrets = char.secrets.filter(s => !s.solved);
    
    if (unsolvedSecrets.length === 0) return "所有秘密均已公开。";

    const secretList = unsolvedSecrets.map(s => 
        `- 秘密问题: "${s.question}" (答案: ${s.correctAnswer})`
    ).join('\n');

    return `
注意！角色拥有以下未解开的秘密，请在描写时保持神秘感，不要直接泄露答案，除非角色在极度信任或被迫的情况下：
${secretList}
`.trim();
};

export const formatCharacterPersona = (char: Character, imageBuilder?: ImageContextBuilder): string => {
    // Removed appearanceImagesStr as it's handled in formatSelfDetailed (SELF_CONTEXT)
    const descImagesStr = imageBuilder?.registerList(char.descriptionImages, "设定参考图") || "";

    return `
--- 角色与设定 ---
姓名: ${char.name} (ID: ${char.id})
[描述/性格 (隐私)]:
${char.description || "无描述。"}${descImagesStr}
`.trim();
};

export const formatLocationInfo = (location: MapLocation | undefined, imageBuilder?: ImageContextBuilder): string => {
    const locImagesStr = imageBuilder && location ? imageBuilder.registerList(location.images, "地点参考图") : "";

    return `
--- 当前地点 ---
地点: ${location ? `${location.name} (X:${location.coordinates.x.toFixed(0)}, Y:${location.coordinates.y.toFixed(0)})` : "未知 / 荒野"}
描述: ${location ? location.description : "你正身处荒野之中。"}${locImagesStr}
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
    
    const localPools: PrizePool[] = [];
    const remotePools: PrizePool[] = [];

    list.forEach(p => {
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

export const formatRegionConflicts = (
    currentLocId: string | undefined,
    regionId: string | undefined,
    characters: Record<string, Character>,
    locations: Record<string, MapLocation>,
    charPositions: Record<string, CharPosition>
): string => {
    if (!regionId) return "(无区域信息或位于荒野)";
    
    const list: string[] = [];
    
    Object.values(characters).forEach(c => {
        const pos = charPositions[c.id];
        if (!pos || !pos.locationId) return;
        if (pos.locationId === currentLocId) return;
        
        const loc = locations[pos.locationId];
        if (!loc || loc.regionId !== regionId) return;

        if (c.conflicts && c.conflicts.length > 0) {
            c.conflicts.forEach(conf => {
                if (!conf.solved) {
                    list.push(`[${loc.name}] [${c.name}]: ${conf.desc}`);
                }
            });
        }
    });

    if (list.length === 0) return "(区域内无其他活跃矛盾)";
    
    if (list.length > 20) {
        return list.slice(0, 20).join('\n') + `\n...以及更多 (${list.length - 20} 条)`;
    }
    
    return list.join('\n');
};

export const formatOtherCharacters = (
    charId: string, 
    allChars: Character[], 
    currentLocId?: string, 
    cardPool: Card[] = [],
    imageBuilder?: ImageContextBuilder
): string => {
    const nearby = allChars.filter(c => c.id !== charId); 
    
    if (nearby.length === 0) return "\n--- 其他角色 ---\n(无可见角色)";

    const isEnvironment = charId.startsWith('env_');

    const othersStr = nearby.map(c => {
        const attrs = getVisibleAttributes(charId, c.id, c.attributes);
        
        // Convert attributes object to Natural Language List
        const attrLines = Object.entries(attrs)
            .map(([k, v]) => `    ${k}: ${v.value}`)
            .join('\n');
        
        const allCards = [
            ...c.skills,
            ...c.inventory.map(id => cardPool.find(cp => cp.id === id)).filter(Boolean) as Card[]
        ];

        const visibleCards = allCards.filter(card => {
            const isSecret = card.triggerType === 'hidden_settlement';
            const isPrivate = card.visibility === AttributeVisibility.PRIVATE;
            if (isEnvironment) return true;
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
                return `  * [${typeLabel}] ${card.name}: ${card.description}`;
            }).join('\n')
            : "  (无可见能力/物品)";

        const appearanceStr = c.appearance || "(模糊的身影)";
        
        // Inline Image for Other Characters
        let charImageStr = "";
        if (imageBuilder && c.appearanceImages && c.appearanceImages.length > 0) {
            charImageStr = " " + c.appearanceImages.map(img => imageBuilder.register(img)).join(" ");
        }

        const conflictStr = c.conflicts && c.conflicts.length > 0
            ? c.conflicts.filter(conf => !conf.solved).map(conf => `  ! [${c.name}的矛盾] ${conf.desc}`).join('\n')
            : "  (无活跃矛盾)";

        return `> ${c.name} (ID: ${c.id}): 
  [外观]: ${appearanceStr}${charImageStr}
  [属性]:
${attrLines}
  - 已知能力/物品:
${cardListStr}
  - 当前状态/矛盾:
${conflictStr}`;
    }).join('\n');

    return `
--- 其他角色 (Other Characters) ---
(注意：你可以看到他人的[活跃矛盾]，这代表了该角色当前面临的困境。)
${othersStr}
`.trim();
};

export const formatSelfDetailed = (
    char: Character, 
    cardPool: Card[], 
    locationId?: string,
    imageBuilder?: ImageContextBuilder
): string => {
    const attrs = getVisibleAttributes(char.id, char.id, char.attributes);
    
    // Convert attributes object to Natural Language List
    const attrLines = Object.entries(attrs)
        .map(([k, v]) => `${k}: ${v.value}`)
        .join('\n');
        
    const conflicts = char.conflicts && char.conflicts.length > 0
        ? char.conflicts.filter(c => !c.solved).map(c => `! [自身矛盾] ${c.desc}`).join('\n')
        : "- 无活跃矛盾。";

    interface CardEntry { card: Card; source: '固有' | '背包'; }
    const allEntries: CardEntry[] = [];
    
    char.skills.forEach(c => allEntries.push({ card: c, source: '固有' }));
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

    // Inject Appearance Images if available (for self awareness)
    const appearanceImagesStr = imageBuilder?.registerList(char.appearanceImages, "我的外观图") || "";

    return `
--- 自身信息 (Self) ---
LocationID: ${locationId || 'Unknown'}
[外观]: ${char.appearance || "(未设定)"}${appearanceImagesStr}
[属性]:
${attrLines}

[当前矛盾 (Self Conflicts)]
${conflicts}

[主动/反应行动 (本轮可用)]
(注意：只有标记为 [背包] 的物品可以被【放入】奖池。标记为 [固有] 的能力不可放入。)
${activeStr}

[被动/结算效果 (自动触发 - 请勿手动使用)]
${passiveStr}
`.trim();
};

// --- New Helper: Get Round Participants (From Turn Order) ---
export const getRoundParticipants = (state: GameState): Character[] => {
    let orderIds = state.round.currentOrder || [];

    // If current order is empty, try to recover the LAST known order from history
    if (orderIds.length === 0 && state.world.history) {
        // Scan backwards for last order log
        for (let i = state.world.history.length - 1; i >= 0; i--) {
            const content = state.world.history[i].content;
            // Matches: "系统: 本轮行动顺序 (PC:1, NPC:2): [Name1, Name2]"
            const match = content.match(/顺序.*\[(.*?)\]/);
            if (match) {
                const namesOrIds = match[1].split(',').map(s => s.trim()).filter(s => s);
                const recoveredIds: string[] = [];
                const allChars = Object.values(state.characters);
                
                namesOrIds.forEach(val => {
                    // 1. Try ID
                    if (state.characters[val]) {
                        recoveredIds.push(val);
                        return;
                    }
                    // 2. Try Name
                    const candidates = allChars.filter(c => c.name === val);
                    if (candidates.length > 0) {
                         // Simple heuristic: Take the first match. 
                         recoveredIds.push(candidates[0].id);
                    }
                });

                if (recoveredIds.length > 0) {
                    orderIds = recoveredIds;
                    break; 
                }
            }
        }
    }

    // Map IDs to Characters, filtering out missing ones
    return orderIds
        .map(id => state.characters[id])
        .filter((c): c is Character => !!c);
};

// --- Updated: Format Life Trajectory Now ---
// Now expects a specifically filtered list of characters (from getRoundParticipants)
export const formatLifeTrajectoryNow = (characters: Character[]): string => {
    if (!characters || characters.length === 0) return "(无相关人生轨迹 / No active round participants)";

    // 1. Explicit ID Mapping Header for Context
    const idList = characters.map(c => `- ${c.name}: ${c.id}`).join('\n');
    const header = `[本轮登场角色列表 / Active Participants]\n${idList}\n\n`;

    // 2. Filter characters with defined life trajectory
    const relevantChars = characters.filter(c => c.lifeTrajectory && c.lifeTrajectory.current);
    
    if (relevantChars.length === 0) return header + "(无相关人生轨迹 / No active life trajectories)";

    // 3. Randomize order to avoid bias
    const shuffled = [...relevantChars].sort(() => Math.random() - 0.5);

    // 4. Format output
    const trajectories = shuffled.map(c => 
        `[角色: ${c.name} (ID:${c.id})] 当前人生章节: "${c.lifeTrajectory!.current}"`
    ).join('\n\n');

    return header + trajectories;
};

// --- Story Tag Formatters ---
export const formatFavorTags = (tags: StoryTag[] | undefined): string => {
    if (!tags || tags.length === 0) return "（暂无）";

    const liked = tags.filter(t => t.status === 'like').map(t => t.text);
    const disliked = tags.filter(t => t.status === 'dislike').map(t => t.text);

    let output = "";
    if (liked.length > 0) output += `喜欢 (LIKE): [${liked.join(', ')}]\n`;
    if (disliked.length > 0) output += `不喜欢 (DISLIKE): [${disliked.join(', ')}]`;

    return output || "（暂无偏好）";
};

export const formatAllTags = (tags: StoryTag[] | undefined): string => {
    if (!tags || tags.length === 0) return "";
    return tags.map(t => t.text).join(", ");
};
