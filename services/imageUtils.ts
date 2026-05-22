
import { ImageSettings } from "../types";

/**
 * Image Processing Service
 * Handles resizing, constraints, and compression.
 */

// Helper to strip the Data URL prefix
export const stripBase64Prefix = (dataUrl: string): string => {
    return dataUrl.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
};

export const base64ToBlob = (base64: string): Blob => {
    const arr = base64.split(',');
    const match = arr[0].match(/:(.*?);/);
    const mime = match ? match[1] : 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error("Failed to convert blob to base64"));
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/**
 * Processes an image (File or Base64 string) according to settings.
 */
export const processImage = async (
    source: File | string, 
    settings: ImageSettings
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const { maxShortEdge = 896, maxLongEdge = 4480, compressionQuality = 0.95 } = settings;

        const img = new Image();
        
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            const shortEdge = Math.min(width, height);
            
            // 1. Resize if short edge > limit
            if (shortEdge > maxShortEdge) {
                const ratio = maxShortEdge / shortEdge;
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            // 2. Check Constraint: Long edge > limit
            const newLongEdge = Math.max(width, height);
            if (newLongEdge > maxLongEdge) {
                reject(new Error(`图片过长 (长边 ${newLongEdge}px > ${maxLongEdge}px)。请在裁剪模式中调整。`));
                return;
            }

            // 3. Draw to Canvas and Compress
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
                reject(new Error("无法创建画布上下文"));
                return;
            }

            // Smooth resizing
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // 4. Export as PNG to preserve transparency for pixel art
            // Note: compressionQuality is ignored for PNG, which is lossless. 
            // File size is managed via resolution constraints (maxShortEdge).
            const dataUrl = canvas.toDataURL('image/png');
            
            resolve(dataUrl);
        };

        img.onerror = () => reject(new Error("图片加载失败"));

        // Load Source
        if (typeof source === 'string') {
            img.src = source;
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.onerror = () => reject(new Error("文件读取失败"));
            reader.readAsDataURL(source);
        }
    });
};
