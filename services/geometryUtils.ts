
// Simple Pseudo Random Number Generator
export class PRNG {
    seed: number;
    constructor(seed: number) {
        this.seed = seed % 2147483647;
        if (this.seed <= 0) this.seed += 2147483646;
    }
    next() {
        return (this.seed = this.seed * 16807 % 2147483647) / 2147483647;
    }
}

// Ray-casting algorithm for point in polygon check
export const isPointInPolygon = (point: {x: number, y: number}, vs: {x: number, y: number}[]) => {
    const x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].x, yi = vs[i].y;
        const xj = vs[j].x, yj = vs[j].y;
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

// Helper: Get intersection parameter t (0..1) of Ray(p0->p1) against Segment(p2->p3)
// Returns null if no intersection or parallel
const getLineIntersectionT = (p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}): number | null => {
    const s1_x = p1.x - p0.x;
    const s1_y = p1.y - p0.y;
    const s2_x = p3.x - p2.x;
    const s2_y = p3.y - p2.y;

    const denom = -s2_x * s1_y + s1_x * s2_y;
    if (Math.abs(denom) < 1e-9) return null; // Collinear / Parallel

    const s = (-s1_y * (p0.x - p2.x) + s1_x * (p0.y - p2.y)) / denom;
    const t = ( s2_x * (p0.y - p2.y) - s2_y * (p0.x - p2.x)) / denom;

    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        return t; // Intersection detected at 't' along p0->p1
    }
    return null;
};

interface PolygonConfig {
    meanArea: number;
    stdDevArea: number;
    minArea: number;
    maxArea: number;
    vertexCountMin: number;
    vertexCountVar: number;
    irregularity: number; 
}

/**
 * Generates an irregular polygon with Radial Ray Clipping.
 * Instead of shrinking the whole polygon upon overlap, it trims individual vertices
 * that extend into existing polygons (avoidPolygons).
 * 
 * UPDATE: Uses Valtr Algorithm to ensure the initial shape is a Convex Polygon.
 */
export const generateIrregularPolygon = (
    centerX: number, 
    centerY: number, 
    seed: number, 
    config: PolygonConfig,
    avoidPolygons: {vertices: {x:number, y:number}[]}[] = []
): { vertices: {x:number, y:number}[], center: {x:number, y:number} } => {
    
    const rng = new PRNG(seed);
    const center = { x: centerX, y: centerY };

    // 1. Center Repulsion (Keep origin out of existing polygons)
    // If the random center is inside an existing region, push it out.
    let safety = 0;
    while (safety < 20) {
        let inside = false;
        for (const ex of avoidPolygons) {
            if (isPointInPolygon(center, ex.vertices)) {
                inside = true;
                break;
            }
        }
        if (!inside) break;
        
        // Push randomly
        const ang = rng.next() * Math.PI * 2;
        const dist = 500 + rng.next() * 500;
        center.x += Math.cos(ang) * dist;
        center.y += Math.sin(ang) * dist;
        safety++;
    }

    // 2. Generate Base Radial Polygon Params
    const u1 = rng.next() || 0.001;
    const u2 = rng.next() || 0.001;
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    
    let area = config.meanArea + z * config.stdDevArea;
    area = Math.max(config.minArea, Math.min(config.maxArea, area));
    
    const baseRadius = Math.sqrt(area / Math.PI);
    
    // Higher vertex count provides smoother clipping
    const numVerts = Math.max(20, config.vertexCountMin + Math.floor(rng.next() * config.vertexCountVar));
    
    // --- 3. GENERATE CONVEX POLYGON (Valtr Algorithm) ---
    
    // A. Generate random sorted X offsets
    const xVal: number[] = [];
    for(let i=0; i<numVerts; i++) xVal.push(rng.next());
    xVal.sort((a,b) => a-b);
    
    const xMin = xVal[0];
    const xMax = xVal[numVerts-1];
    
    // B. Generate random sorted Y offsets
    const yVal: number[] = [];
    for(let i=0; i<numVerts; i++) yVal.push(rng.next());
    yVal.sort((a,b) => a-b);
    
    const yMin = yVal[0];
    const yMax = yVal[numVerts-1];

    // C. Divide X into two chains
    const xChain1: number[] = [xMin];
    const xChain2: number[] = [xMin];
    for (let i = 1; i < numVerts - 1; i++) {
        if (rng.next() < 0.5) xChain1.push(xVal[i]);
        else xChain2.push(xVal[i]);
    }
    xChain1.push(xMax);
    xChain2.push(xMax);
    
    // D. Divide Y into two chains
    const yChain1: number[] = [yMin];
    const yChain2: number[] = [yMin];
    for (let i = 1; i < numVerts - 1; i++) {
        if (rng.next() < 0.5) yChain1.push(yVal[i]);
        else yChain2.push(yVal[i]);
    }
    yChain1.push(yMax);
    yChain2.push(yMax);

    // E. Create Vector Components
    const xVecs: number[] = [];
    for(let i=0; i<xChain1.length-1; i++) xVecs.push(xChain1[i+1] - xChain1[i]);
    for(let i=0; i<xChain2.length-1; i++) xVecs.push(xChain2[i] - xChain2[i+1]);
    
    const yVecs: number[] = [];
    for(let i=0; i<yChain1.length-1; i++) yVecs.push(yChain1[i+1] - yChain1[i]);
    for(let i=0; i<yChain2.length-1; i++) yVecs.push(yChain2[i] - yChain2[i+1]);

    // F. Shuffle Y components to randomize shape
    // Fisher-Yates shuffle
    for (let i = yVecs.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [yVecs[i], yVecs[j]] = [yVecs[j], yVecs[i]];
    }

    // G. Combine and Sort Vectors by Angle
    const vecs = xVecs.map((x, i) => ({ x, y: yVecs[i] }));
    vecs.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    
    // H. Lay out vertices
    let currentX = 0, currentY = 0;
    let rawVertices = [];
    let minPolyX = 0, maxPolyX = 0, minPolyY = 0, maxPolyY = 0;
    
    for(const v of vecs) {
        rawVertices.push({ x: currentX, y: currentY });
        currentX += v.x;
        currentY += v.y;
        minPolyX = Math.min(minPolyX, currentX);
        maxPolyX = Math.max(maxPolyX, currentX);
        minPolyY = Math.min(minPolyY, currentY);
        maxPolyY = Math.max(maxPolyY, currentY);
    }

    // I. Center the polygon at (0,0) relative
    // Calculate centroid
    let cx = 0, cy = 0;
    for(const v of rawVertices) { cx += v.x; cy += v.y; }
    cx /= rawVertices.length;
    cy /= rawVertices.length;
    
    rawVertices = rawVertices.map(v => ({ x: v.x - cx, y: v.y - cy }));

    // J. Scale to fit desired size (BaseRadius)
    // Measure average radius of the generated unit polygon
    let currentAvgR = 0;
    for(const v of rawVertices) {
        currentAvgR += Math.sqrt(v.x*v.x + v.y*v.y);
    }
    currentAvgR /= rawVertices.length;
    
    const scaleFactor = baseRadius / (currentAvgR || 1);

    // --- 4. APPLY TO WORLD & CLIP ---
    const finalVertices: {x:number, y:number}[] = [];

    for(const v of rawVertices) {
        // Apply scale and position relative to requested Center
        const targetX = center.x + v.x * scaleFactor;
        const targetY = center.y + v.y * scaleFactor;
        
        // Ray-Cast against ALL AvoidPolygons (Clipping)
        // Find the closest intersection point. 
        const p0 = center;
        const p1 = { x: targetX, y: targetY };
        let minT = 1.0;

        for (const poly of avoidPolygons) {
            // Optimization: Could check bounding box here
            const vs = poly.vertices;
            for (let j = 0; j < vs.length; j++) {
                const p2 = vs[j];
                const p3 = vs[(j + 1) % vs.length];
                
                const t = getLineIntersectionT(p0, p1, p2, p3);
                if (t !== null && t < minT) {
                    minT = t;
                }
            }
        }

        // Apply clip with a small buffer to avoid exact edge overlapping
        const finalT = Math.max(0.05, minT - 0.02);

        finalVertices.push({
            x: center.x + (targetX - center.x) * finalT,
            y: center.y + (targetY - center.y) * finalT
        });
    }

    return { vertices: finalVertices, center };
};
