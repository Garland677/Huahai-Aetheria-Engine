
import { MutableRefObject } from 'react';
import { GameState, MapLocation, MapRegion, AttributeVisibility, Card, PrizeItem, PrizePool, DebugLog, Trigger, Character, GameImage, GameAttribute, AttributeType, Drive, Effect } from '../../types';
import { generateRegion, analyzeRegionStats, analyzeTerrainAround, createEnvironmentCharacter, isPointInPolygon, checkMapExpansion } from '../../services/mapUtils';
import { generateLocationDetails, normalizeCard, generateCharacter } from '../../services/aiService';
import { getRandomChineseNames } from '../../services/nameService';
import { DEFAULT_AI_CONFIG } from '../../config';
import { generateRandomFlagAvatar } from '../../assets/imageLibrary';
import { defaultAcquireCard, defaultInteractCard, defaultTradeCard } from '../../services/DefaultSettings';
import { generateCharacterId, generateCardId, generateConflictId, generateDriveId, generatePrizePoolId, generatePrizeItemId, generateEffectId } from '../../services/idUtils';

interface UseLocationGenerationProps {
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string, overrides?: Partial<any>) => void;
    setIsProcessingAI: (val: boolean) => void;
    setProcessingLabel: (val: string) => void;
    handleAiFailure: (context: string, e: any) => void;
    addDebugLog: (log: DebugLog) => void;
    checkSession: () => number;
}

export interface ExplorationResult {
    success: boolean;
    shouldPopulate: boolean;
}

const getNearbyLocationsContext = (state: GameState, currentLoc: MapLocation): string => {
    const nearbyLocs: string[] = [];
    Object.values(state.map.locations).forEach(l => {
        if (l.id === currentLoc.id) return;
        if (!l.isKnown) return;
        const dist = Math.sqrt((l.coordinates.x - currentLoc.coordinates.x)**2 + (l.coordinates.y - currentLoc.coordinates.y)**2);
        if (dist <= 2000) {
             const rName = (l.regionId && state.map.regions[l.regionId]) ? state.map.regions[l.regionId].name : "未知区域";
             nearbyLocs.push(`${l.name}(${rName})`);
        }
    });
    return nearbyLocs.length > 0 ? nearbyLocs.join(', ') : "（附近无已知地点）";
};

export const useLocationGeneration = ({
    stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, addDebugLog, checkSession
}: UseLocationGenerationProps) => {

    const handleTriggerUpdate = (id: string, updates: Partial<Trigger>) => {
        updateState(prev => ({
            ...prev,
            triggers: {
                ...prev.triggers,
                [id]: { ...prev.triggers[id], ...updates }
            }
        }));
    };

    const performExploration = async (
        loc: MapLocation, 
        isManual: boolean = false, 
        locationInstructions: string = "",
        cultureInstructions: string = "",
        locationImages: GameImage[] = [],
        characterImages: GameImage[] = []
    ): Promise<ExplorationResult> => {
        const startSession = checkSession();
        const currentState = stateRef.current;
        const seed = (Object.values(currentState.map.chunks) as any[])[0]?.seed || Math.random();

        if (currentState.map.manualExplorationNext || isManual) {
            addLog(`系统: 进入空地点 (手动模式)。`);
            
            let regionId = loc.regionId;
            let newRegion: MapRegion | undefined;
            const existingRegions = Object.values(currentState.map.regions) as MapRegion[];

            if (!regionId) {
                for (const r of existingRegions) {
                    if (isPointInPolygon(loc.coordinates, r.vertices)) {
                        regionId = r.id;
                        break;
                    }
                }
            }

            if (!regionId) {
                newRegion = generateRegion(loc.coordinates.x, loc.coordinates.y, seed + loc.coordinates.x, existingRegions);
                newRegion.name = "新区域";
                newRegion.description = "";
            }

            const terrainAnalysis = analyzeTerrainAround(
                loc.coordinates.x, 
                loc.coordinates.y, 
                seed, 
                currentState.map.chunks, 
                currentState.map.settlements 
            );

            const safeConfig = currentState.judgeConfig || DEFAULT_AI_CONFIG;

            updateState(prev => {
                const newMap = { 
                    ...prev.map, 
                    locations: { ...prev.map.locations }, 
                    regions: { ...prev.map.regions },
                    manualExplorationNext: false 
                };
                const newChars = { ...prev.characters };
                
                if (newRegion) {
                    newMap.regions[newRegion.id] = newRegion;
                    regionId = newRegion.id;
                    
                    Object.values(newMap.locations).forEach(l => {
                        if (!l.regionId && isPointInPolygon(l.coordinates, newRegion!.vertices)) {
                             newMap.locations[l.id] = { ...l, regionId: newRegion!.id };
                        }
                    });
                }

                const manualAvatar = locationImages.length > 0 ? locationImages[0].base64 : generateRandomFlagAvatar(true);

                newMap.locations[loc.id] = {
                    ...loc,
                    name: "新地点",
                    description: "",
                    isKnown: true,
                    regionId: regionId,
                    terrainType: terrainAnalysis.terrainType, 
                    associatedNpcIds: [],
                    avatarUrl: manualAvatar,
                    images: locationImages 
                };

                const envChar = createEnvironmentCharacter(loc.id, "新地点");
                envChar.avatarUrl = generateRandomFlagAvatar();
                envChar.aiConfig = { ...safeConfig };
                
                newChars[envChar.id] = envChar;
                newMap.charPositions[envChar.id] = {
                    x: loc.coordinates.x,
                    y: loc.coordinates.y,
                    locationId: loc.id
                };
                
                newMap.locations[loc.id].associatedNpcIds = [envChar.id];

                const expandedMap = checkMapExpansion(loc.coordinates.x, loc.coordinates.y, newMap, seed);

                return {
                    ...prev,
                    map: expandedMap,
                    characters: newChars,
                    world: {
                        ...prev.world,
                        history: [...prev.world.history, {
                            id: `log_exp_manual_${Date.now()}`,
                            round: prev.round.roundNumber,
                            turnIndex: prev.round.turnIndex,
                            content: `系统: 发现新地点 [新地点]。已标记为已知。请手动编辑详细信息。`,
                            timestamp: Date.now(),
                            type: 'system',
                            locationId: loc.id
                        }]
                    }
                };
            });
            return { success: true, shouldPopulate: false }; 
        }

        addLog(`系统: 正在探索未知地点...`);
        
        const originalName = loc.name;
        const isSuggested = originalName && originalName !== "未知地点" && originalName !== "标记地点";
        const fixedName = isSuggested ? originalName : undefined;

        if (isSuggested) {
             addLog(`系统: 正在前往传闻中的 [${originalName}]...`);
        }
        
        const safeConfig = currentState.judgeConfig || DEFAULT_AI_CONFIG;
        
        try {
            let regionId = loc.regionId;
            let regionInfo = undefined;
            let needsRegionGen = false;
            let newRegion: MapRegion | undefined;
            let regionStats = undefined;

            const existingRegions = Object.values(currentState.map.regions) as MapRegion[];

            if (!regionId) {
                for (const r of existingRegions) {
                    if (isPointInPolygon(loc.coordinates, r.vertices)) {
                        regionId = r.id;
                        break;
                    }
                }
            }

            if (regionId) {
                const r = currentState.map.regions[regionId];
                if (r) regionInfo = { name: r.name, description: r.description };
            } else {
                needsRegionGen = true;
                newRegion = generateRegion(loc.coordinates.x, loc.coordinates.y, seed + loc.coordinates.x, existingRegions);
                
                regionStats = analyzeRegionStats(
                    newRegion, 
                    seed, 
                    currentState.map.chunks, 
                    currentState.map.settlements
                );
                
                addLog(`系统: 该地点位于未探明区域，正在观察区域地貌...`);
            }

            const terrainAnalysis = analyzeTerrainAround(
                loc.coordinates.x, 
                loc.coordinates.y, 
                seed, 
                currentState.map.chunks, 
                currentState.map.settlements 
            );

            const suggestedNames = await getRandomChineseNames(10);
            const nearbyLocationsContext = getNearbyLocationsContext(currentState, loc);

            if (checkSession() !== startSession) return { success: false, shouldPopulate: false };

            const details = await generateLocationDetails(
                safeConfig, 
                loc.coordinates, 
                currentState.world.history, 
                currentState.world.attributes,
                currentState.appSettings,
                currentState.defaultSettings,
                currentState.globalContext,
                currentState.world.worldGuidance,
                needsRegionGen,
                regionInfo,
                terrainAnalysis, 
                regionStats,      
                "", 
                nearbyLocationsContext,
                suggestedNames,
                addDebugLog,
                currentState, 
                (msg) => addLog(msg),
                handleTriggerUpdate,
                locationInstructions,
                cultureInstructions,
                locationImages,
                characterImages,
                fixedName 
            );

            if (checkSession() !== startSession) return { success: false, shouldPopulate: false };

            if (!details || (details.name === "未知" && details.description === "生成失败")) {
                addLog(`系统: 探索失败 (AI 生成无效或超时)。地点保持未知状态。`, { type: 'system' });
                return { success: false, shouldPopulate: false };
            }

            const localItems = (details.localItems || []) as any[];
            const prizeItems: PrizeItem[] = [];
            const usedItemIds = new Set<string>();

            if (localItems.length > 0) {
                localItems.forEach((item: any, idx: number) => {
                    const newItemId = generatePrizeItemId(usedItemIds);
                    usedItemIds.add(newItemId);
                    prizeItems.push({
                        id: newItemId,
                        name: item.name,
                        description: item.description,
                        weight: 10,
                        isHidden: false
                    });
                });
            }

            let newPool: PrizePool | undefined;
            if (prizeItems.length > 0) {
                newPool = {
                    id: generatePrizePoolId(Object.keys(currentState.prizePools)), 
                    name: `「${details.name}」的角落`,
                    description: details.lotteryrule || `「${details.name}」四处散落的物品，也许能找到一些当地记忆`, 
                    locationIds: [loc.id],
                    items: prizeItems,
                    minDraws: 1,
                    maxDraws: 1
                };
            }

            const locName = isSuggested ? originalName : details.name;

            const envChar = createEnvironmentCharacter(loc.id, locName);
            envChar.avatarUrl = generateRandomFlagAvatar();
            envChar.aiConfig = { ...safeConfig };
            
            const finalLocImages = locationImages.length > 0 ? locationImages : [];
            const locAvatarUrl = finalLocImages.length > 0 ? finalLocImages[0].base64 : generateRandomFlagAvatar(true);

            const newCharacters: Character[] = [];
            
            if (details.chars && details.chars.length > 0) {
                addLog(`系统: 正在根据人文定义并行生成 ${details.chars.length} 位居民...`);
                
                const allAvailableImages = [...characterImages, ...locationImages];

                const charGenPromises = details.chars.map(async (charSpec, index) => {
                    const matchedImage = charSpec.appearanceImageId 
                        ? allAvailableImages.find(img => img.id === charSpec.appearanceImageId) 
                        : undefined;
                    const specAppearanceImages = matchedImage ? [matchedImage] : [];
                    
                    const npcData = await generateCharacter(
                        currentState.charGenConfig || safeConfig, 
                        charSpec.description || `请根据地点[${locName}]的故事生成一名契合当地故事的主角。`, 
                        "", 
                        locName, 
                        details.region?.name || "未知区域", 
                        "暂无角色", 
                        currentState.world.history, 
                        currentState.appSettings, 
                        currentState.defaultSettings, 
                        currentState.globalContext, 
                        currentState.world.worldGuidance, 
                        [charSpec.name], 
                        currentState, 
                        undefined, 
                        undefined, 
                        addDebugLog,
                        specAppearanceImages, 
                        undefined
                    ) as any;
                    
                    if (npcData && npcData.name) {
                        return { npcData, index, matchedImage };
                    }
                    return null;
                });
                
                const results = await Promise.allSettled(charGenPromises);
                
                results.forEach((res) => {
                    if (res.status === 'fulfilled' && res.value) {
                        const { npcData, index, matchedImage } = res.value;
                        const id = generateCharacterId(currentState.characters);
                        
                        const usedConflictIds = new Set<string>();
                        (Object.values(currentState.characters) as Character[]).forEach(c => c.conflicts?.forEach(x => usedConflictIds.add(x.id)));

                        const usedDriveIds = new Set<string>();
                        (Object.values(currentState.characters) as Character[]).forEach(c => c.drives?.forEach(x => usedDriveIds.add(x.id)));

                        const triggers: Drive[] = [];
                        if (npcData.drives && Array.isArray(npcData.drives)) {
                            npcData.drives.forEach((d: any, i: number) => {
                                const did = generateDriveId(usedDriveIds);
                                usedDriveIds.add(did);
                                triggers.push({ id: did, condition: d.condition, amount: d.amount || 10, weight: d.weight || 50 });
                            });
                        }

                        const sourceCards = (npcData.cards || npcData.skills || []) as any[];
                        const usedCardIds = new Set(currentState.cardPool.map(c => c.id));
                        const usedEffectIds = new Set<string>(); // Effect IDs must be unique

                        const generatedCards: Card[] = sourceCards.map((sItem: any, i: number) => {
                            const s: any = sItem || {};
                            const triggerType = s.triggerType || s.trigger || 'active';
                            const isSettlement = triggerType === 'settlement';
                            const cardId = generateCardId(usedCardIds);
                            usedCardIds.add(cardId);
                            
                            let effects: Effect[] = [];

                            // NEW LOGIC: Use provided effects if available
                            if (Array.isArray(s.effects) && s.effects.length > 0) {
                                effects = s.effects.map((eff: any, eIdx: number) => {
                                    const eid = generateEffectId(usedEffectIds);
                                    usedEffectIds.add(eid);
                                    return {
                                        id: eid,
                                        name: eff.name || '效果',
                                        targetType: eff.targetType || (isSettlement ? 'self' : 'specific_char'),
                                        targetAttribute: eff.targetAttribute || eff.attr || '健康',
                                        value: eff.value ?? eff.val ?? (isSettlement ? 5 : -5),
                                        dynamicValue: !!eff.dynamicValue,
                                        conditionDescription: eff.conditionDescription || eff.condition || "True",
                                        conditionContextKeys: eff.conditionContextKeys || []
                                    };
                                });
                            } else {
                                // Fallback
                                let effectVal = s.effect_val;
                                const effectAttr = s.effect_attr || '健康';
                                const isDynamic = (effectVal === undefined || effectVal === null);
                                if (isDynamic) effectVal = isSettlement ? 5 : -5;
                                
                                const hitId = generateEffectId(usedEffectIds);
                                usedEffectIds.add(hitId);
                                effects.push({
                                    id: hitId,
                                    name: '命中/触发判定',
                                    targetType: isSettlement ? 'self' : 'specific_char',
                                    targetAttribute: '健康',
                                    value: 0,
                                    conditionDescription: s.condition || 'True',
                                    conditionContextKeys: []
                                });
                                
                                const resId = generateEffectId(usedEffectIds);
                                usedEffectIds.add(resId);
                                effects.push({
                                    id: resId,
                                    name: '实际效果',
                                    targetType: isSettlement ? 'self' : 'specific_char',
                                    targetAttribute: effectAttr,
                                    value: effectVal,
                                    dynamicValue: false,
                                    conditionDescription: 'True',
                                    conditionContextKeys: []
                                });
                            }

                            const card: Card = {
                                id: cardId,
                                name: String(s.name || "未命名"),
                                description: String(s.description || (isSettlement ? "被动事件/特性" : "主动技能")),
                                itemType: s.itemType || 'skill', 
                                triggerType: triggerType, 
                                cost: 0,
                                effects: effects,
                                visibility: AttributeVisibility.PUBLIC
                            };
                            return normalizeCard(card);
                        });
                        
                        const defAcquire = defaultAcquireCard as Card;
                        const defTrade = defaultTradeCard as Card;
                        const defInteract = defaultInteractCard as Card;

                        if (!generatedCards.some((s: Card) => (s.name && s.name.includes("获取")) || s.id === defaultAcquireCard.id)) generatedCards.push(defAcquire);
                        if (!generatedCards.some((s: Card) => s.id === defaultTradeCard.id)) generatedCards.push(defTrade);
                        if (!generatedCards.some((s: Card) => s.id === defaultInteractCard.id)) generatedCards.push(defInteract);
                        
                        const generatedConflicts = (npcData.conflicts || []).map((c: any, ci: number) => {
                             const cid = generateConflictId(usedConflictIds);
                             usedConflictIds.add(cid);
                             return { ...c, id: cid };
                        });

                        const rawAttributes = npcData.attributes || {};
                        const finalAttributes: Record<string, GameAttribute> = {};
                        const defaults: Record<string, GameAttribute> = {
                            '健康': { id: '健康', name: '健康', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                            '快感': { id: '快感', name: '快感', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                            '创造点': { id: '创造点', name: '创造点', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                            '状态': { id: '状态', name: '状态', type: AttributeType.TEXT, value: '正常', visibility: AttributeVisibility.PUBLIC },
                            '体能': { id: '体能', name: '体能', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC }
                        };
                        Object.assign(finalAttributes, defaults);
                        Object.entries(rawAttributes).forEach(([key, val]: [string, any]) => {
                            if (val === null || val === undefined) return;
                            let finalVal: string | number = 50;
                            let type = AttributeType.NUMBER;
                            if (typeof val === 'number' || typeof val === 'string') finalVal = val;
                            else if (typeof val === 'object') { if ('value' in val) finalVal = val.value; }
                            if (typeof finalVal === 'number' || (!isNaN(Number(finalVal)) && String(finalVal).trim() !== '')) { type = AttributeType.NUMBER; finalVal = Number(finalVal); } 
                            else { type = AttributeType.TEXT; finalVal = String(finalVal); }
                            finalAttributes[key] = { id: key, name: key, type: type, value: finalVal, visibility: AttributeVisibility.PUBLIC };
                        });
                        
                        const behaviorConfig = currentState.charBehaviorConfig || currentState.judgeConfig || DEFAULT_AI_CONFIG;

                        newCharacters.push({
                            id, isPlayer: false, name: npcData.name,
                            appearance: npcData.appearance || "普通的样貌",
                            description: npcData.description,
                            avatarUrl: matchedImage ? matchedImage.base64 : generateRandomFlagAvatar(),
                            attributes: finalAttributes, 
                            skills: generatedCards, inventory: [],
                            drives: triggers, conflicts: generatedConflicts,
                            aiConfig: { ...behaviorConfig }, 
                            contextConfig: { messages: [] },
                            appearanceCondition: `在此地`,
                            enableAppearanceCheck: true,
                            appearanceImages: matchedImage ? [matchedImage] : []
                        });
                    }
                });
            }

            updateState(prev => {
                const newMap = { ...prev.map, locations: { ...prev.map.locations }, regions: { ...prev.map.regions } };
                const newChars = { ...prev.characters };
                const usedConflictIds = new Set<string>();
                (Object.values(prev.characters) as Character[]).forEach(c => c.conflicts?.forEach(x => usedConflictIds.add(x.id)));
                
                if (newRegion) {
                    newRegion.name = details.region?.name || "新发现区域";
                    newRegion.description = details.region?.description || "一片充满未知的土地。";
                    newMap.regions[newRegion.id] = newRegion;
                    regionId = newRegion.id;
                    Object.values(newMap.locations).forEach(l => {
                        if (!l.regionId && isPointInPolygon(l.coordinates, newRegion!.vertices)) {
                             newMap.locations[l.id] = { ...l, regionId: newRegion!.id };
                        }
                    });
                }

                const npcIds = [envChar.id, ...newCharacters.map(c => c.id)];

                newMap.locations[loc.id] = {
                    ...loc,
                    name: locName, // Use validated name
                    description: details.description,
                    isKnown: true,
                    regionId: regionId,
                    terrainType: terrainAnalysis.terrainType, 
                    associatedNpcIds: npcIds,
                    avatarUrl: locAvatarUrl,
                    images: finalLocImages
                };

                newChars[envChar.id] = envChar;
                newMap.charPositions[envChar.id] = { x: loc.coordinates.x, y: loc.coordinates.y, locationId: loc.id };

                newCharacters.forEach(c => {
                    if (c.conflicts) {
                        c.conflicts = c.conflicts.map(conf => {
                            const cid = generateConflictId(usedConflictIds);
                            usedConflictIds.add(cid);
                            return { ...conf, id: cid };
                        });
                    }
                    newChars[c.id] = c;
                    newMap.charPositions[c.id] = { 
                        x: loc.coordinates.x + (Math.random()-0.5)*20, 
                        y: loc.coordinates.y + (Math.random()-0.5)*20, 
                        locationId: loc.id 
                    };
                });

                const ts = Date.now();
                const newLogs: any[] = [];
                newLogs.push({
                    id: `log_exp_${ts}_0`,
                    round: prev.round.roundNumber, turnIndex: prev.round.turnIndex,
                    content: `系统: 发现新地点 [${locName}]`,
                    timestamp: ts, type: 'system', locationId: loc.id
                });
                
                if (newRegion) {
                    newLogs.push({
                        id: `log_exp_${ts}_1`,
                        round: prev.round.roundNumber, turnIndex: prev.round.turnIndex,
                        content: `系统: 探明新区域 [${newRegion.name}]`,
                        timestamp: ts, type: 'system', locationId: loc.id
                    });
                }

                const nextPrizePools = { ...prev.prizePools };
                if (newPool) {
                    nextPrizePools[newPool.id] = newPool;
                }
                
                const expandedMap = checkMapExpansion(loc.coordinates.x, loc.coordinates.y, newMap, seed);

                return {
                    ...prev,
                    map: expandedMap,
                    characters: newChars,
                    world: { ...prev.world, history: [...prev.world.history, ...newLogs] },
                    prizePools: nextPrizePools
                };
            });

            if (prizeItems.length > 0) {
                addLog(`系统: 在 [${locName}] 发现了 ${prizeItems.length} 件散落物品。`);
            }
            
            if (newCharacters.length > 0) {
                 addLog(`系统: 发现当地居民: ${newCharacters.map(c => c.name).join(', ')}。`);
            } else if (details.chars && details.chars.length > 0) {
                 addLog(`系统: 似乎有人影晃动，但未能看清 (生成失败)。`);
            } else {
                 addLog(`系统: 此地似乎空无一人。`);
            }

            return { success: true, shouldPopulate: false };

        } catch (e: any) {
            console.error("Exploration Background Error", e);
            addLog(`系统: 探索遇到问题: ${e.message}`, { type: 'system' });
            return { success: false, shouldPopulate: false };
        }
    };

    const performReset = async (
        loc: MapLocation, 
        keepRegion: boolean, 
        instructions: string = "",
        cultureInstructions: string = "",
        locationImages: GameImage[] = [],
        characterImages: GameImage[] = []
    ) => {
        const startSession = checkSession();
        const currentState = stateRef.current;

        setIsProcessingAI(true);
        setProcessingLabel("正在重构现实...");
        addLog(`系统: 正在重置地点 [${loc.name}] (保留区域: ${keepRegion ? '是' : '否'})...`);

        const safeConfig = currentState.judgeConfig || DEFAULT_AI_CONFIG;
        const seed = (Object.values(currentState.map.chunks) as any[])[0]?.seed || Math.random();

        try {
            let regionId = loc.regionId;
            let regionInfo = undefined;
            let needsRegionGen = false;
            let newRegion: MapRegion | undefined;
            let regionStats = undefined;
            
            const existingRegions = Object.values(currentState.map.regions) as MapRegion[];
            const currentRegion = regionId ? currentState.map.regions[regionId] : undefined;

            if (keepRegion && currentRegion) {
                regionInfo = { name: currentRegion.name, description: currentRegion.description };
                needsRegionGen = false;
            } else if (!keepRegion && currentRegion) {
                newRegion = { ...currentRegion }; 
                regionStats = analyzeRegionStats(newRegion, seed, currentState.map.chunks, currentState.map.settlements);
                needsRegionGen = true;
            } else {
                newRegion = generateRegion(loc.coordinates.x, loc.coordinates.y, seed + loc.coordinates.x + Date.now(), existingRegions);
                regionStats = analyzeRegionStats(newRegion, seed, currentState.map.chunks, currentState.map.settlements);
                needsRegionGen = true;
            }

            const relevantChars: Character[] = [];
            (Object.values(currentState.characters) as Character[]).forEach(c => {
                const pos = currentState.map.charPositions[c.id];
                if (!pos) return;
                if (pos.locationId === loc.id || (regionId && pos.locationId && currentState.map.locations[pos.locationId]?.regionId === regionId)) {
                    relevantChars.push(c);
                }
            });
            const existingCharsContext = relevantChars.length > 0 ? relevantChars.map(c => `${c.name}: ${c.description.substring(0, 50)}...`).join('\n') : "";
            const nearbyLocationsContext = getNearbyLocationsContext(currentState, loc);
            const terrainAnalysis = analyzeTerrainAround(loc.coordinates.x, loc.coordinates.y, seed, currentState.map.chunks, currentState.map.settlements);
            const suggestedNames = await getRandomChineseNames(10);

            if (checkSession() !== startSession) return;

            const details = await generateLocationDetails(
                safeConfig, 
                loc.coordinates, 
                currentState.world.history, 
                currentState.world.attributes, 
                currentState.appSettings, 
                currentState.defaultSettings, 
                currentState.globalContext, 
                currentState.world.worldGuidance, 
                needsRegionGen, 
                regionInfo, 
                terrainAnalysis, 
                regionStats, 
                existingCharsContext, 
                nearbyLocationsContext, 
                suggestedNames, 
                addDebugLog, 
                currentState, 
                (msg) => addLog(msg), 
                handleTriggerUpdate, 
                instructions, 
                cultureInstructions, 
                locationImages, 
                characterImages
            ) as any;

            if (checkSession() !== startSession) return;

            const localItems = (details.localItems || []) as any[];
            const prizeItems: PrizeItem[] = [];
            const usedItemIds = new Set<string>();
            if (localItems.length > 0) {
                localItems.forEach((item: any, idx: number) => {
                    const newItemId = generatePrizeItemId(usedItemIds);
                    usedItemIds.add(newItemId);
                    prizeItems.push({ id: newItemId, name: item.name, description: item.description, weight: 10, isHidden: false });
                });
            }
            let newPool: PrizePool | undefined;
            if (prizeItems.length > 0) {
                newPool = {
                    id: generatePrizePoolId(Object.keys(currentState.prizePools)),
                    name: `「${details.name}」的物品`,
                    description: details.lotteryrule || `「${details.name}」四处散落的物品`,
                    locationIds: [loc.id],
                    items: prizeItems,
                    minDraws: 1, maxDraws: 1
                };
            }

            const finalAvatarUrl = locationImages.length > 0 ? locationImages[0].base64 : (loc.avatarUrl || generateRandomFlagAvatar(true));
            const finalImages = locationImages.length > 0 ? locationImages : loc.images;

            updateState(prev => {
                const newMap = { ...prev.map, locations: { ...prev.map.locations }, regions: { ...prev.map.regions } };
                
                if (newRegion) {
                    newRegion.name = details.region?.name || "重置区域";
                    newRegion.description = details.region?.description || "区域已被重新认知。";
                    newMap.regions[newRegion.id] = newRegion;
                    regionId = newRegion.id;
                    Object.values(newMap.locations).forEach(l => {
                         if (l.id === loc.id || (!l.regionId && isPointInPolygon(l.coordinates, newRegion!.vertices))) {
                             newMap.locations[l.id] = { ...l, regionId: newRegion!.id };
                         }
                    });
                }

                newMap.locations[loc.id] = {
                    ...loc,
                    name: details.name,
                    description: details.description,
                    isKnown: true,
                    regionId: regionId,
                    terrainType: terrainAnalysis.terrainType, 
                    avatarUrl: finalAvatarUrl,
                    images: finalImages
                };
                
                const newChars = { ...prev.characters };
                const envCharId = `env_${loc.id}`;
                if (newChars[envCharId]) {
                    newChars[envCharId] = {
                        ...newChars[envCharId],
                        name: `${details.name}的环境`, // Update Env Name
                        description: `【世界代理】${details.name}的自然环境。`,
                        aiConfig: { ...safeConfig },
                        avatarUrl: newChars[envCharId].avatarUrl || generateRandomFlagAvatar()
                    };
                }

                const nextPrizePools = { ...prev.prizePools };
                if (newPool) {
                    nextPrizePools[newPool.id] = newPool;
                }

                return {
                    ...prev,
                    map: newMap,
                    characters: newChars,
                    prizePools: nextPrizePools
                };
            });
            
            addLog(`系统: 地点已重置为 [${details.name}]。`);
            if (prizeItems.length > 0) {
                addLog(`系统: 在 [${details.name}] 发现了 ${prizeItems.length} 件散落物品。`);
            }

        } catch (e: any) {
            handleAiFailure("Reset Location", e);
        } finally {
            setIsProcessingAI(false);
        }
    };

    return { performExploration, performReset };
};