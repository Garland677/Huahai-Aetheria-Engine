
import { MutableRefObject } from 'react';
import { GameState, MapLocation, MapRegion, AttributeType, AttributeVisibility, Card, MapChunk, Character, TerrainType, LogEntry, DebugLog, Trigger, GameAttribute } from '../types';
import { checkMapExpansion, generateRegion, isPointInPolygon, createEnvironmentCharacter, analyzeTerrainAround, analyzeRegionStats } from '../services/mapUtils';
import { generateLocationDetails, generateCharacter } from '../services/aiService';
import { DEFAULT_AI_CONFIG } from '../config';
import { getRandomChineseNames } from '../services/nameService';
import { defaultAcquireCard, defaultInteractCard, defaultTradeCard } from '../services/DefaultSettings';
import { generateRandomFlagAvatar } from '../assets/imageLibrary';

// Duplicate helper to avoid import loops (simple logic)
const getNextConflictId = (characters: Record<string, Character>): number => {
    let max = 0;
    Object.values(characters).forEach(c => {
        c.conflicts?.forEach(x => {
            const n = parseInt(x.id);
            if (!isNaN(n) && n > max) max = n;
        });
    });
    return max + 1;
};

interface UseMapLogicProps {
    stateRef: MutableRefObject<GameState>;
    updateState: (updater: (current: GameState) => GameState) => void;
    addLog: (text: string) => void;
    setIsProcessingAI: (val: boolean) => void;
    setProcessingLabel: (val: string) => void;
    handleAiFailure: (context: string, e: any) => void;
    addDebugLog: (log: DebugLog) => void;
}

export const useMapLogic = ({ stateRef, updateState, addLog, setIsProcessingAI, setProcessingLabel, handleAiFailure, addDebugLog }: UseMapLogicProps) => {

    const handleTriggerUpdate = (id: string, updates: Partial<Trigger>) => {
        updateState(prev => ({
            ...prev,
            triggers: {
                ...prev.triggers,
                [id]: { ...prev.triggers[id], ...updates }
            }
        }));
    };

    const processLocationChange = async () => {
         const map = stateRef.current.map;
         if (!map.activeLocationId) return;

         // 1. Map Expansion
         const targetLoc = map.locations[map.activeLocationId];
         const targetX = targetLoc?.coordinates.x || 0;
         const targetY = targetLoc?.coordinates.y || 0;
         const seed = (Object.values(map.chunks) as MapChunk[])[0]?.seed || Math.random();
         const newMapState = checkMapExpansion(targetX, targetY, map, seed);
         if (newMapState !== map) {
             updateState(prev => ({ ...prev, map: newMapState }));
         }

         // 2. Exploration
         // Logic check: exploration only if not busy processing other AI tasks
         const loc = map.locations[map.activeLocationId];
         if (loc && !loc.isKnown) {
             await exploreLocation(loc);
         }
    };

    const resetLocation = async (locationId: string, keepRegion: boolean) => {
        const currentState = stateRef.current;
        const loc = currentState.map.locations[locationId];
        if (!loc) return;

        setIsProcessingAI(true);
        setProcessingLabel("正在重构现实...");
        addLog(`系统: 正在重置地点 [${loc.name}] (保留区域: ${keepRegion ? '是' : '否'})...`);

        const safeConfig = currentState.judgeConfig || DEFAULT_AI_CONFIG;
        const seed = (Object.values(currentState.map.chunks) as MapChunk[])[0]?.seed || Math.random();

        try {
            let regionId = loc.regionId;
            let regionInfo = undefined;
            let needsRegionGen = !keepRegion; 
            let newRegion: MapRegion | undefined;
            let regionStats = undefined;
            
            const existingRegions = Object.values(currentState.map.regions) as MapRegion[];

            if (keepRegion && regionId) {
                const r = currentState.map.regions[regionId];
                if (r) regionInfo = { name: r.name, description: r.description };
            } else {
                newRegion = generateRegion(loc.coordinates.x, loc.coordinates.y, seed + loc.coordinates.x + Date.now(), existingRegions);
                regionStats = analyzeRegionStats(
                    newRegion, 
                    seed, 
                    currentState.map.chunks, 
                    currentState.map.settlements
                );
            }

            const relevantChars: Character[] = [];
            (Object.values(currentState.characters) as Character[]).forEach(c => {
                const pos = currentState.map.charPositions[c.id];
                if (!pos) return;
                // Fix: Added pos.locationId && ... to avoid undefined index access
                if (pos.locationId === loc.id || (regionId && pos.locationId && currentState.map.locations[pos.locationId]?.regionId === regionId)) {
                    relevantChars.push(c);
                }
            });
            const existingCharsContext = relevantChars.length > 0 
                ? relevantChars.map(c => `${c.name}: ${c.description.substring(0, 50)}...`).join('\n') 
                : "";
            
            const terrainAnalysis = analyzeTerrainAround(
                loc.coordinates.x, 
                loc.coordinates.y, 
                seed, 
                currentState.map.chunks,
                currentState.map.settlements 
            );

            // Fetch suggested names for new NPCs
            const suggestedNames = await getRandomChineseNames(10);

            // AI Generation (Location Only)
            const details = await generateLocationDetails(
                safeConfig, 
                loc.coordinates, 
                currentState.world.history,
                currentState.world.attributes,
                currentState.appSettings,
                currentState.defaultSettings,
                currentState.globalContext, // Pass Global Context
                currentState.world.worldGuidance,
                needsRegionGen,
                regionInfo,
                terrainAnalysis,
                regionStats,
                existingCharsContext,
                suggestedNames,
                addDebugLog,
                currentState, // Trigger Support
                (msg) => addLog(msg),
                handleTriggerUpdate
            ) as any;

            // 1. UPDATE LOCATION STATE
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
                    avatarUrl: loc.avatarUrl || generateRandomFlagAvatar(true) // Ensure avatar exists if resetting
                };
                
                const newChars = { ...prev.characters };
                const envCharId = `env_${loc.id}`;
                if (newChars[envCharId]) {
                    newChars[envCharId] = {
                        ...newChars[envCharId],
                        name: `${details.name}的环境`,
                        description: `【系统代理】${details.name}的自然环境。`,
                        // Inherit Global AI Config
                        aiConfig: { ...safeConfig },
                        // Ensure environment char has an avatar if missing during reset
                        avatarUrl: newChars[envCharId].avatarUrl || generateRandomFlagAvatar()
                    };
                }

                return {
                    ...prev,
                    map: newMap,
                    characters: newChars
                };
            });
            
            addLog(`系统: 地点已重置为 [${details.name}]。`);

        } catch (e: any) {
            handleAiFailure("Reset Location", e);
        } finally {
            setIsProcessingAI(false);
        }
    };

    const exploreLocation = async (loc: MapLocation) => {
        const currentState = stateRef.current;
        const seed = (Object.values(currentState.map.chunks) as MapChunk[])[0]?.seed || Math.random();

        // MANUAL EXPLORATION BRANCH
        if (currentState.map.manualExplorationNext) {
            addLog(`系统: 手动模式介入 - 跳过AI生成，仅进行地形演算。`);
            
            let regionId = loc.regionId;
            let newRegion: MapRegion | undefined;
            const existingRegions = Object.values(currentState.map.regions) as MapRegion[];

            // Region detection/generation logic same as standard but no AI
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
                    manualExplorationNext: false // Reset flag
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

                newMap.locations[loc.id] = {
                    ...loc,
                    name: "新地点",
                    description: "",
                    isKnown: true,
                    regionId: regionId,
                    terrainType: terrainAnalysis.terrainType, 
                    associatedNpcIds: [],
                    avatarUrl: generateRandomFlagAvatar(true) // Generate blurred avatar for manual loc
                };

                // Only Environment Character
                const envChar = createEnvironmentCharacter(loc.id, "新地点");
                // Force ensure avatar and config inheritance
                envChar.avatarUrl = generateRandomFlagAvatar();
                envChar.aiConfig = { ...safeConfig }; // INHERIT GLOBAL CONFIG
                
                newChars[envChar.id] = envChar;
                newMap.charPositions[envChar.id] = {
                    x: loc.coordinates.x,
                    y: loc.coordinates.y,
                    locationId: loc.id
                };
                
                newMap.locations[loc.id].associatedNpcIds = [envChar.id];

                return {
                    ...prev,
                    map: newMap,
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
            return; // End Manual Branch
        }

        // STANDARD AI EXPLORATION BRANCH
        setIsProcessingAI(true);
        setProcessingLabel("Exploring: Analyzing Terrain...");
        addLog(`系统: 正在探索未知地点...`);
        
        const safeConfig = currentState.judgeConfig || DEFAULT_AI_CONFIG;
        
        try {
            // --- PHASE 1: GENERATE LOCATION & REGION ---
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
                
                addLog(`系统: 该地点位于未探明区域，正在生成区域地貌...`);
            }

            const terrainAnalysis = analyzeTerrainAround(
                loc.coordinates.x, 
                loc.coordinates.y, 
                seed, 
                currentState.map.chunks,
                currentState.map.settlements 
            );

            // Fetch suggested names
            const suggestedNames = await getRandomChineseNames(10);

            // Generate Location Only First
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
                "", // No existing chars context yet
                suggestedNames,
                addDebugLog,
                currentState, 
                (msg) => addLog(msg),
                handleTriggerUpdate
            ) as any;

            // --- UPDATE STATE 1: LOCATION & ENV CHAR ---
            const locName = details.name;
            const regionName = details.region?.name || regionInfo?.name || "未知区域";
            const envChar = createEnvironmentCharacter(loc.id, locName);
            envChar.avatarUrl = generateRandomFlagAvatar();
            envChar.aiConfig = { ...safeConfig };

            updateState(prev => {
                const newMap = { ...prev.map, locations: { ...prev.map.locations }, regions: { ...prev.map.regions } };
                const newChars = { ...prev.characters };
                
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

                newMap.locations[loc.id] = {
                    ...loc,
                    name: locName,
                    description: details.description,
                    isKnown: true,
                    regionId: regionId,
                    terrainType: terrainAnalysis.terrainType, 
                    associatedNpcIds: [envChar.id],
                    avatarUrl: generateRandomFlagAvatar(true)
                };

                newChars[envChar.id] = envChar;
                newMap.charPositions[envChar.id] = { x: loc.coordinates.x, y: loc.coordinates.y, locationId: loc.id };

                const ts = Date.now();
                const newLogs: LogEntry[] = [];
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
                        content: `系统: 探明新区域 [${newRegion.name}] - ${newRegion.description}`,
                        timestamp: ts, type: 'system', locationId: loc.id
                    });
                }

                return {
                    ...prev,
                    map: newMap,
                    characters: newChars,
                    world: { ...prev.world, history: [...prev.world.history, ...newLogs] }
                };
            });

            // --- PHASE 2: GENERATE NPCs PARALLEL ---
            setProcessingLabel("Populating Location...");
            addLog(`系统: 正在生成本地居民...`);

            // Use separate names for NPCs
            const npcNames1 = suggestedNames.slice(0, 5);
            const npcNames2 = suggestedNames.slice(5, 10);

            // Construct context based on the *new* location
            const envCharContext = `${envChar.name}: ${envChar.description}`;

            const npcPromises = [
                generateCharacter(
                    safeConfig, 
                    `请根据地点[${locName}](${regionName})的氛围，创作一个独特的NPC。`, // Prompt
                    "请根据角色设定自动搭配技能。", // Style
                    locName, regionName, envCharContext, currentState.world.history, currentState.appSettings, currentState.defaultSettings, currentState.globalContext, currentState.world.worldGuidance, npcNames1
                ),
                generateCharacter(
                    safeConfig,
                    `请根据地点[${locName}](${regionName})的氛围，创作另一个独特的NPC。`,
                    "请根据角色设定自动搭配技能。",
                    locName, regionName, envCharContext, currentState.world.history, currentState.appSettings, currentState.defaultSettings, currentState.globalContext, currentState.world.worldGuidance, npcNames2
                )
            ];

            const npcsData = await Promise.all(npcPromises);

            // --- UPDATE STATE 2: ADD NPCs ---
            updateState(prev => {
                const newChars = { ...prev.characters };
                const newMap = { ...prev.map, charPositions: { ...prev.map.charPositions } };
                const newLogs: LogEntry[] = [];
                const ts = Date.now();
                const newNpcIds: string[] = [...(prev.map.locations[loc.id].associatedNpcIds || [])];

                let nextConflictId = getNextConflictId(prev.characters);

                npcsData.forEach((npc, idx) => {
                    if (!npc || !npc.name) return;
                    
                    const id = `npc_${Date.now()}_${idx}`;
                    newNpcIds.push(id);

                    // Drives
                    const triggers = [];
                    if (npc.drives && Array.isArray(npc.drives)) {
                        // Fix: Added default weight: 50
                        npc.drives.forEach((d: any, i: number) => triggers.push({ id: `drv_${id}_${i}`, condition: d.condition, amount: d.amount || 10, weight: d.weight || 50 }));
                    } else {
                        triggers.push({ id: `trig_${id}_def`, condition: "做出符合人设的有效行动", amount: 5, weight: 50 });
                    }

                    // Skills
                    const sourceCards = npc.cards || npc.skills || [];
                    const generatedCards: Card[] = sourceCards.map((s: any, i: number) => {
                        const isSettlement = s.trigger === 'settlement';
                        const targetType = isSettlement ? 'self' : 'specific_char';
                        let effectVal = s.effect_val;
                        const effectAttr = s.effect_attr || '健康';
                        const isDynamic = (effectVal === undefined || effectVal === null);
                        if (isDynamic) effectVal = isSettlement ? 5 : -5;

                        return {
                            id: `card_${id}_${i}`,
                            name: s.name, description: s.description || (isSettlement ? "被动事件/特性" : "主动技能"),
                            itemType: 'skill', triggerType: s.trigger || 'active', cost: 0,
                            effects: [
                                { id: `eff_hit_${i}`, name: '命中/触发判定', targetType: targetType, targetAttribute: '健康', targetId: '', value: 0, conditionDescription: s.condition || 'True', conditionContextKeys: [] },
                                { id: `eff_res_${i}`, name: '实际效果', targetType: targetType, targetAttribute: effectAttr, value: effectVal, dynamicValue: false, conditionDescription: 'True', conditionContextKeys: [] }
                            ]
                        };
                    });

                    // Inject Defaults
                    if (!generatedCards.some((s: any) => s.id === defaultAcquireCard.id)) generatedCards.push(defaultAcquireCard);
                    if (!generatedCards.some((s: any) => s.id === defaultTradeCard.id)) generatedCards.push(defaultTradeCard);
                    if (!generatedCards.some((s: any) => s.id === defaultInteractCard.id)) generatedCards.push(defaultInteractCard);

                    // Conflicts
                    const generatedConflicts = (npc.conflicts || []).map((c: any) => ({
                         id: String(nextConflictId++),
                         desc: c.desc, apReward: c.apReward || 5, solved: false
                    }));

                    // --- PARSE ATTRIBUTES FROM AI RESPONSE ---
                    const rawAttributes = npc.attributes || {};
                    const finalAttributes: Record<string, GameAttribute> = {};

                    // 1. Establish defaults (Fallback)
                    const defaults: Record<string, GameAttribute> = {
                        '健康': { id: '健康', name: '健康', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                        '快感': { id: '快感', name: '快感', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                        '创造点': { id: '创造点', name: '创造点', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC },
                        '状态': { id: '状态', name: '状态', type: AttributeType.TEXT, value: '正常', visibility: AttributeVisibility.PUBLIC },
                        '体能': { id: '体能', name: '体能', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC }
                    };
                    Object.assign(finalAttributes, defaults);

                    // 2. Overwrite with AI Generated Attributes
                    Object.entries(rawAttributes).forEach(([key, val]: [string, any]) => {
                        if (val === null || val === undefined) return;
                        
                        let finalVal: string | number = 50;
                        let type = AttributeType.NUMBER;

                        if (typeof val === 'number' || typeof val === 'string') {
                            finalVal = val;
                        } else if (typeof val === 'object') {
                            if ('value' in val) finalVal = val.value;
                        }

                        if (typeof finalVal === 'number' || (!isNaN(Number(finalVal)) && String(finalVal).trim() !== '')) {
                            type = AttributeType.NUMBER;
                            finalVal = Number(finalVal);
                        } else {
                            type = AttributeType.TEXT;
                            finalVal = String(finalVal);
                        }

                        finalAttributes[key] = {
                            id: key, name: key, type: type, value: finalVal, visibility: AttributeVisibility.PUBLIC
                        };
                    });

                    newChars[id] = {
                        id, isPlayer: false, name: npc.name,
                        appearance: npc.appearance || "普通的样貌",
                        description: npc.description,
                        avatarUrl: generateRandomFlagAvatar(),
                        attributes: finalAttributes, 
                        skills: generatedCards, inventory: [],
                        drives: triggers, conflicts: generatedConflicts,
                        aiConfig: { ...safeConfig },
                        contextConfig: { messages: [] },
                        appearanceCondition: `位于当前故事发生的地点`,
                        enableAppearanceCheck: true
                    };
                    
                    newMap.charPositions[id] = { x: loc.coordinates.x + (Math.random()-0.5)*20, y: loc.coordinates.y + (Math.random()-0.5)*20, locationId: loc.id };
                    
                    newLogs.push({
                        id: `log_exp_${ts}_npc_${idx}`,
                        round: prev.round.roundNumber, turnIndex: prev.round.turnIndex,
                        content: `系统: 发现 NPC [${npc.name}]`,
                        timestamp: ts, type: 'system', locationId: loc.id
                    });
                });

                // Update location's NPC list
                const newLocations = { ...prev.map.locations };
                newLocations[loc.id] = { ...newLocations[loc.id], associatedNpcIds: newNpcIds };

                return {
                    ...prev,
                    map: { ...newMap, locations: newLocations },
                    characters: newChars,
                    world: { ...prev.world, history: [...prev.world.history, ...newLogs] }
                };
            });

        } catch (e: any) {
            handleAiFailure("Exploration", e);
        } finally {
            setIsProcessingAI(false);
        }
    };

    return {
        exploreLocation,
        processLocationChange,
        resetLocation
    };
};