
import localforage from 'localforage';
import { base64ToBlob, blobToBase64 } from './imageUtils';

// Initialize separate store for images
const imageStore = localforage.createInstance({
    name: 'AetheriaEngine',
    storeName: 'image_blobs',
    description: 'Storage for large image blobs'
});

// In-memory cache for mapping: UUID <-> Blob URL
// This prevents creating duplicate Blob URLs for the same image
const urlCache = new Map<string, string>(); // ID -> BlobURL
const idCache = new Map<string, string>();  // BlobURL -> ID
const blobCache = new Map<string, Blob>();  // ID -> Blob (Optional, for quick AI access)

export const imageStorage = {
    /**
     * Saves a base64 string or Blob to DB and returns a unique ID.
     * Also registers the runtime Blob URL immediately.
     */
    saveImage: async (data: string | Blob): Promise<{ id: string, url: string }> => {
        let blob: Blob;
        if (typeof data === 'string') {
            blob = base64ToBlob(data);
        } else {
            blob = data;
        }

        // Generate ID (Simple random or hash-like)
        const id = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        await imageStore.setItem(id, blob);
        
        const url = URL.createObjectURL(blob);
        urlCache.set(id, url);
        idCache.set(url, id);
        blobCache.set(id, blob);

        return { id, url };
    },

    /**
     * Gets a Blob URL for a given ID. 
     * Uses cache if available, otherwise loads from DB.
     */
    getUrl: async (id: string): Promise<string | null> => {
        if (!id) return null;
        if (urlCache.has(id)) return urlCache.get(id)!;

        try {
            const blob = await imageStore.getItem<Blob>(id);
            if (blob) {
                const url = URL.createObjectURL(blob);
                urlCache.set(id, url);
                idCache.set(url, id);
                blobCache.set(id, blob);
                return url;
            }
        } catch (e) {
            console.error(`Failed to load image ${id}:`, e);
        }
        return null;
    },

    /**
     * Given a Blob URL (e.g. from React State), retrieves the original Blob or Base64.
     * Used by AI Service to send data to API.
     */
    resolveBase64: async (urlOrId: string): Promise<string | null> => {
        // Case 1: Input is already Base64
        if (urlOrId.startsWith('data:')) return urlOrId;

        let id = urlOrId;
        
        // Case 2: Input is Blob URL -> Find ID
        if (urlOrId.startsWith('blob:')) {
            if (idCache.has(urlOrId)) {
                id = idCache.get(urlOrId)!;
            } else {
                // If we don't have ID mapping (rare), we can try fetching the blob url directly
                try {
                    const res = await fetch(urlOrId);
                    const blob = await res.blob();
                    return await blobToBase64(blob);
                } catch (e) {
                    return null;
                }
            }
        }

        // Load Blob by ID
        let blob = blobCache.get(id);
        if (!blob) {
            blob = await imageStore.getItem<Blob>(id) || undefined;
        }

        if (blob) {
            return await blobToBase64(blob);
        }
        return null;
    },

    /**
     * Recursively traverses the state object to Hydrate (ID -> BlobURL).
     * Also migrates legacy Base64 strings to DB.
     */
    hydrateState: async (state: any): Promise<any> => {
        if (!state) return state;
        
        // Helper to process a single value
        const processValue = async (val: any): Promise<any> => {
            if (typeof val === 'string') {
                // Legacy Migration: Found Base64
                if (val.startsWith('data:image/')) {
                    // Check if it's a tiny placeholder (ignore) or real image (>1KB)
                    if (val.length > 1024) {
                        try {
                            const { url } = await imageStorage.saveImage(val);
                            return url;
                        } catch (e) {
                            return val; // Keep original if fail
                        }
                    }
                    return val;
                }
                // Standard Hydration: Found ID reference
                if (val.startsWith('img_')) {
                    const url = await imageStorage.getUrl(val);
                    return url || val; // Fallback to ID if not found (UI might show broken img)
                }
            }
            return val;
        };

        // Recursive walker
        const walker = async (obj: any): Promise<any> => {
            if (Array.isArray(obj)) {
                return Promise.all(obj.map(item => walker(item)));
            }
            if (obj && typeof obj === 'object') {
                const newObj: any = {};
                for (const key in obj) {
                    const val = obj[key];
                    // Optimization: Only check fields that likely contain images
                    const isLikelyImageField = 
                        key === 'avatarUrl' || 
                        key === 'imageUrl' || 
                        key === 'base64' || // GameImage.base64
                        key === 'url';      // LibraryImage.url

                    if (typeof val === 'string' && isLikelyImageField) {
                        newObj[key] = await processValue(val);
                    } else if (typeof val === 'object' || Array.isArray(val)) {
                        newObj[key] = await walker(val);
                    } else {
                        newObj[key] = val;
                    }
                }
                return newObj;
            }
            return obj;
        };

        return await walker(state);
    },

    /**
     * Recursively traverses state to export full Base64 data for portable saves.
     */
    exportState: async (state: any): Promise<any> => {
        if (!state) return state;

        const processValue = async (val: any): Promise<any> => {
            if (typeof val === 'string') {
                let id = val;
                // If it's a blob url, try to map to ID
                if (val.startsWith('blob:')) {
                    if (idCache.has(val)) id = idCache.get(val)!;
                    else return val; // Can't resolve, return as is (risk of data loss, but avoids corruption)
                }
                
                // If it's an ID, load blob and convert to base64
                if (id.startsWith('img_')) {
                    try {
                        const blob = await imageStore.getItem<Blob>(id);
                        if (blob) {
                            return await blobToBase64(blob);
                        }
                    } catch (e) {
                        console.warn(`Export failed for image ${id}`, e);
                    }
                }
            }
            return val;
        };

        const walker = async (obj: any): Promise<any> => {
            if (Array.isArray(obj)) {
                return Promise.all(obj.map(item => walker(item)));
            }
            if (obj && typeof obj === 'object') {
                const newObj: any = {};
                for (const key in obj) {
                    const val = obj[key];
                    
                    // Same heuristic as hydrateState for consistency
                    const isLikelyImageField = 
                        key === 'avatarUrl' || 
                        key === 'imageUrl' || 
                        key === 'base64' || 
                        key === 'url';

                    if (typeof val === 'string' && isLikelyImageField) {
                        newObj[key] = await processValue(val);
                    } else if (typeof val === 'object' || Array.isArray(val)) {
                        newObj[key] = await walker(val);
                    } else {
                        newObj[key] = val;
                    }
                }
                return newObj;
            }
            return obj;
        };

        return await walker(state);
    },

    /**
     * Recursively traverses the state to Dehydrate (BlobURL -> ID) for saving.
     */
    dehydrateState: (state: any): any => {
        // Synchronous walker because mappings are in memory (idCache)
        if (!state) return state;

        const walker = (obj: any): any => {
            if (Array.isArray(obj)) {
                return obj.map(item => walker(item));
            }
            if (obj && typeof obj === 'object') {
                const newObj: any = {};
                for (const key in obj) {
                    const val = obj[key];
                     // Check if value is a known Blob URL
                    if (typeof val === 'string' && val.startsWith('blob:') && idCache.has(val)) {
                        newObj[key] = idCache.get(val);
                    } else if (typeof val === 'object' || Array.isArray(val)) {
                        newObj[key] = walker(val);
                    } else {
                        newObj[key] = val;
                    }
                }
                return newObj;
            }
            return obj;
        };

        return walker(state);
    },
    
    // Cleanup memory (optional, e.g. on game reset)
    cleanup: () => {
        urlCache.forEach(url => URL.revokeObjectURL(url));
        urlCache.clear();
        idCache.clear();
        blobCache.clear();
    }
};
