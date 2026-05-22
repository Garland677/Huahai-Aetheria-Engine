
import { LogEntry, DebugLog } from "../types";

// Helper to parse multiple time formats to seconds with robustness
export function parseTimeDelta(str: string): number {
    try {
        // 1. Try extracting strict format [DD:HH:MM:SS] first
        const strictMatch = str.match(/(\d+):(\d+):(\d+):(\d+)/);
        if (strictMatch) {
            return parseInt(strictMatch[1])*86400 + parseInt(strictMatch[2])*3600 + parseInt(strictMatch[3])*60 + parseInt(strictMatch[4]);
        }

        // 2. Try extracting HH:MM:SS
        const hmsMatch = str.match(/(\d+):(\d+):(\d+)/);
        if (hmsMatch) {
            return parseInt(hmsMatch[1])*3600 + parseInt(hmsMatch[2])*60 + parseInt(hmsMatch[3]);
        }

        // 3. Try extracting MM:SS
        const msMatch = str.match(/(\d+):(\d+)/);
        if (msMatch) {
            return parseInt(msMatch[1])*60 + parseInt(msMatch[2]);
        }

        // 4. Fallback: Simple natural language parsing (Chinese/English)
        let totalSeconds = 0;
        const days = str.match(/(\d+)\s*(?:d|day|天|日)/i);
        const hours = str.match(/(\d+)\s*(?:h|hour|hr|小时|时)/i);
        const mins = str.match(/(\d+)\s*(?:m|min|minute|分|分钟)/i);
        const secs = str.match(/(\d+)\s*(?:s|sec|second|秒)/i);

        if (days) totalSeconds += parseInt(days[1]) * 86400;
        if (hours) totalSeconds += parseInt(hours[1]) * 3600;
        if (mins) totalSeconds += parseInt(mins[1]) * 60;
        if (secs) totalSeconds += parseInt(secs[1]);

        if (totalSeconds > 0) return totalSeconds;

        // 5. Last resort: plain number check (assume seconds? usually unlikely from AI, but safe fallback)
        if (!isNaN(Number(str))) return Number(str);

    } catch(e) {}
    return 600; // Default 10 mins fallback
}

// Helper for new YYYY:MM:DD:HH:MM:SS format
export function advanceWorldTime(currentStr: string, deltaSeconds: number): string {
    // Parse format: YYYY:MM:DD:HH:MM:SS (supports colon, hyphen, slash, space)
    const parts = currentStr.split(/[:\-\/ ]/).map(s => parseInt(s, 10));
    
    // Validate basic structure (at least Year, Month, Day)
    if (parts.length < 3) return currentStr;

    const year = parts[0];
    const month = parts[1] - 1; // 0-indexed
    const day = parts[2];
    const hour = parts[3] || 0;
    const min = parts[4] || 0;
    const sec = parts[5] || 0;

    const date = new Date(year, month, day, hour, min, sec);
    date.setSeconds(date.getSeconds() + deltaSeconds);

    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const h = date.getHours();
    const mi = date.getMinutes();
    const s = date.getSeconds();

    const pad = (n: number) => n.toString().padStart(2, '0');
    // Output Format: YYYY:MM:DD:HH:MM:SS
    return `${y}:${pad(m)}:${pad(d)}:${pad(h)}:${pad(mi)}:${pad(s)}`;
}

// --- New Utilities for Narrative Time Delta ---

const parseAnyTimeFormat = (str: string): Date | null => {
    if (!str) return null;
    
    // Type 1: Robust Chinese Log Format (YYYY年MM月DD日...)
    // Robust regex: Allow spaces between units and numbers
    const cnMatch = str.match(/(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日(?:\s*(\d+)\s*时)?(?:\s*(\d+)\s*分)?(?:\s*(\d+)\s*秒)?/);
    if (cnMatch) {
        return new Date(
            parseInt(cnMatch[1]), 
            parseInt(cnMatch[2]) - 1, 
            parseInt(cnMatch[3]), 
            parseInt(cnMatch[4] || '0'), 
            parseInt(cnMatch[5] || '0'),
            parseInt(cnMatch[6] || '0')
        );
    }
    
    // Type 2: Standard Delimiters (Colon, Hyphen, Slash)
    // Supports YYYY:MM:DD:HH:MM:SS, YYYY-MM-DD, etc.
    // Try to split by any non-digit sequence and verify we have enough parts
    const parts = str.split(/[^\d]+/).filter(p => p !== "").map(s => parseInt(s, 10));
    if (parts.length >= 3) {
        // Assume YYYY MM DD [HH MM SS]
        return new Date(parts[0], parts[1] - 1, parts[2], parts[3] || 0, parts[4] || 0, parts[5] || 0);
    }
    
    return null;
};

export const getNaturalTimeDelta = (currentStr: string, pastStr: string): string => {
    const curr = parseAnyTimeFormat(currentStr);
    const past = parseAnyTimeFormat(pastStr);

    if (!curr || !past) return "未知时间";

    // Calculate diff in seconds
    let diff = Math.max(0, (curr.getTime() - past.getTime()) / 1000);

    if (diff <= 0) return "很短的时间"; // Truly zero difference

    // Approximate unit calculations
    const years = Math.floor(diff / 31536000); // 365 days
    diff %= 31536000;
    
    const months = Math.floor(diff / 2592000); // 30 days
    diff %= 2592000;
    
    const days = Math.floor(diff / 86400);
    diff %= 86400;
    
    const hours = Math.floor(diff / 3600);
    diff %= 3600;
    
    const minutes = Math.floor(diff / 60);
    const seconds = Math.floor(diff % 60);

    let result = "";
    if (years > 0) result += `${years}年`;
    if (months > 0) result += `${months}个月`;
    if (days > 0) result += `${days}天`;
    if (hours > 0) result += `${hours}小时`;
    if (minutes > 0) result += `${minutes}分钟`;
    
    // If less than a minute, show seconds to avoid "很短的时间" on short steps
    if (result === "" && seconds > 0) {
        result += `${seconds}秒`;
    }

    return result || "很短的时间";
};

/**
 * Calculates how long it has been since a character last acted in the history.
 */
export const calculateLastPresentTime = (
    charId: string, 
    history: LogEntry[], 
    currentWorldTimeStr: string,
    onDebug?: (log: DebugLog) => void,
    options?: { skipFirst?: boolean } // New Options
): string => {
    let debugSteps: string[] = [`Target Char: ${charId}`, `Current World Time: ${currentWorldTimeStr}`, `History Length: ${history.length}`];
    if (options?.skipFirst) debugSteps.push("Mode: Streaming (Skip first match enabled)");

    let actionIndex = -1;
    let matchCount = 0;
    
    // 1. Find last action index (Reverse search)
    // We look for where the character ACTED or REACTED (actingCharId matches)
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].actingCharId === charId) {
            matchCount++;
            
            // If skipping first match (usually the streaming placeholder), continue to next
            if (options?.skipFirst && matchCount === 1) {
                debugSteps.push(`Skipping first match at index ${i} (Streaming placeholder)`);
                continue;
            }

            actionIndex = i;
            break;
        }
    }

    // If character never acted, assume "First Appearance" logic
    if (actionIndex === -1) {
        debugSteps.push("Result: Not found in acting history (First appearance?)");
        if (onDebug) {
            onDebug({
                id: `debug_time_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // Unique ID
                timestamp: Date.now(),
                characterName: "System (TimeCalc)",
                prompt: `Calculating Last Present Time for ${charId}`,
                response: debugSteps.join('\n')
            });
        }
        return "很长时间";
    }

    debugSteps.push(`Found last action at index ${actionIndex} (Log ID: ${history[actionIndex].id})`);

    let foundTimeStr = "";
    const actionLog = history[actionIndex];
    
    // 2. Strategy A: Try to get time from Snapshot (Most Reliable)
    if (actionLog.snapshot && (actionLog.snapshot as any).worldTime) {
        foundTimeStr = String((actionLog.snapshot as any).worldTime);
        debugSteps.push(`Strategy A (Snapshot): Found time ${foundTimeStr}`);
    } else {
        debugSteps.push(`Strategy A (Snapshot): Failed (Snapshot missing or no worldTime)`);
    }

    // 3. Strategy B: Regex Search in surrounding logs (Fallback for old logs)
    if (!foundTimeStr) {
        // Regex: Robustly find time patterns including colon format and Chinese format
        // Matches: 2026:01:01..., 2026年1月1日..., 2026-01-01...
        const timeRegex = /(\d{4}[:\-\/年]\s*\d{1,2}[:\-\/月]\s*\d{1,2}[:\-\/日]?(?:\s*\d{1,2}[:\-\/时]?)?(?:\s*\d{1,2}[:\-\/分]?)?)/;

        debugSteps.push("Strategy B (Regex): Scanning surrounding logs...");

        // Scan Forward first (immediate outcome of action)
        for (let i = actionIndex; i < Math.min(history.length, actionIndex + 5); i++) {
             const match = history[i].content.match(timeRegex);
             if (match) {
                 foundTimeStr = match[1];
                 debugSteps.push(`  -> Found in Forward Scan (Idx ${i}): "${match[0]}"`);
                 break;
             }
        }
        
        // Scan Backward (context before action)
        if (!foundTimeStr) {
            for (let i = actionIndex; i >= Math.max(0, actionIndex - 10); i--) {
                 const match = history[i].content.match(timeRegex);
                 if (match) {
                     foundTimeStr = match[1];
                     debugSteps.push(`  -> Found in Backward Scan (Idx ${i}): "${match[0]}"`);
                     break;
                 }
            }
        }
    }

    // If still no time log found, assume "long time ago" (Start of world)
    if (!foundTimeStr) {
        debugSteps.push("Result: No time string found in context.");
        if (onDebug) {
            onDebug({
                id: `debug_time_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // Unique ID
                timestamp: Date.now(),
                characterName: "System (TimeCalc)",
                prompt: `Calculating Last Present Time for ${charId}`,
                response: debugSteps.join('\n')
            });
        }
        return "很长时间，主角这段时间有自己的故事";
    }

    const delta = getNaturalTimeDelta(currentWorldTimeStr, foundTimeStr);
    debugSteps.push(`Final Calculation: ${currentWorldTimeStr} - ${foundTimeStr} = ${delta}`);
    
    if (delta === "未知时间") {
        debugSteps.push(`Warning: getNaturalTimeDelta returned '未知时间'. Inputs: '${currentWorldTimeStr}', '${foundTimeStr}'`);
    }

    if (onDebug) {
        onDebug({
            id: `debug_time_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // Unique ID
            timestamp: Date.now(),
            characterName: "System (TimeCalc)",
            prompt: `Calculating Last Present Time for ${charId}`,
            response: debugSteps.join('\n')
        });
    }

    return delta;
};
