









import { MapChunk, MapState, MapLocation, MapRegion, Character, AttributeType, AttributeVisibility, TerrainType, MapSettlement, LogEntry, InitialWorldConfig } from "../types";
import { MAP_CONSTANTS } from "../constants";
import { PRNG, generateIrregularPolygon, isPointInPolygon } from "./geometryUtils";
import { defaultAcquireCard, defaultInteractCard, defaultTradeCard, INITIAL_DEFAULT_SETTINGS } from "./DefaultSettings";
import { generateRandomFlagAvatar } from "../assets/imageLibrary";

// Export re-used utils for other files
export { isPointInPolygon };

// Improved Noise Functions
const noise = (x: number, y: number, seed: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
};

const smoothNoise = (x: number, y: number, seed: number) => {
    const corners = (noise(x - 1, y - 1, seed) + noise(x + 1, y - 1, seed) + noise(x - 1, y + 1, seed) + noise(x + 1, y + 1, seed)) / 16;
    const sides = (noise(x - 1, y, seed) + noise(x + 1, y, seed) + noise(x, y - 1, seed) + noise(x, y + 1, seed)) / 8;
    const center = noise(x, y, seed) / 4;
    return corners + sides + center;
};

const interpolate = (a: number, b: number, x: number) => {
    const ft = x * Math.PI;
    const f = (1 - Math.cos(ft)) * 0.5;
    return a * (1 - f) + b * f;
};

const interpolatedNoise = (x: number, y: number, seed: number) => {
    const integer_X = Math.floor(x);
    const fractional_X = x - integer_X;
    const integer_Y = Math.floor(y);
    const fractional_Y = y - integer_Y;

    const v1 = smoothNoise(integer_X, integer_Y, seed);
    const v2 = smoothNoise(integer_X + 1, integer_Y, seed);
    const v3 = smoothNoise(integer_X, integer_Y + 1, seed);
    const v4 = smoothNoise(integer_X + 1, integer_Y + 1, seed);

    const i1 = interpolate(v1, v2, fractional_X);
    const i2 = interpolate(v3, v4, fractional_X);

    return interpolate(i1, i2, fractional_Y);
};

// Procedural Terrain Generation
export const getTerrainHeight = (x: number, y: number, seed: number): number => {
    // 1. Super Macro / Biome Layer (Frequency ~10km - very low)
    // This creates large "Continents" or "Oceans"
    const superScale = 0.00015; 
    const rawSuper = interpolatedNoise(x * superScale, y * superScale, seed + 12345);
    
    // Map to a bias range: -400m (Deep Ocean) to +400m (Highland Base)
    // Steeper curve to force binary biomes (Ocean vs Land)
    const superOffset = (rawSuper - 0.5) * 800; 

    // 2. Macro Layer (Frequency ~1km) - Local Hills/Valleys
    const macroScale = 0.0015; 
    const rawMacro = interpolatedNoise(x * macroScale, y * macroScale, seed);
    const macroH = (rawMacro - 0.5) * 300; 

    // 3. Mid Detail - Small Hills
    const midScale = 0.01; 
    const midH = (interpolatedNoise(x * midScale, y * midScale, seed + 100) - 0.5) * 80; 
    
    // 4. Micro Detail - Roughness
    const microScale = 0.05; 
    const microH = (interpolatedNoise(x * microScale, y * microScale, seed + 200) - 0.5) * 20;
    
    // 5. Peaks - Mountains & Islands
    const peakScale = 0.008; 
    let peakNoise = interpolatedNoise(x * peakScale, y * peakScale, seed + 500);
    peakNoise = Math.pow(Math.abs(peakNoise), 3); // Make peaks sparse
    
    // Peak Multiplier Logic:
    // If the "Super" value is low, we are in deep ocean, so peaks need to be huge to form islands
    let peakMultiplier = 500;
    if (rawSuper < 0.4) {
        peakMultiplier = 700; 
    } else if (rawSuper > 0.6) {
        peakMultiplier = 1200; 
    }
    
    const peakH = peakNoise * peakMultiplier; 

    let totalHeight = superOffset + macroH + midH + microH + peakH;
    
    // Hard clamp bottom to avoid infinite abyss
    return Math.max(-450, totalHeight);
};

export const generateChunk = (xIndex: number, yIndex: number, seed: number): MapChunk => {
    const id = `chunk_${xIndex}_${yIndex}`;
    const visualResolution = MAP_CONSTANTS.VISUALIZER_GRID_SIZE; 
    const step = MAP_CONSTANTS.CHUNK_SIZE / visualResolution;
    const heights: number[] = [];
    const rivers: number[] = [];
    const startX = xIndex * MAP_CONSTANTS.CHUNK_SIZE;
    const startY = yIndex * MAP_CONSTANTS.CHUNK_SIZE;

    for (let i = 0; i <= visualResolution; i++) {
        for (let j = 0; j <= visualResolution; j++) {
            const wx = startX + i * step;
            const wy = startY + j * step;
            heights.push(getTerrainHeight(wx, wy, seed));
        }
    }

    // Generate Streams (Gradient Descent)
    const rng = new PRNG(seed + xIndex * 37 + yIndex * 113);
    const streamCount = Math.floor(rng.next() * 3) + 2;

    const getIdx = (i: number, j: number) => i * (visualResolution + 1) + j;
    const isValid = (i: number, j: number) => i >= 0 && i <= visualResolution && j >= 0 && j <= visualResolution;

    for (let s = 0; s < streamCount; s++) {
        let startI = -1; let startJ = -1; let maxH = 300; 
        for(let k=0; k<50; k++) {
            const rI = Math.floor(rng.next() * (visualResolution + 1));
            const rJ = Math.floor(rng.next() * (visualResolution + 1));
            const h = heights[getIdx(rI, rJ)];
            if (h > maxH) { maxH = h; startI = rI; startJ = rJ; }
        }
        
        if (startI !== -1) {
            let currI = startI; let currJ = startJ; let currH = heights[getIdx(currI, currJ)];
            let steps = 0;
            while (steps < visualResolution * 4 && currH > MAP_CONSTANTS.SEA_LEVEL) {
                const currentIdx = getIdx(currI, currJ);
                if (!rivers.includes(currentIdx)) {
                    rivers.push(currentIdx);
                    heights[currentIdx] -= 4;
                }
                let minH = currH; let nextI = -1; let nextJ = -1;
                for(let di = -1; di <= 1; di++){
                    for(let dj = -1; dj <= 1; dj++){
                        if (di === 0 && dj === 0) continue;
                        const ni = currI + di; const nj = currJ + dj;
                        if (isValid(ni, nj)) {
                            const nIdx = getIdx(ni, nj);
                            const nh = heights[nIdx];
                            if (nh < minH) { minH = nh; nextI = ni; nextJ = nj; }
                        }
                    }
                }
                if (nextI !== -1) { currI = nextI; currJ = nextJ; currH = minH; } else break;
                steps++;
            }
        }
    }

    return { id, xIndex, yIndex, size: MAP_CONSTANTS.CHUNK_SIZE, heightMap: heights, seed, rivers };
};

export const generateUnknownLocations = (chunk: MapChunk, chunkSeed: number): MapLocation[] => {
    const locations: MapLocation[] = [];
    const rng = new PRNG(chunkSeed + chunk.xIndex * 73856093 ^ chunk.yIndex * 19349663); 
    const count = 1 + Math.floor(rng.next() * 3); 

    for (let i = 0; i < count; i++) {
        const localX = rng.next() * MAP_CONSTANTS.CHUNK_SIZE;
        const localY = rng.next() * MAP_CONSTANTS.CHUNK_SIZE;
        const globalX = chunk.xIndex * MAP_CONSTANTS.CHUNK_SIZE + localX;
        const globalY = chunk.yIndex * MAP_CONSTANTS.CHUNK_SIZE + localY;
        
        const z = getTerrainHeight(globalX, globalY, chunk.seed);
        
        locations.push({
            id: `loc_unk_${globalX.toFixed(0)}_${globalY.toFixed(0)}_${Date.now()}_${Math.floor(rng.next()*1000)}`, 
            name: "未知地点",
            description: z < MAP_CONSTANTS.SEA_LEVEL ? "隐约可见的水下遗迹或沉船。" : "遥远的一处地标，等待探索。",
            coordinates: { x: globalX, y: globalY, z },
            isKnown: false,
            radius: 50,
            associatedNpcIds: [],
            avatarUrl: generateRandomFlagAvatar(true) // Auto blurred avatar for unknown
        });
    }
    return locations;
};

export const generateSettlement = (
    centerX: number, 
    centerY: number, 
    type: TerrainType.CITY | TerrainType.TOWN,
    seed: number, 
    avoidShapes: {vertices: {x:number, y:number}[]}[]
): MapSettlement | null => {
    
    const h = getTerrainHeight(centerX, centerY, seed);
    if (h < MAP_CONSTANTS.SEA_LEVEL) return null;

    const config = type === TerrainType.CITY ? {
        meanArea: 350000, stdDevArea: 120000, minArea: 120000, maxArea: 800000, vertexCountMin: 10, vertexCountVar: 6, irregularity: 0.9
    } : {
        meanArea: 8000, stdDevArea: 3000, minArea: 3000, maxArea: 15000, vertexCountMin: 5, vertexCountVar: 4, irregularity: 0.6
    };

    const shape = generateIrregularPolygon(centerX, centerY, seed, config, avoidShapes);

    return {
        id: `settle_${centerX.toFixed(0)}_${centerY.toFixed(0)}`,
        type,
        name: type === TerrainType.CITY ? "未命名城市" : "未命名村镇",
        vertices: shape.vertices,
        center: shape.center
    };
};

export const generateSettlementsForArea = (xStart: number, yStart: number, width: number, height: number, seed: number, existingSettlements: MapSettlement[]): MapSettlement[] => {
    const newSettlements: MapSettlement[] = [];
    const rng = new PRNG(seed);
    const count = Math.floor(rng.next() * 3) + 2; 

    for (let i = 0; i < count; i++) {
        const cx = xStart + rng.next() * width;
        const cy = yStart + rng.next() * height;
        const type = rng.next() > 0.7 ? TerrainType.CITY : TerrainType.TOWN;
        
        const avoid = [...existingSettlements, ...newSettlements];
        const settle = generateSettlement(cx, cy, type, seed + i * 997, avoid);
        
        if (settle) newSettlements.push(settle);
    }
    return newSettlements;
};

export const getTerrainTypeAt = (
    x: number, y: number, seed: number, 
    chunks?: Record<string, MapChunk>, 
    settlements?: Record<string, MapSettlement>
): { height: number, type: TerrainType } => {
    
    let height = getTerrainHeight(x, y, seed);
    let isRiver = false;

    if (chunks) {
         const cx = Math.floor(x / MAP_CONSTANTS.CHUNK_SIZE);
         const cy = Math.floor(y / MAP_CONSTANTS.CHUNK_SIZE);
         const chunk = chunks[`${cx}_${cy}`];
         if (chunk) {
             const visualRes = MAP_CONSTANTS.VISUALIZER_GRID_SIZE;
             const step = MAP_CONSTANTS.CHUNK_SIZE / visualRes;
             const localX = x - cx * MAP_CONSTANTS.CHUNK_SIZE;
             const localY = y - cy * MAP_CONSTANTS.CHUNK_SIZE;
             const i = Math.round(localX / step);
             const j = Math.round(localY / step);
             
             if (i >= 0 && i <= visualRes && j >= 0 && j <= visualRes) {
                 const idx = i * (visualRes + 1) + j;
                 isRiver = chunk.rivers?.includes(idx) || false;
                 height = chunk.heightMap[idx]; 
             }
         }
    }

    if (isRiver) return { height, type: TerrainType.RIVER };
    if (height < MAP_CONSTANTS.SEA_LEVEL) return { height, type: TerrainType.WATER };

    if (settlements) {
        const point = { x, y };
        for (const s of Object.values(settlements)) {
            const maxR = s.type === TerrainType.CITY ? 2000 : 600; 
            if (Math.abs(x - s.center.x) > maxR || Math.abs(y - s.center.y) > maxR) continue;
            if (isPointInPolygon(point, s.vertices)) return { height, type: s.type };
        }
    }

    return { height, type: TerrainType.LAND };
};

export const analyzeTerrainAround = (x: number, y: number, seed: number, chunks?: Record<string, MapChunk>, settlements?: Record<string, MapSettlement>) => {
    const centerData = getTerrainTypeAt(x, y, seed, chunks, settlements);
    
    const directions = [
        { name: "正北 (North)", dx: 0, dy: 1 },
        { name: "东北 (NorthEast)", dx: 0.7071, dy: 0.7071 },
        { name: "正东 (East)", dx: 1, dy: 0 },
        { name: "东南 (SouthEast)", dx: 0.7071, dy: -0.7071 },
        { name: "正南 (South)", dx: 0, dy: -1 },
        { name: "西南 (SouthWest)", dx: -0.7071, dy: -0.7071 },
        { name: "正西 (West)", dx: -1, dy: 0 },
        { name: "西北 (NorthWest)", dx: -0.7071, dy: 0.7071 },
    ];

    const scanRadius = 1000;
    const stepSize = 50; 
    const steps = scanRadius / stepSize; 

    const surroundings = directions.map(dir => {
        let heightSum = 0;
        let nearestDiffTypeDist: number | null = null;
        let nearestDiffType: TerrainType | null = null;
        
        for (let i = 1; i <= steps; i++) {
            const tx = x + dir.dx * i * stepSize;
            const ty = y + dir.dy * i * stepSize;
            const tData = getTerrainTypeAt(tx, ty, seed, chunks, settlements);
            heightSum += tData.height;
            
            if (nearestDiffTypeDist === null && tData.type !== centerData.type) {
                nearestDiffTypeDist = i * stepSize;
                nearestDiffType = tData.type;
            }
        }
        
        return {
            direction: dir.name,
            avgHeight: Math.round(heightSum / steps),
            nearestDiffTypeDist,
            nearestDiffType
        };
    });

    return {
        x: Math.round(x),
        y: Math.round(y),
        z: Math.round(centerData.height),
        terrainType: centerData.type,
        isUnderwater: centerData.type === TerrainType.WATER,
        surroundings
    };
};

export interface RegionStats {
    minHeight: number;
    maxHeight: number;
    avgHeight: number;
    composition: Record<TerrainType, number>; // Percentage
}

export const analyzeRegionStats = (region: MapRegion, seed: number, chunks?: Record<string, MapChunk>, settlements?: Record<string, MapSettlement>): RegionStats => {
    if (!region.vertices || region.vertices.length === 0) {
        return { minHeight: 0, maxHeight: 0, avgHeight: 0, composition: { [TerrainType.LAND]: 100, [TerrainType.WATER]: 0, [TerrainType.RIVER]: 0, [TerrainType.CITY]: 0, [TerrainType.TOWN]: 0 } };
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    region.vertices.forEach(v => {
        if(v.x < minX) minX = v.x; if(v.x > maxX) maxX = v.x;
        if(v.y < minY) minY = v.y; if(v.y > maxY) maxY = v.y;
    });

    let minHeight = Infinity; let maxHeight = -Infinity;
    let totalHeight = 0; let pointsCount = 0;
    const counts: Record<TerrainType, number> = { [TerrainType.LAND]: 0, [TerrainType.WATER]: 0, [TerrainType.RIVER]: 0, [TerrainType.CITY]: 0, [TerrainType.TOWN]: 0 };
    const step = 50; 

    for (let x = minX; x <= maxX; x += step) {
        for (let y = minY; y <= maxY; y += step) {
            if (isPointInPolygon({x, y}, region.vertices)) {
                const tData = getTerrainTypeAt(x, y, seed, chunks, settlements);
                const h = tData.height;
                if (h < minHeight) minHeight = h;
                if (h > maxHeight) maxHeight = h;
                totalHeight += h;
                counts[tData.type] = (counts[tData.type] || 0) + 1;
                pointsCount++;
            }
        }
    }

    if (pointsCount === 0) return { minHeight: 0, maxHeight: 0, avgHeight: 0, composition: { [TerrainType.LAND]: 100, [TerrainType.WATER]: 0, [TerrainType.RIVER]: 0, [TerrainType.CITY]: 0, [TerrainType.TOWN]: 0 } };

    const composition: any = {};
    Object.keys(counts).forEach(key => {
        const k = key as TerrainType;
        composition[k] = Math.round((counts[k] / pointsCount) * 100);
    });

    return { minHeight: Math.round(minHeight), maxHeight: Math.round(maxHeight), avgHeight: Math.round(totalHeight / pointsCount), composition };
};

export const generateRegion = (centerX: number, centerY: number, seed: number, existingRegions: MapRegion[] = []): MapRegion => {
    const rng = new PRNG(seed);
    const config = { meanArea: 5000000, stdDevArea: 8000000, minArea: 500000, maxArea: 20000000, vertexCountMin: 8, vertexCountVar: 12, irregularity: 1.0 };
    const shape = generateIrregularPolygon(centerX, centerY, seed, config, existingRegions);
    const r = Math.floor(50 + rng.next() * 200);
    const g = Math.floor(50 + rng.next() * 200);
    const b = Math.floor(50 + rng.next() * 200);

    return {
        id: `region_${centerX.toFixed(0)}_${centerY.toFixed(0)}_${Date.now()}`,
        name: "", description: "", vertices: shape.vertices, center: shape.center,
        color: `rgba(${r}, ${g}, ${b}, 0.3)`
    };
};

export const createEnvironmentCharacter = (
    locationId: string, 
    locationName: string, 
    nameSuffix: string = "的环境", 
    descTemplate: string = "【系统代理】{{LOCATION_NAME}}的自然环境。"
): Character => {
    const id = `env_${locationId}`;
    return {
        id,
        isPlayer: false,
        name: `${locationName}${nameSuffix}`,
        appearance: "这个地方的所有东西，所有的风雨，所有的土地，所有的居民……", // Default public appearance
        description: descTemplate.replace("{{LOCATION_NAME}}", locationName),
        avatarUrl: generateRandomFlagAvatar(), // Auto-generate flag avatar
        attributes: {
            '健康': { id: '健康', name: '健康', type: AttributeType.NUMBER, value: 9999, visibility: AttributeVisibility.PUBLIC },
            '状态': { id: '状态', name: '状态', type: AttributeType.TEXT, value: '稳定', visibility: AttributeVisibility.PUBLIC },
            '创造点': { id: '创造点', name: '创造点', type: AttributeType.NUMBER, value: 50, visibility: AttributeVisibility.PUBLIC } // Default 50 CP for parity
        },
        skills: [defaultAcquireCard, defaultTradeCard, defaultInteractCard], // Added Trade Card
        inventory: [],
        drives: [],
        conflicts: [],
        contextConfig: { messages: [] },
        appearanceCondition: "总是存在",
        enableAppearanceCheck: false, 
    };
};

export const generateInitialMap = (config?: InitialWorldConfig): { map: MapState, characters: Record<string, Character> } => {
    const seed = Math.random() * 10000;
    
    // Use provided config or fallback to defaults
    const startRegionName = config?.startRegionName || "都市边缘";
    const startRegionDesc = config?.startRegionDesc || "远离繁华都市的郊区，人烟稀少的安宁地带。";
    const startLocationName = config?.startLocationName || "温馨小窝";
    const startLocationDesc = config?.startLocationDesc || "一切开始的地方。";
    const envCharSuffix = config?.environmentCharNameSuffix || "的环境";
    const envCharDescTmpl = config?.environmentCharDescTemplate || "【系统代理】{{LOCATION_NAME}}的环境旁白角色，根据故事需求讲述自然环境、居民或路人、当地动植物、天气以及突发状况等，如果地点描述可知当地无居民，则不应该提及当地居民。如果当地的环境本身可以和角色互动或者尝试获取角色的物品，旁白可以主动使用相关技能。环境永远不会输出在场角色的台词。"

    const chunks: Record<string, MapChunk> = {};
    const locationsMap: Record<string, MapLocation> = {};
    const settlementsMap: Record<string, MapSettlement> = {};

    for(let x = -1; x <= 1; x++) {
        for(let y = -1; y <= 1; y++) {
            const chunk = generateChunk(x, y, seed);
            chunks[`${x}_${y}`] = chunk;
            const locs = generateUnknownLocations(chunk, seed);
            locs.forEach(l => locationsMap[l.id] = l);
        }
    }
    
    const initialSettlements = generateSettlementsForArea(-1500, -1500, 3000, 3000, seed, []);
    initialSettlements.forEach(s => settlementsMap[s.id] = s);

    const startX = 0; const startY = 0;
    let startZ = getTerrainHeight(startX, startY, seed);
    if (startZ < MAP_CONSTANTS.SEA_LEVEL) startZ = MAP_CONSTANTS.SEA_LEVEL + 5;

    const startRegion = generateRegion(startX, startY, seed, []);
    startRegion.name = startRegionName;
    startRegion.description = startRegionDesc;

    const startLocation: MapLocation = {
        id: 'loc_start_0_0',
        name: startLocationName,
        description: startLocationDesc,
        coordinates: { x: startX, y: startY, z: startZ },
        isKnown: true,
        radius: 60,
        associatedNpcIds: [],
        regionId: startRegion.id,
        terrainType: TerrainType.LAND,
        avatarUrl: generateRandomFlagAvatar(true) // Blurred avatar for initial location
    };

    const envChar = createEnvironmentCharacter(startLocation.id, startLocation.name, envCharSuffix, envCharDescTmpl);
    startLocation.associatedNpcIds.push(envChar.id);

    locationsMap[startLocation.id] = startLocation;

    Object.values(locationsMap).forEach(l => {
        if (!l.regionId && isPointInPolygon(l.coordinates, startRegion.vertices)) {
            l.regionId = startRegion.id;
        }
    });

    return {
        map: {
            chunks: chunks,
            locations: locationsMap,
            regions: { [startRegion.id]: startRegion },
            settlements: settlementsMap,
            charPositions: { [envChar.id]: { x: startX, y: startY, locationId: startLocation.id } },
            activeLocationId: startLocation.id,
            playerCoordinates: { x: 0, y: 0 }
        },
        characters: { [envChar.id]: envChar }
    };
};

export const checkMapExpansion = (playerX: number, playerY: number, currentMap: MapState, seed: number): MapState => {
    const newChunks = { ...currentMap.chunks };
    const newLocations = { ...currentMap.locations };
    const newSettlements = { ...currentMap.settlements };
    let changed = false;

    const pChunkX = Math.floor(playerX / MAP_CONSTANTS.CHUNK_SIZE);
    const pChunkY = Math.floor(playerY / MAP_CONSTANTS.CHUNK_SIZE);

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const targetX = pChunkX + dx;
            const targetY = pChunkY + dy;
            const key = `${targetX}_${targetY}`;

            if (!newChunks[key]) {
                const newChunk = generateChunk(targetX, targetY, seed);
                newChunks[key] = newChunk;
                
                const newLocs = generateUnknownLocations(newChunk, seed);
                newLocs.forEach(l => {
                    for (const region of (Object.values(currentMap.regions) as MapRegion[])) {
                        if (isPointInPolygon(l.coordinates, region.vertices)) {
                            l.regionId = region.id;
                            break;
                        }
                    }
                    if (!newLocations[l.id]) newLocations[l.id] = l;
                });

                const chunkSettlements = generateSettlementsForArea(
                    targetX * MAP_CONSTANTS.CHUNK_SIZE, 
                    targetY * MAP_CONSTANTS.CHUNK_SIZE, 
                    MAP_CONSTANTS.CHUNK_SIZE, 
                    MAP_CONSTANTS.CHUNK_SIZE, 
                    seed + targetX * 100 + targetY,
                    Object.values(newSettlements)
                );
                
                chunkSettlements.forEach(s => newSettlements[s.id] = s);
                changed = true;
            }
        }
    }

    if (!changed) return currentMap;
    return { ...currentMap, chunks: newChunks, locations: newLocations, settlements: newSettlements };
};