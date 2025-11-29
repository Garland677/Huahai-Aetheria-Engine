
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { GameState, MapLocation, MapChunk, CharPosition, MapRegion, TerrainType } from '../../types';
import { MAP_CONSTANTS } from '../../constants';
import { getTerrainHeight, isPointInPolygon, getTerrainTypeAt } from '../../services/mapUtils';
import { Maximize, Minimize, Compass, Crosshair, Navigation, PlusCircle, ZoomIn, ZoomOut } from 'lucide-react';

interface MapVisualizerProps {
    state: GameState;
    onLocationSelect: (locId: string) => void;
    viewingLocationId?: string | null;
    onCreateLocation?: (x: number, y: number) => void;
}

interface ScreenPoint { x: number, y: number, depth: number }

interface RenderObject {
    type: 'terrain' | 'water' | 'location' | 'char' | 'region_point' | 'region_boundary' | 'building_face';
    depth: number;
    // Terrain/Region/Building props
    points?: ScreenPoint[];
    color?: string;
    borderColor?: string;
    // Sprite/Point props
    x?: number;
    y?: number;
    z?: number; 
    size?: number;
    label?: string;
    isKnown?: boolean;
    isSelected?: boolean;
    isActive?: boolean;
    id?: string;
    charCount?: number; 
}

// Adjusted Color Stops for sharper transitions and lower snow line (300m)
const COLOR_STOPS = [
    { h: -300, r: 5, g: 10, b: 40 },    // Abyss
    { h: -50, r: 10, g: 30, b: 90 },    // Deep Water
    { h: 0, r: 30, g: 80, b: 160 },     // Water Surface
    { h: 2, r: 210, g: 190, b: 140 },   // Beach Start
    { h: 12, r: 210, g: 190, b: 140 },  // Beach End (Sharp transition)
    { h: 15, r: 50, g: 140, b: 60 },    // Grass Start
    { h: 150, r: 40, g: 120, b: 50 },   // Grass End
    { h: 160, r: 100, g: 90, b: 80 },   // Rock/Highland Start
    { h: 240, r: 90, g: 85, b: 85 },    // Rock/Highland End
    { h: 250, r: 200, g: 210, b: 220 }, // Snow Transition Start
    { h: 350, r: 255, g: 255, b: 255 }  // Pure Snow
];

const getTerrainColor = (z: number, type: TerrainType = TerrainType.LAND) => {
    if (type === TerrainType.CITY) return `rgb(100, 116, 139)`; // Concrete Gray
    if (type === TerrainType.TOWN) return `rgb(105, 105, 105)`; // Dark Gray (Town Base)

    if (z < MAP_CONSTANTS.SEA_LEVEL) {
        // Deeper Blue for water body
        return `rgba(30, 80, 160, 0.8)`;
    }

    let lower = COLOR_STOPS[2]; 
    let upper = COLOR_STOPS[COLOR_STOPS.length - 1];
    
    for (let i = 2; i < COLOR_STOPS.length - 1; i++) {
        if (z >= COLOR_STOPS[i].h && z <= COLOR_STOPS[i+1].h) {
            lower = COLOR_STOPS[i];
            upper = COLOR_STOPS[i+1];
            break;
        }
    }
    
    const range = upper.h - lower.h;
    const t = range === 0 ? 0 : Math.max(0, Math.min(1, (z - lower.h) / range));
    
    const r = Math.round(lower.r + (upper.r - lower.r) * t);
    const g = Math.round(lower.g + (upper.g - lower.g) * t);
    const b = Math.round(lower.b + (upper.b - lower.b) * t);
    return `rgb(${r},${g},${b})`;
};

const darkenColor = (rgbStr: string, amount: number = 0.8) => {
    const match = rgbStr.match(/\d+/g);
    if (!match) return rgbStr;
    const [r, g, b] = match.map(Number);
    return `rgb(${Math.round(r * amount)},${Math.round(g * amount)},${Math.round(b * amount)})`;
};

const pseudoRandom = (x: number, y: number) => {
    return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
};

// Cached Grid Point Structure
interface VisualGridPoint {
    wx: number; wy: number; 
    centerX: number; centerY: number;
    step: number;
    z00: number; z10: number; z11: number; z01: number;
    avgZ: number;
    type: TerrainType;
    isCity: boolean;
    isTown: boolean;
    hasBuilding: boolean;
    bHeight: number;
    bPrn: number;
}

export const MapVisualizer: React.FC<MapVisualizerProps> = ({ state, onLocationSelect, viewingLocationId, onCreateLocation }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    const [isExpanded, setIsExpanded] = useState(false);
    const [isCreatingLocation, setIsCreatingLocation] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
    
    const [yaw, setYaw] = useState(0); 
    const [pitch, setPitch] = useState(Math.PI / 2.5); 
    const [scale, setScale] = useState(0.55);
    const [pan, setPan] = useState({ x: 0, y: 0, z: 0 });
    
    // REF FOR CAMERA STATE (Fixes touch listener stale closures without re-binding)
    const cameraRef = useRef({ yaw, pitch, scale, pan });
    useEffect(() => { cameraRef.current = { yaw, pitch, scale, pan }; }, [yaw, pitch, scale, pan]);

    // VISUAL CACHE
    const [visualGrid, setVisualGrid] = useState<VisualGridPoint[]>([]);

    const activeLocationId = state.map.activeLocationId;

    const interactionState = useRef({
        isDragging: false,
        dragButton: -1,
        hasMoved: false 
    });
    
    // Touch Interaction Refs
    const touchState = useRef({
        lastDistance: 0,
        lastMidpoint: { x: 0, y: 0 },
        lastSingle: { x: 0, y: 0 },
        isZooming: false
    });

    const getZ = (x: number, y: number) => {
        const cx = Math.floor(x / MAP_CONSTANTS.CHUNK_SIZE);
        const cy = Math.floor(y / MAP_CONSTANTS.CHUNK_SIZE);
        const chunk = state.map.chunks[`${cx}_${cy}`];
        return chunk ? getTerrainHeight(x, y, chunk.seed) : 0;
    };

    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentBoxSize) {
                    setDimensions({ width: entry.contentBoxSize[0].inlineSize, height: entry.contentBoxSize[0].blockSize });
                }
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [isExpanded]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setScale(prev => Math.max(0.02, Math.min(5.0, prev - e.deltaY * 0.0005)));
        };
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, [isExpanded]); 

    // --- GRID GENERATION / CACHING ---
    useEffect(() => {
        const chunks = Object.values(state.map.chunks) as MapChunk[];
        const settlements = state.map.settlements || {};
        const points: VisualGridPoint[] = [];

        chunks.forEach(chunk => {
            const dataLen = chunk.heightMap.length;
            const visualRes = Math.sqrt(dataLen) - 1;
            const step = chunk.size / visualRes;
            const startX = chunk.xIndex * chunk.size;
            const startY = chunk.yIndex * chunk.size;

            for(let i=0; i<visualRes; i++) {
                for(let j=0; j<visualRes; j++) {
                    const wx = startX + i * step;
                    const wy = startY + j * step;
                    const centerX = wx + step/2;
                    const centerY = wy + step/2;

                    const idx00 = i * (visualRes + 1) + j;
                    const idx10 = (i+1) * (visualRes + 1) + j;
                    const idx11 = (i+1) * (visualRes + 1) + j + 1;
                    const idx01 = i * (visualRes + 1) + j + 1;

                    const z00 = chunk.heightMap[idx00] ?? 0;
                    const z10 = chunk.heightMap[idx10] ?? 0;
                    const z11 = chunk.heightMap[idx11] ?? 0;
                    const z01 = chunk.heightMap[idx01] ?? 0;
                    const avgZ = (z00 + z10 + z11 + z01)/4;

                    const tData = getTerrainTypeAt(centerX, centerY, chunk.seed, { [`${chunk.xIndex}_${chunk.yIndex}`]: chunk }, settlements);
                    const type = tData.type;
                    const isCity = type === TerrainType.CITY;
                    const isTown = type === TerrainType.TOWN;

                    let hasBuilding = false;
                    let bHeight = 0;
                    let bPrn = 0;

                    if (isCity || isTown) {
                        bPrn = pseudoRandom(centerX, centerY);
                        const density = isCity ? 0.6 : 0.4;
                        if (bPrn > (1 - density)) {
                            hasBuilding = true;
                            bHeight = isCity ? (20 + bPrn * 80) : (8 + bPrn * 15);
                        }
                    }

                    points.push({
                        wx, wy, centerX, centerY, step,
                        z00, z10, z11, z01, avgZ,
                        type, isCity, isTown,
                        hasBuilding, bHeight, bPrn
                    });
                }
            }
        });
        setVisualGrid(points);
    }, [state.map.chunks, state.map.settlements]);


    const resetView = () => {
        let targetX = 0;
        let targetY = 0;
        let targetZ = 0;

        if (state.map.activeLocationId && state.map.locations[state.map.activeLocationId]) {
            const loc = state.map.locations[state.map.activeLocationId];
            targetX = loc.coordinates.x;
            targetY = loc.coordinates.y;
            targetZ = loc.coordinates.z;
        } else {
            targetZ = getZ(0, 0);
        }

        setPan({ x: targetX, y: targetY, z: targetZ });
        setYaw(0); 
        setPitch(Math.PI / 2.5); 
        setScale(0.55); 
    };

    useEffect(() => {
        if (activeLocationId && pan.x === 0 && pan.y === 0) {
            resetView();
        }
    }, [activeLocationId]); 

    // --- RENDER LOOP ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = dimensions.width * dpr;
        canvas.height = dimensions.height * dpr;
        ctx.scale(dpr, dpr);
        
        const width = dimensions.width;
        const height = dimensions.height;
        const cx = width / 2;
        const cy = height / 2;

        const project = (x: number, y: number, z: number): ScreenPoint => {
            const wx = (x - pan.x);
            const wy = (y - pan.y);
            
            const rx = wx * Math.cos(yaw) - wy * Math.sin(yaw);
            const ry = wx * Math.sin(yaw) + wy * Math.cos(yaw); 
            
            const relativeZ = z - pan.z;
            const screenX = cx + rx * scale;
            const screenY = cy - ry * scale * Math.cos(pitch) - relativeZ * scale * Math.sin(pitch); 
            
            return { x: screenX, y: screenY, depth: ry };
        };

        const drawRenderObject = (obj: RenderObject) => {
            if (obj.type === 'location') {
                ctx.beginPath(); ctx.moveTo(obj.x!, obj.y!); ctx.lineTo(obj.x!, obj.z!);
                ctx.strokeStyle = obj.isKnown ? 'rgba(255, 255, 255, 0.5)' : 'rgba(148, 163, 184, 0.5)';
                ctx.lineWidth = 1; ctx.stroke();
                
                ctx.beginPath(); ctx.arc(obj.x!, obj.y!, obj.size!, 0, Math.PI * 2);
                ctx.fillStyle = obj.isActive ? '#ef4444' : (obj.isKnown ? '#0ea5e9' : '#64748b');
                ctx.fill();
                ctx.lineWidth = obj.isSelected ? 3 : 2;
                ctx.strokeStyle = obj.isSelected ? '#fde047' : 'white';
                ctx.stroke();

                if (obj.charCount && obj.charCount > 0) {
                     ctx.fillStyle = '#ffffff';
                     ctx.font = 'bold 10px sans-serif';
                     ctx.textAlign = 'center';
                     ctx.textBaseline = 'middle';
                     ctx.fillText(obj.charCount.toString(), obj.x!, obj.y!);
                }
                
                if (scale > 0.15 || obj.isSelected || obj.isActive) {
                    ctx.font = 'bold 11px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                    ctx.strokeText(obj.label || '', obj.x! + obj.size! + 6, obj.y! + 4);
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(obj.label || '', obj.x! + obj.size! + 6, obj.y! + 4);
                }
            } else if (obj.type === 'char') {
                ctx.beginPath(); ctx.arc(obj.x!, obj.y!, obj.size!/2, 0, Math.PI*2);
                ctx.fillStyle = '#f43f5e'; ctx.fill();
                ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.stroke();
            } else if (obj.type === 'region_point') {
                ctx.beginPath(); 
                ctx.arc(obj.x!, obj.y!, obj.size!, 0, Math.PI * 2);
                ctx.fillStyle = obj.color || 'rgba(255,255,255,0.5)';
                ctx.fill();
            } else if (obj.type === 'region_boundary') {
                if (obj.points && obj.points.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(obj.points[0].x, obj.points[0].y);
                    for (let i = 1; i < obj.points.length; i++) {
                        ctx.lineTo(obj.points[i].x, obj.points[i].y);
                    }
                    ctx.closePath();
                    ctx.strokeStyle = obj.color || 'white';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 2]);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    if (obj.label) {
                         let lx = 0, ly = 0;
                         obj.points.forEach(p => { lx += p.x; ly += p.y; });
                         lx /= obj.points.length; ly /= obj.points.length;
                         ctx.font = 'italic bold 10px sans-serif';
                         ctx.textAlign = 'center';
                         ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                         ctx.strokeText(obj.label, lx, ly);
                         ctx.fillStyle = obj.color || 'white';
                         ctx.fillText(obj.label, lx, ly);
                    }
                }
            } else {
                if (!obj.points) return;
                ctx.beginPath();
                ctx.moveTo(obj.points[0].x, obj.points[0].y);
                for(let i=1; i<obj.points.length; i++) ctx.lineTo(obj.points[i].x, obj.points[i].y);
                ctx.closePath();
                ctx.fillStyle = obj.color!;
                ctx.fill();
                if ((obj.type === 'terrain' || obj.type === 'building_face') && scale > 0.2) {
                    ctx.strokeStyle = obj.borderColor || obj.color!;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        };

        const render = () => {
            ctx.clearRect(0, 0, width, height);
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, '#0f172a'); 
            grad.addColorStop(1, '#1e293b'); 
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            const worldQueue: RenderObject[] = [];
            const overlayQueue: RenderObject[] = [];
            const regions = Object.values(state.map.regions || {}) as MapRegion[];
            const cullMargin = 100;
            const faceNormalsX = [Math.sin(yaw), Math.cos(yaw), -Math.sin(yaw), -Math.cos(yaw)];

            for (const pt of visualGrid) {
                const p00 = project(pt.wx, pt.wy, 0); 
                if (p00.x < -cullMargin || p00.x > width + cullMargin || p00.y < -cullMargin || p00.y > height + cullMargin) {
                     if (p00.depth < 0) continue; 
                }
                const pp00 = project(pt.wx, pt.wy, pt.z00);
                const pp10 = project(pt.wx + pt.step, pt.wy, pt.z10);
                const pp11 = project(pt.wx + pt.step, pt.wy + pt.step, pt.z11);
                const pp01 = project(pt.wx, pt.wy + pt.step, pt.z01);
                const centerP = project(pt.centerX, pt.centerY, pt.avgZ);

                if (pt.type === TerrainType.WATER) {
                    const waterZ = MAP_CONSTANTS.SEA_LEVEL;
                    const w00 = project(pt.wx, pt.wy, waterZ);
                    const w10 = project(pt.wx + pt.step, pt.wy, waterZ);
                    const w11 = project(pt.wx + pt.step, pt.wy + pt.step, waterZ);
                    const w01 = project(pt.wx, pt.wy + pt.step, waterZ);
                    worldQueue.push({ type: 'water', depth: centerP.depth, points: [w00, w10, w11, w01], color: 'rgba(30, 80, 160, 0.6)' });
                } else if (pt.type === TerrainType.RIVER) {
                    worldQueue.push({ type: 'terrain', depth: centerP.depth, points: [pp00, pp10, pp11, pp01], color: 'rgb(40, 90, 160)', borderColor: 'rgba(100, 150, 255, 0.3)' });
                } else {
                    worldQueue.push({ type: 'terrain', depth: centerP.depth, points: [pp00, pp10, pp11, pp01], color: getTerrainColor(pt.avgZ, pt.type), borderColor: darkenColor(getTerrainColor(pt.avgZ, pt.type), 0.85) });
                    if (pt.hasBuilding && scale > 0.1) {
                         const bWidth = pt.step * 0.6;
                         const bx = pt.centerX - bWidth/2;
                         const by = pt.centerY - bWidth/2;
                         const baseZ = pt.avgZ;
                         const topZ = baseZ + pt.bHeight;
                         const roofColor = 'rgb(241, 245, 249)';
                         const sideColorBase = pt.isCity ? 'rgb(203, 213, 225)' : 'rgb(168, 162, 158)';
                         const getFaceDepth = (p1: ScreenPoint, p2: ScreenPoint, p3: ScreenPoint, p4: ScreenPoint) => (p1.depth + p2.depth + p3.depth + p4.depth) / 4;
                         const getFaceColor = (idx: number) => { const nx = faceNormalsX[idx]; if (nx < 0) return sideColorBase; return darkenColor(sideColorBase, 0.7); };
                         const bb0 = project(bx, by, baseZ); const bb1 = project(bx+bWidth, by, baseZ); const bb2 = project(bx+bWidth, by+bWidth, baseZ); const bb3 = project(bx, by+bWidth, baseZ);
                         const bt0 = project(bx, by, topZ); const bt1 = project(bx+bWidth, by, topZ); const bt2 = project(bx+bWidth, by+bWidth, topZ); const bt3 = project(bx, by+bWidth, topZ);
                         worldQueue.push({ type: 'building_face', depth: getFaceDepth(bb0, bb1, bt1, bt0), points: [bb0, bb1, bt1, bt0], color: getFaceColor(0), borderColor: darkenColor(getFaceColor(0), 0.8) });
                         worldQueue.push({ type: 'building_face', depth: getFaceDepth(bb1, bb2, bt2, bt1), points: [bb1, bb2, bt2, bt1], color: getFaceColor(1), borderColor: darkenColor(getFaceColor(1), 0.8) });
                         worldQueue.push({ type: 'building_face', depth: getFaceDepth(bb2, bb3, bt3, bt2), points: [bb2, bb3, bt3, bt2], color: getFaceColor(2), borderColor: darkenColor(getFaceColor(2), 0.8) });
                         worldQueue.push({ type: 'building_face', depth: getFaceDepth(bb3, bb0, bt0, bt3), points: [bb3, bb0, bt0, bt3], color: getFaceColor(3), borderColor: darkenColor(getFaceColor(3), 0.8) });
                         worldQueue.push({ type: 'building_face', depth: getFaceDepth(bt0, bt1, bt2, bt3), points: [bt0, bt1, bt2, bt3], color: roofColor, borderColor: '#cbd5e1' });
                    }
                }
                if (Math.round(pt.wx) % (pt.step*3) === 0 && Math.round(pt.wy) % (pt.step*3) === 0) {
                     for (const region of regions) {
                         if (isPointInPolygon({ x: pt.centerX, y: pt.centerY }, region.vertices)) {
                             const drawZ = Math.max(pt.avgZ, MAP_CONSTANTS.SEA_LEVEL) + 2;
                             const pReg = project(pt.centerX, pt.centerY, drawZ);
                             overlayQueue.push({ type: 'region_point', depth: pReg.depth - 0.2, x: pReg.x, y: pReg.y, size: 1.5, color: region.color ? region.color.replace(/[\d.]+\)$/, '0.6)') : 'rgba(255,255,255,0.4)' });
                             break; 
                         }
                     }
                }
            }

            regions.forEach(region => {
                const projectedVerts = region.vertices.map(v => { const z = getZ(v.x, v.y) + 50; return project(v.x, v.y, z); });
                const avgDepth = projectedVerts.reduce((s, p) => s + p.depth, 0) / projectedVerts.length;
                overlayQueue.push({ type: 'region_boundary', depth: avgDepth, points: projectedVerts, color: region.color ? region.color.replace(/[\d.]+\)$/, '1.0)') : 'white', label: region.name });
            });

            (Object.values(state.map.locations) as MapLocation[]).forEach(loc => {
                const terrainZ = getZ(loc.coordinates.x, loc.coordinates.y);
                const displayZ = Math.max(terrainZ, MAP_CONSTANTS.SEA_LEVEL) + 120; 
                const screen = project(loc.coordinates.x, loc.coordinates.y, displayZ);
                const groundScreen = project(loc.coordinates.x, loc.coordinates.y, Math.max(terrainZ, MAP_CONSTANTS.SEA_LEVEL));
                if (screen.x < -50 || screen.x > width + 50 || screen.y < -50 || screen.y > height + 50) return;
                let count = 0; (Object.values(state.map.charPositions) as CharPosition[]).forEach(pos => { if (pos.locationId === loc.id) count++; });
                overlayQueue.push({ type: 'location', depth: screen.depth, x: screen.x, y: screen.y, z: groundScreen.y, size: Math.max(8, 16 * scale), label: loc.name, isKnown: loc.isKnown, isSelected: loc.id === viewingLocationId, isActive: loc.id === activeLocationId, id: loc.id, charCount: count });
            });
            
            worldQueue.sort((a, b) => b.depth - a.depth);
            overlayQueue.sort((a, b) => b.depth - a.depth);
            worldQueue.forEach(drawRenderObject);
            overlayQueue.forEach(drawRenderObject);
        };

        const raf = requestAnimationFrame(render);
        return () => cancelAnimationFrame(raf);
    }, [visualGrid, yaw, pitch, scale, pan, state.map.activeLocationId, viewingLocationId, dimensions, state.map.locations, state.map.regions]);

    const raycastGround = (mx: number, my: number): { x: number, y: number } | null => {
         const cx = dimensions.width / 2;
         const cy = dimensions.height / 2;
         const dx = (mx - cx) / scale;
         const dy = (my - cy) / scale;
         const rx = dx;
         const ry = -dy / Math.cos(pitch);
         const cos = Math.cos(yaw);
         const sin = Math.sin(yaw);
         const wx = rx * cos + ry * sin;
         const wy = -rx * sin + ry * cos;
         return { x: pan.x + wx, y: pan.y + wy };
    };

    const performRaycast = (mx: number, my: number): string | null => {
         const cx = dimensions.width / 2; 
         const cy = dimensions.height / 2;
         let hitId = null; let minDist = 30; 
         (Object.values(state.map.locations) as MapLocation[]).forEach(loc => {
             const terrainZ = getZ(loc.coordinates.x, loc.coordinates.y);
             const wx = (loc.coordinates.x - pan.x); 
             const wy = (loc.coordinates.y - pan.y);
             const rx = wx * Math.cos(yaw) - wy * Math.sin(yaw); 
             const ry = wx * Math.sin(yaw) + wy * Math.cos(yaw);
             const relativeZ = (Math.max(terrainZ, MAP_CONSTANTS.SEA_LEVEL)+120) - pan.z;
             const sx = cx + rx * scale; 
             const sy = cy - ry * scale * Math.cos(pitch) - relativeZ * scale * Math.sin(pitch);
             const dist = Math.sqrt((sx - mx)**2 + (sy - my)**2);
             if (dist < minDist) { minDist = dist; hitId = loc.id; }
         });
         return hitId;
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.requestPointerLock();
        interactionState.current.isDragging = true;
        interactionState.current.dragButton = e.button;
        interactionState.current.hasMoved = false;
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (document.pointerLockElement === canvasRef.current) {
            document.exitPointerLock();
        }
        if (!interactionState.current.hasMoved) {
            const canvas = canvasRef.current;
            if (canvas && interactionState.current.dragButton === 0) {
                 const rect = canvas.getBoundingClientRect();
                 const scaleX = dimensions.width / rect.width; 
                 const scaleY = dimensions.height / rect.height;
                 const mx = (e.clientX - rect.left) * scaleX; 
                 const my = (e.clientY - rect.top) * scaleY;
                 
                 if (isCreatingLocation && onCreateLocation) {
                     const ground = raycastGround(mx, my);
                     if (ground) {
                         onCreateLocation(Math.round(ground.x), Math.round(ground.y));
                         setIsCreatingLocation(false);
                     }
                 } else {
                     const hitId = performRaycast(mx, my);
                     if (hitId) onLocationSelect(hitId);
                 }
            }
        }
        interactionState.current.isDragging = false;
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (document.pointerLockElement !== canvasRef.current) return;
            const dx = e.movementX;
            const dy = e.movementY;
            if (dx !== 0 || dy !== 0) interactionState.current.hasMoved = true;
            const button = interactionState.current.dragButton;

            if (button === 2) {
                // Right Click Pan
                const s = cameraRef.current.scale;
                const cp = Math.max(0.1, Math.cos(cameraRef.current.pitch)); 
                
                const dRx = dx / s;
                const dRy = -dy / (s * cp);
                
                const cos = Math.cos(cameraRef.current.yaw);
                const sin = Math.sin(cameraRef.current.yaw);
                
                const dWx = dRx * cos + dRy * sin;
                const dWy = -dRx * sin + dRy * cos;

                setPan(prev => {
                    const nextX = prev.x - dWx;
                    const nextY = prev.y - dWy; 
                    const nextZ = getZ(nextX, nextY);
                    return { x: nextX, y: nextY, z: nextZ };
                });
            } else {
                // Left Click Rotate
                setYaw(prev => prev + dx * 0.005);
                setPitch(prev => Math.max(0.1, Math.min(Math.PI / 2 - 0.1, prev - dy * 0.005)));
            }
        };
        document.addEventListener('mousemove', handleMouseMove);
        return () => document.removeEventListener('mousemove', handleMouseMove);
    }, []); // Empty dependency array - using Ref for calculations implicitly via setPan updater or global events
    
    // --- NATIVE TOUCH HANDLERS (Ref-based for stability) ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                touchState.current.lastSingle = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            } else if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                touchState.current.lastDistance = Math.sqrt(dx * dx + dy * dy);
                touchState.current.lastMidpoint = {
                    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
                };
                touchState.current.isZooming = true;
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (e.cancelable) e.preventDefault(); // Prevent browser zoom/scroll

            // USE REFS for calculation to avoid re-binding listeners
            const currentYaw = cameraRef.current.yaw;
            const currentPitch = cameraRef.current.pitch;
            const currentScale = cameraRef.current.scale;

            if (e.touches.length === 1 && !touchState.current.isZooming) {
                // Single Finger -> Rotate
                const dx = e.touches[0].clientX - touchState.current.lastSingle.x;
                const dy = e.touches[0].clientY - touchState.current.lastSingle.y;
                
                setYaw(prev => prev + dx * 0.01);
                setPitch(prev => Math.max(0.1, Math.min(Math.PI / 2 - 0.1, prev - dy * 0.01)));
                
                touchState.current.lastSingle = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                
            } else if (e.touches.length === 2) {
                // Two Finger -> Zoom + Pan
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const deltaDist = dist - touchState.current.lastDistance;
                
                setScale(prev => Math.max(0.02, Math.min(5.0, prev + deltaDist * 0.005)));
                touchState.current.lastDistance = dist;

                const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                
                const panDx = mx - touchState.current.lastMidpoint.x;
                const panDy = my - touchState.current.lastMidpoint.y;
                
                const s = currentScale;
                const cp = Math.max(0.1, Math.cos(currentPitch)); 
                const dRx = panDx / s; 
                const dRy = -panDy / (s * cp);
                
                const cos = Math.cos(currentYaw);
                const sin = Math.sin(currentYaw);
                
                const dWx = dRx * cos + dRy * sin;
                const dWy = -dRx * sin + dRy * cos;

                setPan(prev => {
                    const nextX = prev.x - dWx;
                    const nextY = prev.y - dWy; 
                    const nextZ = getZ(nextX, nextY);
                    return { x: nextX, y: nextY, z: nextZ };
                });

                touchState.current.lastMidpoint = { x: mx, y: my };
            }
        };

        const onTouchEnd = (e: TouchEvent) => {
             if (e.touches.length === 0) {
                 touchState.current.isZooming = false;
             }
        };

        // Add with passive: false to allow preventDefault
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });

        return () => {
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
        };
    }, [isExpanded]); // Add isExpanded to dependency to re-bind when portal moves

    const normalContainerClass = "relative w-full h-64 bg-black overflow-hidden border-b border-slate-800";
    const expandedContainerClass = "fixed inset-0 z-[200] bg-slate-950 flex flex-col touch-none"; // Added touch-none
    const cursorClass = isCreatingLocation ? "cursor-copy" : "cursor-crosshair";
    const compassRotation = (yaw * 180 / Math.PI);

    const MapContent = (
        <div 
            className={isExpanded ? expandedContainerClass : normalContainerClass}
            style={{ touchAction: 'none' }} // Force browser to ignore native gestures
        >
            {/* HUD Elements */}
            <div className="absolute top-2 left-2 z-10 pointer-events-none opacity-80">
                <div className="w-12 h-12 bg-black/30 rounded-full border border-slate-600 backdrop-blur flex items-center justify-center shadow-lg" style={{ transform: `rotate(${compassRotation}deg)` }}>
                    <div className="w-0.5 h-full bg-slate-700 absolute"></div>
                    <div className="w-full h-0.5 bg-slate-700 absolute"></div>
                    <div className="absolute top-1 font-bold text-[10px] text-red-500">N</div>
                    <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-red-500 absolute top-2"></div>
                </div>
            </div>

            <div className="absolute top-2 right-2 z-10 flex gap-2">
                 {onCreateLocation && (
                     <button 
                        onClick={() => setIsCreatingLocation(!isCreatingLocation)} 
                        className={`p-1.5 rounded border shadow-lg transition-colors ${isCreatingLocation ? 'bg-yellow-600 text-white border-yellow-400' : 'bg-slate-800/80 hover:bg-indigo-600 text-white border-slate-600'}`}
                        title="Add Custom Location"
                    >
                        <PlusCircle size={16}/>
                    </button>
                 )}
                 <button onClick={resetView} className="p-1.5 bg-slate-800/80 hover:bg-indigo-600 text-white rounded border border-slate-600 shadow-lg transition-colors" title="Reset View (North Up)">
                    <Navigation size={16}/>
                </button>
                 <button onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 bg-slate-800/80 hover:bg-indigo-600 text-white rounded border border-slate-600 shadow-lg transition-colors" title={isExpanded ? "Minimize Map" : "Maximize Map"}>
                    {isExpanded ? <Minimize size={16}/> : <Maximize size={16}/>}
                </button>
            </div>
            
            {isCreatingLocation && (
                 <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-yellow-900/80 text-yellow-100 px-3 py-1 rounded-full text-xs font-bold border border-yellow-500 z-20 pointer-events-none animate-pulse">
                     点击地图任意位置以标记新地点
                 </div>
            )}

            {isExpanded && (
                <div className="absolute bottom-2 left-2 z-10 bg-black/60 px-2 py-1 rounded text-xs text-slate-300 pointer-events-none">
                    <b>Controls:</b> Click: Select | Left Drag/1-Finger: Rotate | Right Drag/2-Finger: Pan/Zoom
                </div>
            )}
            <div ref={containerRef} className="w-full h-full overflow-hidden touch-none">
                <canvas 
                    ref={canvasRef} 
                    className={`w-full h-full block outline-none ${cursorClass}`} 
                    style={{ touchAction: 'none' }}
                    tabIndex={0} 
                    onMouseDown={handleMouseDown} 
                    onMouseUp={handleMouseUp} 
                    onContextMenu={e => e.preventDefault()}
                />
            </div>
            {!isExpanded && (
                <div className="absolute bottom-2 right-2 pointer-events-none text-[10px] text-slate-500 font-mono shadow-black drop-shadow-md flex items-center gap-2 bg-black/40 px-2 rounded">
                    <Crosshair size={10}/> 
                    <span>{pan.x.toFixed(0)}, {pan.y.toFixed(0)}, {pan.z.toFixed(0)}</span>
                </div>
            )}
        </div>
    );

    if (isExpanded) return createPortal(MapContent, document.body);
    return MapContent;
};
