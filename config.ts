
import { Provider, AIConfig } from "./types";

export const DEFAULT_API_CONFIG = {
    [Provider.XAI]: '',
    [Provider.GEMINI]: '',
    [Provider.VOLCANO]: '',
    [Provider.OPENROUTER]: '',
    [Provider.OPENAI]: '',
    [Provider.CLAUDE]: ''
};

export const DEFAULT_AI_CONFIG: AIConfig = {
    provider: Provider.XAI,
    model: 'grok-4-1-fast-reasoning',
    temperature: 1.0
};

export const GAME_CONSTANTS = {
    DEFAULT_MAX_TOKENS: 1024,
    DEFAULT_TEMPERATURE: 1.0,
};
