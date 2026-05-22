
import { Card, Effect } from "../types";
import { generateEffectId } from "./idUtils";

// --- CARD NORMALIZATION UTILITY ---
/**
 * Normalizes a card to enforce game balance rules upon initial creation.
 * Rules:
 * 1. Numeric effect values are capped between -20 and 20.
 * 2. Effect list is trimmed to a maximum of 3 entries.
 * 3. Ensures structural integrity (IDs, default fields) for AI-generated content.
 */
export const normalizeCard = (card: Card): Card => {
    // Deep copy to avoid mutation of source object if it's reused
    const newCard = JSON.parse(JSON.stringify(card));

    // Rule 2: Max 3 effects
    if (newCard.effects && newCard.effects.length > 3) {
        newCard.effects = newCard.effects.slice(0, 3);
    }

    // Used IDs set for generation context (simulated empty set as we want robust randoms)
    const contextIds = new Set<string>();

    // Rule 1 & 3: Cap numeric values and Ensure Structure
    if (newCard.effects) {
        newCard.effects = newCard.effects.map((e: any, index: number) => {
            // 3.1 Ensure ID exists (AI often skips this)
            if (!e.id) {
                // Use Standardized ID Generator
                e.id = generateEffectId(contextIds);
                contextIds.add(e.id);
            }

            // 3.2 Ensure Condition Fields
            if (!e.conditionDescription) e.conditionDescription = "True";
            if (!e.conditionContextKeys) e.conditionContextKeys = [];
            
            // 3.3 Ensure Target Type (Default to specific_char if missing to prevent crash)
            if (!e.targetType) e.targetType = 'specific_char';

            // 1. Cap numeric values [-20, 20]
            // Check if value is numeric or can be cast to number
            const valNum = parseFloat(String(e.value));
            
            // Only clamp if it is a valid number. 
            // If it's a string attribute (e.g. status="Poisoned"), we generally don't clamp.
            if (!isNaN(valNum)) {
                if (valNum > 20) e.value = 20;
                else if (valNum < -20) e.value = -20;
            }
            
            return e as Effect;
        });
    }

    return newCard;
};
