
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
    
    // Higher vertex count provides smoother clipping against straight edges
    const numVerts = Math.max(40, config.vertexCountMin + Math.floor(rng.next() * config.vertexCountVar) + 20);
    const vertices: {x:number, y:number}[] = [];
    
    // 3. Generate & Clip Vertices
    for(let i = 0; i < numVerts; i++) {
        const theta = (i / numVerts) * Math.PI * 2;
        
        // Add irregularity to radius
        const noise = (rng.next() * 0.4 + 0.8); // 0.8 - 1.2 variation
        const maxR = baseRadius * noise;
        
        // Calculate Ideal Vertex Position
        const targetX = center.x + Math.cos(theta) * maxR;
        const targetY = center.y + Math.sin(theta) * maxR;
        
        const p0 = center;
        const p1 = { x: targetX, y: targetY };

        // 4. Ray-Cast against ALL AvoidPolygons (Clipping)
        // Find the closest intersection point. 
        // If we hit an existing region at 50% distance, the vertex stops there.
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

        // Apply clip with a small buffer (0.02) to avoid exact edge overlapping
        // Ensure we don't collapse to a single point (min 0.05)
        const finalT = Math.max(0.05, minT - 0.02);

        vertices.push({
            x: center.x + (targetX - center.x) * finalT,
            y: center.y + (targetY - center.y) * finalT
        });
    }

    return { vertices, center };
};
