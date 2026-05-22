
import { LogEntry, Character, MapLocation } from "../../types";
import { ImageContextBuilder } from "./ImageContextBuilder";
import { estimateTokenCount } from "./promptUtils";

// --- EXPORTED HELPER: Check Presence ---
// Centralized logic for checking if a character was present in a log entry
export const isCharPresent = (entry: LogEntry, charId: string): boolean => {
    // --- HIDDEN ROUND CHECK ---
    // If it's a hidden round, only participants can see it
    if (entry.snapshot && entry.snapshot.isHiddenRound) {
         const participants = entry.snapshot.currentOrder || [];
         const isSystem = charId === 'system'; 
         const isEnv = charId.startsWith('env_'); 
         const hasActed = entry.actingCharId === charId;
         const isParticipant = participants.includes(charId) || hasActed;
         
         if (!isParticipant && !isSystem && !isEnv) return false;

         // FIX: If participant, explicitly allow visibility regardless of presentCharIds
         if (isParticipant) return true;
    }
    // ---------------------------

    let isPresent = false;
    
    // Rule 1: Character was explicitly listed as present in the log (Recorded by system when log was created)
    if (entry.presentCharIds && entry.presentCharIds.includes(charId)) isPresent = true;
    
    // Rule 2: Character was the one acting (Self-awareness)
    if (!isPresent && entry.actingCharId === charId) isPresent = true;
    
    // Rule 3: Environment Character Logic (Omniscient for their location)
    if (!isPresent && charId.startsWith('env_')) {
         const suffix = charId.replace('env_', '');
         if (entry.locationId === suffix) isPresent = true;
    }
    
    return isPresent;
};

// --- EXPORTED HELPER: Extract Raw History ---
// Used by import/export logic to get all relevant logs for a character without filtering/decay
export const extractCharacterHistory = (
    history: LogEntry[], 
    charId: string
): LogEntry[] => {
    return history.filter(entry => isCharPresent(entry, charId));
};

// --- NEW HELPER: Get All Character Logs (Raw) ---
// Used by Character Editor to view full, undecayed history
export const getAllCharacterLogs = (
    history: LogEntry[], 
    charId: string,
    legacyLogs?: LogEntry[]
): LogEntry[] => {
    let combinedHistory = history;
    if (legacyLogs && legacyLogs.length > 0) {
        combinedHistory = [...legacyLogs, ...history];
    }
    return combinedHistory.filter(entry => isCharPresent(entry, charId));
};

// --- SHARED FILTER LOGIC ---
const isValidNarrativeContent = (text: string): boolean => {
    // --- Universal Cleaning Phase 2: System Logs ---
    if (text.match(/^(系统|\[系统\])[:：\s]/)) return false;
    if (text.startsWith('系统')) return false; 
    if (text.includes("--- 轮次结算")) return false;
    if (text.includes("--- 第") && text.includes("轮 开始 ---")) return false; // Filter Round Markers for narrative context

    // --- Universal Cleaning Phase 3: Specific Blacklist ---
    if (text.includes("(后台)") || text.includes("正在寻找")) return false;
    if (text.includes("欲望已满足")) return false;
    if (text.includes("新欲望已产生")) return false;
    if (text.includes("引擎全局设置")) return false;
    if (text.includes("快速移动至")) return false;
    if (text.includes("发现当地角色")) return false;
    if (text.includes("视线切换至")) return false;
    if (text.includes("视角已切换至")) return false;
    if (text.includes("初始化完成")) return false;

    // --- Attribute Awakening Filter ---
    // Specifically hide attribute discovery logs from AI memory to prevent meta-gaming hallucinations
    if (text.startsWith('> 属性觉醒') || text.startsWith('＞ 属性觉醒')) return false;

    // === NEW FILTERS (ENHANCED) ===
    if (text.startsWith('>') || text.startsWith('＞')) {
        // Only keep important actions
        const keepKeywords = ["获得", "交易", "抽取", "放入", "查看", "发现", "移动", "燃命", "判定失效", "生效", "被动"];
        if (!keepKeywords.some(k => text.includes(k))) return false;
    }

    return true;
};

// Updated: Applies strict filtering to Global Memory / Short History
export const getGlobalMemory = (
    history: LogEntry[], 
    currentRound: number, 
    roundsToKeep: number = 20, 
    tokenLimit: number = 64000,
    imageBuilder?: ImageContextBuilder
): string => {
    // Heuristic: Reserve about 4000 tokens for system prompt + world state + misc context
    const budget = Math.max(1000, tokenLimit - 4000);
    
    const minRound = Math.max(1, currentRound - roundsToKeep);
    
    // Get candidate entries (Filter by round first to reduce set)
    const candidates = history.filter(e => e.round >= minRound);
    
    // Reverse to process from newest to oldest (prioritize recent content)
    const reversed = [...candidates].reverse();
    const finalSelection: string[] = [];
    let currentTokens = 0;

    for (const entry of reversed) {
        // 1. Clean HTML
        let content = entry.content.replace(/<[^>]+>/g, '').trim();

        // 2. Simplify Time/World Status Logs
        const timeMatch = content.match(/当前故事时间：(.*?)，世界状态：(.*)/);
        if (timeMatch) {
            content = `${timeMatch[1]}，${timeMatch[2]}`;
        }

        // 3. Apply Strict Narrative Filter
        if (!isValidNarrativeContent(content)) {
            continue; 
        }

        if (!content) continue;

        // 4. Image Injection
        if (imageBuilder && entry.images && entry.images.length > 0) {
            const imgTags = entry.images.map(img => {
                const descPart = img.description ? `(你看到：${img.description}) ` : "";
                return `\n${descPart}${imageBuilder.register(img)}`;
            }).join("");
            content += imgTags;
        }

        // 5. Construct Line (Optional: Keep Round prefix for context, or remove it?)
        // Keeping [RX] is useful for turn order logic to gauge time flow, even if we removed the "Round Start" banner.
        const line = `[R${entry.round}] ${content}`; 
        
        const tokens = estimateTokenCount(line);
        if (currentTokens + tokens > budget) {
            break; 
        }
        
        finalSelection.push(line);
        currentTokens += tokens;
    }
    
    // Restore chronological order
    return finalSelection.reverse().join('\n');
};

/**
 * Extracts character-specific memory with Logarithmic Decay Sampling.
 */
export const getCharacterMemory = (
    history: LogEntry[], 
    charId: string, 
    currentLocationId?: string, 
    capacity: number = 10, 
    imageBuilder?: ImageContextBuilder,
    tokenLimit: number = 64000,
    characterMap?: Record<string, Character>,
    locationMap?: Record<string, MapLocation>,
    legacyLogs?: LogEntry[] 
): string => {
    // Combine history: Legacy (Negative/Zero Rounds) + Current
    let combinedHistory = history;
    if (legacyLogs && legacyLogs.length > 0) {
        combinedHistory = [...legacyLogs, ...history];
    }

    if (!combinedHistory || combinedHistory.length === 0) return "";

    const budget = Math.max(1000, tokenLimit - 4000);

    // 1. Group by Round and Filter Presence
    const roundMap = new Map<number, LogEntry[]>();
    
    combinedHistory.forEach(entry => {
        if (isCharPresent(entry, charId)) {
            if (!roundMap.has(entry.round)) roundMap.set(entry.round, []);
            roundMap.get(entry.round)?.push(entry);
        }
    });

    // 2. Identify Rounds to Process (Sorted Newest -> Oldest)
    const participatingRounds = Array.from(roundMap.keys()).sort((a, b) => b - a);
    if (participatingRounds.length === 0) return "";

    const finalBlocks: string[] = [];
    let currentTokens = 0;

    // Buffer for Gap Summary
    let gapBuffer = {
        startRound: -1,
        endRound: -1,
        locs: new Set<string>(),
        chars: new Set<string>()
    };

    const flushGap = () => {
        if (gapBuffer.startRound === -1) return;
        
        const locNames = Array.from(gapBuffer.locs).map(lid => locationMap?.[lid]?.name || "未知地点").filter(n => n !== "未知地点");
        const charNames = Array.from(gapBuffer.chars).map(cid => characterMap?.[cid]?.name || "").filter(n => n);
        
        const locStr = locNames.length > 0 ? `地点: ${locNames.slice(0, 3).join(',')}${locNames.length > 3 ? '...' : ''}` : "";
        const charStr = charNames.length > 0 ? `见过: ${charNames.slice(0, 5).join(',')}${charNames.length > 5 ? '...' : ''}` : "";
        
        const summary = `[R${gapBuffer.startRound}-R${gapBuffer.endRound}概略] ${locStr} ${charStr}`.trim();
        
        const tokens = estimateTokenCount(summary);
        if (currentTokens + tokens <= budget) {
            finalBlocks.push(summary);
            currentTokens += tokens;
        }

        gapBuffer = { startRound: -1, endRound: -1, locs: new Set(), chars: new Set() };
    };

    // 3. Iterate Rounds using INDEX as Age (Experiential Time)
    for (let i = 0; i < participatingRounds.length; i++) {
        if (currentTokens >= budget) break;

        const r = participatingRounds[i];
        const age = i; 
        
        let step = 1;
        if (age >= capacity) {
            const tier = Math.floor(Math.log2(age / capacity)) + 1;
            step = Math.pow(2, tier);
        }

        const shouldKeep = (age % step) === 0;

        if (shouldKeep) {
            flushGap();

            const entries = roundMap.get(r) || [];
            
            const roundLines = entries
                .map(entry => {
                    // 1. Clean HTML
                    let text = entry.content.replace(/<[^>]+>/g, '').trim();

                    // 2. Simplify Time
                    const timeMatch = text.match(/当前故事时间：(.*?)，世界状态：(.*)/);
                    if (timeMatch) {
                        text = `${timeMatch[1]}，${timeMatch[2]}`;
                    }

                    // 3. Use Shared Filter Logic
                    if (!isValidNarrativeContent(text)) return null;

                    if (!text.trim()) return null;

                    // 4. Image Injection
                    if (imageBuilder && entry.images && entry.images.length > 0) {
                        const imgTags = entry.images.map(img => {
                            const descPart = img.description ? `(你看到：${img.description}) ` : "";
                            return `\n${descPart}${imageBuilder.register(img)}`;
                        }).join("");
                        text += imgTags;
                    }
                    
                    return text;
                })
                .filter((line): line is string => line !== null);
            
            const roundText = roundLines.join('\n');
            if (!roundText) continue;

            const tokens = estimateTokenCount(roundText);
            if (currentTokens + tokens > budget) {
                break;
            }

            finalBlocks.push(roundText);
            currentTokens += tokens;

        } else {
            const entries = roundMap.get(r) || [];
            entries.forEach(e => {
                if (e.locationId) gapBuffer.locs.add(e.locationId);
                if (e.presentCharIds) e.presentCharIds.forEach(id => {
                    if (id !== charId) gapBuffer.chars.add(id);
                });
            });

            if (gapBuffer.endRound === -1) gapBuffer.endRound = r;
            gapBuffer.startRound = r;
        }
    }

    flushGap();

    return finalBlocks.reverse().join('\n');
};
