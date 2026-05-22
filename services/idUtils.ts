

/**
 * Standardized ID Generation Utilities
 */

// Generate a random numeric string of given length
const randomNumericId = (length: number): string => {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += Math.floor(Math.random() * 10).toString();
    }
    return result;
};

// Helper to check existence regardless of collection type
const exists = (checkId: string, existingIds: Set<string> | string[] | Record<string, any> | any[]): boolean => {
    if (Array.isArray(existingIds)) {
        if (existingIds.length > 0 && typeof existingIds[0] === 'object' && 'id' in existingIds[0]) {
             // Handle object array like Card[]
             return (existingIds as any[]).some(item => item.id === checkId);
        }
        return (existingIds as string[]).includes(checkId);
    }
    if (existingIds instanceof Set) return existingIds.has(checkId);
    return Object.prototype.hasOwnProperty.call(existingIds, checkId);
};

// Character ID: char + 8 digits
export const generateCharacterId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    let id = '';
    let isUnique = false;
    while (!isUnique) {
        id = `char_${randomNumericId(8)}`;
        if (!exists(id, existingIds)) {
            isUnique = true;
        }
    }
    return id;
};

// Location ID: loc + 6 digits
export const generateLocationId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    let id = '';
    let isUnique = false;
    while (!isUnique) {
        id = `loc_${randomNumericId(6)}`;
        if (!exists(id, existingIds)) {
            isUnique = true;
        }
    }
    return id;
};

// Card ID: c + 6 digits (Short for AI context efficiency)
export const generateCardId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    let id = '';
    let isUnique = false;
    while (!isUnique) {
        id = `c_${randomNumericId(6)}`;
        if (!exists(id, existingIds)) {
            isUnique = true;
        }
    }
    return id;
};

// Conflict ID: conf + 6 digits
export const generateConflictId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('conf', existingIds);
};

// Drive ID: drv + 6 digits
export const generateDriveId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('drv', existingIds);
};

// Prize Pool ID: pool + 6 digits
export const generatePrizePoolId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('pool', existingIds);
};

// Prize Item ID: pi + 6 digits
export const generatePrizeItemId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('pi', existingIds);
};

// Trigger Group ID: trigrp + 6 digits
export const generateTriggerGroupId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('trigrp', existingIds);
};

// Trigger ID: trig + 6 digits
export const generateTriggerId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('trig', existingIds);
};

// Trigger Condition ID: cond + 6 digits
export const generateConditionId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('cond', existingIds);
};

// Trigger Effect ID: eff + 6 digits
export const generateEffectId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('eff', existingIds);
};

// Attribute ID: attr + 6 digits
export const generateAttributeId = (existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    return generateShortId('attr', existingIds);
};

// Generic Short ID: prefix + 6 digits (e.g. item_123456)
export const generateShortId = (prefix: string, existingIds: Set<string> | string[] | Record<string, any> | any[]): string => {
    let id = '';
    let isUnique = false;
    while (!isUnique) {
        id = `${prefix}_${randomNumericId(6)}`;
        if (!exists(id, existingIds)) {
            isUnique = true;
        }
    }
    return id;
};

// Environment Character ID: env + locationId
export const getEnvCharId = (locationId: string): string => {
    return `env_${locationId}`;
};
