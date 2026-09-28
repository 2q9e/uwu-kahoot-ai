
export const DEFAULT_MODEL = 'gpt-5-mini';
export const DEFAULT_VISION_MODEL = 'gpt-4.1';
export const DEFAULT_AI_PROVIDER = 'openai';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.8-flash';
export const DEFAULT_OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b-20260604:free';
export const DEFAULT_OPENROUTER_VISION_MODEL = 'nex-agi/nex-n2.5-mini:free';
export const DEFAULT_GEMINI_FAST_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_OPENROUTER_FAST_MODEL = 'inclusionai/ling-3.0-flash-vl:free';
export const DEFAULT_OPENROUTER_REASONING_EFFORT = 'none';
export const DEPRECATED_MODELS = new Set([
  'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'gpt-4-turbo',
  'gpt-4', 'gpt-4-1106-preview', 'gpt-4-0125-preview',
  'gpt-4.5-preview', 'o1', 'o1-mini', 'o1-preview', 'o3-mini'
]);
export const MIN_TEXT_MATCH_SCORE = 0.85;
