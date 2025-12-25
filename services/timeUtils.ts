
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
    
    // Type 1: Internal Format (YYYY:MM:DD:HH:MM:SS)
    // 2077:01:03:06:33:00
    if (str.includes(':')) {
        const parts = str.split(/[:\-\/ ]/).map(s => parseInt(s, 10));
        if (parts.length >= 3) {
            return new Date(parts[0], parts[1] - 1, parts[2], parts[3] || 0, parts[4] || 0, parts[5] || 0);
        }
    }

    // Type 2: Chinese Log Format (YYYY年MM月DD日HH时MM分)
    // Robust regex: Allow spaces between units
    const cnMatch = str.match(/(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日(?:\s*(\d+)\s*时)?(?:\s*(\d+)\s*分)?/);
    if (cnMatch) {
        return new Date(
            parseInt(cnMatch[1]), 
            parseInt(cnMatch[2]) - 1, 
            parseInt(cnMatch[3]), 
            parseInt(cnMatch[4] || '0'), 
            parseInt(cnMatch[5] || '0')
        );
    }
    
    return null;
};

export const getNaturalTimeDelta = (currentStr: string, pastStr: string): string => {
    const curr = parseAnyTimeFormat(currentStr);
    const past = parseAnyTimeFormat(pastStr);

    if (!curr || !past) return "未知时间";

    // Calculate diff in seconds
    let diff = Math.max(0, (curr.getTime() - past.getTime()) / 1000);

    if (diff <= 0) return "片刻"; // Truly zero difference

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
    
    // If less than a minute, show seconds to avoid "片刻" on short steps
    if (result === "" && seconds > 0) {
        result += `${seconds}秒`;
    }

    return result || "片刻";
};
