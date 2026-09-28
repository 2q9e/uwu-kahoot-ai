import { DEFAULT_GEMINI_FAST_MODEL, DEFAULT_OPENROUTER_FAST_MODEL } from '../core/constants.js';

export const FAST_BINARY_ENABLED_KEY = 'fastBinaryAnswersEnabled';
export const FAST_MODEL_SETTING_KEYS = {
  openai: 'openaiFastModel',
  gemini: 'geminiFastModel',
  openrouter: 'openrouterFastModel'
};
export const FAST_MODEL_CATALOG_KEYS = {
  openai: '',
  gemini: 'uwuKahootModelCatalogV1_gemini',
  openrouter: 'uwuKahootModelCatalogV1_openrouter'
};
export const GEMINI_SPEED_STORAGE_KEY = 'uwuKahootGeminiSpeedV2';

export function getTrueFalseChoiceIndices(choices) {
  if (!Array.isArray(choices) || choices.length !== 2) return null;
  const values = choices.map(choice => String(choice ?? '').trim().toLowerCase());
  const trueIndex = values.indexOf('true');
  const falseIndex = values.indexOf('false');
  return trueIndex >= 0 && falseIndex >= 0 ? { trueIndex, falseIndex } : null;
}

export function parseStrictTrueFalse(value) {
  const match = String(value ?? '').trim().match(/^(true|false)$/i);
  return match ? match[1].toLowerCase() === 'true' : null;
}

export function chooseFastBinaryModel(provider, models = [], geminiSpeeds = {}, primaryModel = '') {
  const candidates = Array.isArray(models)
    ? models.filter(model => model?.id && model.supportsAnswers !== false)
    : [];

  if (provider === 'openrouter') {
    const freeModels = candidates.filter(model => /:free$/i.test(String(model.id)) ||
      (Number(model.pricePrompt) === 0 && Number(model.priceCompletion) === 0));
    const measured = freeModels.filter(model => Number(model.speed) > 0)
      .sort((a, b) => Number(b.speed) - Number(a.speed));
    return measured[0]?.id || freeModels[0]?.id || DEFAULT_OPENROUTER_FAST_MODEL || primaryModel;
  }

  if (provider === 'gemini') {
    const measured = candidates.map(model => ({
      id: model.id,
      speed: Number(geminiSpeeds?.[model.id]?.tokensPerSecond)
    })).filter(model => Number.isFinite(model.speed) && model.speed > 0)
      .sort((a, b) => b.speed - a.speed);
    return measured[0]?.id || DEFAULT_GEMINI_FAST_MODEL || primaryModel;
  }

  return primaryModel;
}

export async function resolveFastBinaryModel(provider, settings = {}, primaryModel = '', storage = globalThis.chrome?.storage?.local) {
  const settingKey = FAST_MODEL_SETTING_KEYS[provider];
  const override = settingKey ? String(settings[settingKey] || '').trim() : '';
  if (override) return override;

  const catalogKey = FAST_MODEL_CATALOG_KEYS[provider];
  if (!catalogKey || !storage?.get) return chooseFastBinaryModel(provider, [], {}, primaryModel);

  try {
    const keys = provider === 'gemini' ? [catalogKey, GEMINI_SPEED_STORAGE_KEY] : [catalogKey];
    const stored = await storage.get(keys);
    const models = stored[catalogKey]?.models || [];
    const speeds = stored[GEMINI_SPEED_STORAGE_KEY] || {};
    return chooseFastBinaryModel(provider, models, speeds, primaryModel);
  } catch {
    return chooseFastBinaryModel(provider, [], {}, primaryModel);
  }
}
