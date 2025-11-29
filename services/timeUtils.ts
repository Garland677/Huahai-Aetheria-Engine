
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
