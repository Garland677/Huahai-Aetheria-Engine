
import { Character, Card, GameState } from '../types';
import { getAttr } from './attributeUtils';

// --- Types ---

export interface HACommand {
    type: string; // e.g., "HR"
    args: string[]; // e.g., ["1", "0"]
    sourceId: string; // Character ID or Card ID where this was found
}

export interface HiddenRoundConfig {
    roundOrder: number; // 1, 2, 3...
    characterIds: string[]; // Ordered list of character IDs for this hidden round
}

// --- Parsing Logic ---

/**
 * Parses HA commands from a text string.
 * Format: /HA,TYPE,ARG1,ARG2.../
 */
export const parseHACommands = (text: string, sourceId: string): HACommand[] => {
    if (!text) return [];
    
    // Regex to find /HA, ... / patterns
    // Matches /HA, then captures TYPE, then optionally captures rest of args
    const regex = /\/HA,([A-Z0-9]+)(?:,([^/]*))?\//g;
    const commands: HACommand[] = [];
    
    let match;
    while ((match = regex.exec(text)) !== null) {
        const type = match[1];
        const argsStr = match[2] || "";
        const args = argsStr.split(',').map(s => s.trim());
        
        commands.push({
            type,
            args,
            sourceId
        });
    }
    
    return commands;
};

/**
 * Extracts all HA commands associated with a character.
 * Scans: Character Name, Character Description, Inventory Cards (Name/Desc), Skills (Name/Desc)
 */
export const extractHAFromCharacter = (char: Character, cardPool: Card[]): HACommand[] => {
    const commands: HACommand[] = [];

    // 1. Character Name & Description
    commands.push(...parseHACommands(char.name, char.id));
    commands.push(...parseHACommands(char.description, char.id));

    // 2. Skills
    char.skills.forEach(skill => {
        commands.push(...parseHACommands(skill.name, skill.id));
        commands.push(...parseHACommands(skill.description, skill.id));
    });

    // 3. Inventory
    char.inventory.forEach(itemId => {
        const item = cardPool.find(c => c.id === itemId);
        if (item) {
            commands.push(...parseHACommands(item.name, item.id));
            commands.push(...parseHACommands(item.description, item.id));
        }
    });

    return commands;
};

// --- Hidden Round (HR) Logic ---

interface HREntry {
    charId: string;
    roundOrder: number; // 0 means all
    turnOrder: number; // 0 means auto (end)
    physique: number;
}

/**
 * Calculates the structure of hidden rounds based on current characters and their cards.
 */
export const calculateHiddenRoundStructure = (characters: Record<string, Character>, cardPool: Card[]): HiddenRoundConfig[] => {
    const charList = Object.values(characters);
    const entries: HREntry[] = [];

    // 1. Collect all HR directives
    charList.forEach(char => {
        const cmds = extractHAFromCharacter(char, cardPool);
        const hrCmds = cmds.filter(c => c.type === 'HR');

        if (hrCmds.length > 0) {
            // Get Physique for sorting
            const physique = getAttr(char, 'physique')?.value || getAttr(char, '体能')?.value || 0;

            hrCmds.forEach(cmd => {
                // Arg 0: Round Order (default 0/All)
                const roundOrder = parseInt(cmd.args[0]) || 0;
                // Arg 1: Turn Order (default 0/Auto)
                const turnOrder = parseInt(cmd.args[1]) || 0;

                // Deduplication Key: CharID + RoundOrder + TurnOrder
                // We will filter duplicates later or check existence now
                const key = `${char.id}_${roundOrder}_${turnOrder}`;
                
                // Check if we already have this exact definition for this char
                const exists = entries.some(e => 
                    e.charId === char.id && 
                    e.roundOrder === roundOrder && 
                    e.turnOrder === turnOrder
                );

                if (!exists) {
                    entries.push({
                        charId: char.id,
                        roundOrder,
                        turnOrder,
                        physique: Number(physique)
                    });
                }
            });
        }
    });

    if (entries.length === 0) return [];

    // 2. Determine distinct round orders
    // If roundOrder is 0, it applies to ALL identified rounds.
    // First, find max explicit round order.
    let maxRound = 0;
    entries.forEach(e => {
        if (e.roundOrder > maxRound) maxRound = e.roundOrder;
    });

    // If no explicit rounds (only 0s), treat as Round 1
    if (maxRound === 0) maxRound = 1;

    const result: HiddenRoundConfig[] = [];

    // 3. Build each round
    for (let r = 1; r <= maxRound; r++) {
        // Filter entries for this round (Specific Round OR Round 0)
        // We do NOT use a Map<charId> anymore because a char can appear multiple times
        
        const roundEntries: HREntry[] = [];
        
        entries.forEach(e => {
            if (e.roundOrder === r || e.roundOrder === 0) {
                roundEntries.push(e);
            }
        });

        if (roundEntries.length === 0) continue;

        // Separate fixed vs auto
        const fixed = roundEntries.filter(e => e.turnOrder > 0);
        const auto = roundEntries.filter(e => e.turnOrder <= 0);

        // Sort fixed by TurnOrder asc, then Physique desc
        fixed.sort((a, b) => {
            if (a.turnOrder !== b.turnOrder) return a.turnOrder - b.turnOrder;
            return b.physique - a.physique;
        });

        // Sort auto by Physique desc
        auto.sort((a, b) => b.physique - a.physique);

        // Merge
        // Strategy: Place fixed items into their slots (1-based index). 
        
        const slots: Record<number, HREntry[]> = {};
        
        fixed.forEach(e => {
            if (!slots[e.turnOrder]) slots[e.turnOrder] = [];
            slots[e.turnOrder].push(e);
        });
        
        // Flatten slots
        const sortedFixed: HREntry[] = [];
        const slotKeys = Object.keys(slots).map(Number).sort((a, b) => a - b);
        
        slotKeys.forEach(k => {
            // Sort entries in this slot by physique
            slots[k].sort((a, b) => b.physique - a.physique);
            sortedFixed.push(...slots[k]);
        });
        
        const finalRoundOrder = [...sortedFixed, ...auto].map(e => e.charId);
        
        result.push({
            roundOrder: r,
            characterIds: finalRoundOrder
        });
    }

    return result;
};
