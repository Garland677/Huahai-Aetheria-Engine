
// Utility for AES-GCM Encryption using Web Crypto API

// ---------------------------------------------------------------------------
// VERSION KEY CONFIGURATION
// 修改此字符串以隔离不同版本的存档。
// Modify this string to invalidate saves from previous versions (or vice versa).
const VERSION_KEY = "v1_stable";
// ---------------------------------------------------------------------------

// Helper to avoid stack overflow on large buffers when converting to Base64
function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    const CHUNK_SIZE = 0x8000; // 32768

    for (let i = 0; i < len; i += CHUNK_SIZE) {
        // Use apply with a limited chunk to avoid stack overflow
        // TypeScript needs 'any' or specific casting because apply accepts array-like, and subarray is TypedArray
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)) as unknown as number[]);
    }
    return window.btoa(binary);
}

// Helper to convert Base64 back to Uint8Array efficiently
function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// 1. Generate a 256-bit key from the filename AND version key using SHA-256
async function getKeyFromFilename(filename: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    // Combine filename with version key to ensure version compatibility
    const data = encoder.encode(filename + VERSION_KEY);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    return window.crypto.subtle.importKey(
        'raw',
        hash,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

// 2. Encrypt string data
export async function encryptData(content: string, filename: string): Promise<string> {
    const key = await getKeyFromFilename(filename);
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(content);

    // Generate random IV (Initialization Vector)
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv as any // Cast to satisfy TS environment differences
        },
        key,
        encodedData
    );

    // Combine IV and Ciphertext for storage
    const ivBase64 = bufferToBase64(iv.buffer);
    const cipherBase64 = bufferToBase64(encryptedBuffer);

    return `${ivBase64}:${cipherBase64}`;
}

// 3. Decrypt string data
export async function decryptData(encryptedStr: string, filename: string): Promise<string> {
    const parts = encryptedStr.split(':');
    if (parts.length !== 2) {
        throw new Error("Invalid encrypted file format.");
    }

    const iv = base64ToUint8Array(parts[0]);
    const ciphertext = base64ToUint8Array(parts[1]);
    
    const key = await getKeyFromFilename(filename);

    try {
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv as any // Cast to satisfy TS environment differences
            },
            key,
            ciphertext as any // Cast to satisfy TS environment differences
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    } catch (e) {
        console.error(e);
        throw new Error("Decryption failed. The filename must match or the save file version is incompatible.");
    }
}
