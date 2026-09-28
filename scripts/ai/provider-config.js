import {
  DEFAULT_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_VISION_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_VISION_MODEL
} from '../core/constants.js';
import { getApiKeys } from '../core/storage.js';

const PREVIOUS_OPENROUTER_DEFAULT = 'google/gemini-3.8-flash';
export const PROVIDER_FALLBACK_ORDER = ['openrouter', 'gemini', 'openai'];
export const PROVIDER_SETTINGS = {
  openai: { modelKey: 'openaiModel', visionKey: 'openaiVisionModel', backupKey: 'openaiBackupModels', fastModelKey: 'openaiFastModel', model: DEFAULT_MODEL, visionModel: DEFAULT_VISION_MODEL },
  gemini: { modelKey: 'geminiModel', visionKey: 'geminiVisionModel', backupKey: 'geminiBackupModels', fastModelKey: 'geminiFastModel', model: DEFAULT_GEMINI_MODEL, visionModel: DEFAULT_GEMINI_VISION_MODEL },
  openrouter: { modelKey: 'openrouterModel', visionKey: 'openrouterVisionModel', backupKey: 'openrouterBackupModels', fastModelKey: 'openrouterFastModel', model: DEFAULT_OPENROUTER_MODEL, visionModel: DEFAULT_OPENROUTER_VISION_MODEL }
};

const STYLE = 'color:#f0abfc;font-weight:bold';
const log = (...args) => console.log('%c[AI]', STYLE, ...args);

export function providerLabel(provider) {
  return ({ openai: 'OpenAI', gemini: 'Google AI Studio', openrouter: 'OpenRouter' })[provider] || 'AI provider';
}

export function getOpenRouterDefaultMigration(settings = {}) {
  const migratedModels = {};
  if (settings.openrouterModel === PREVIOUS_OPENROUTER_DEFAULT) {
    migratedModels.openrouterModel = DEFAULT_OPENROUTER_MODEL;
  }
  if (settings.openrouterVisionModel === PREVIOUS_OPENROUTER_DEFAULT) {
    migratedModels.openrouterVisionModel = DEFAULT_OPENROUTER_VISION_MODEL;
  }
  return migratedModels;
}

export async function getAISettings() {
  const sync = await chrome.storage.sync.get([
    'aiProvider', 'aiFallbackEnabled', 'openaiModel', 'openaiVisionModel',
    'openaiBackupModels', 'openaiFastModel', 'geminiModel', 'geminiVisionModel', 'geminiBackupModels', 'geminiFastModel',
    'openrouterModel', 'openrouterVisionModel', 'openrouterBackupModels', 'openrouterFastModel', 'modelReasoningEffort',
    'fastBinaryAnswersEnabled'
  ]);
  const migratedModels = getOpenRouterDefaultMigration(sync);
  if (Object.keys(migratedModels).length) await chrome.storage.sync.set(migratedModels);
  const settings = { ...sync, ...migratedModels };
  const requestedProvider = PROVIDER_SETTINGS[settings.aiProvider] ? settings.aiProvider : 'openai';
  let provider = requestedProvider;
  let providerSettings = PROVIDER_SETTINGS[provider];
  const providerKeys = Object.fromEntries(await Promise.all(Object.keys(PROVIDER_SETTINGS).map(async name =>
    [name, await getApiKeys(name)]
  )));
  let apiKey = providerKeys[provider]?.[0] || '';

  if (!apiKey && settings.aiFallbackEnabled !== false) {
    for (const fallbackProvider of PROVIDER_FALLBACK_ORDER) {
      if (fallbackProvider === requestedProvider) continue;
      const fallbackKey = providerKeys[fallbackProvider]?.[0] || '';
      if (!fallbackKey) continue;
      provider = fallbackProvider;
      providerSettings = PROVIDER_SETTINGS[provider];
      apiKey = fallbackKey;
      log(`${providerLabel(requestedProvider)} has no key; using configured ${providerLabel(provider)} fallback`);
      break;
    }
  }

  return {
    apiKey,
    provider,
    model: (settings[providerSettings.modelKey] || providerSettings.model).trim() || providerSettings.model,
    visionModel: (settings[providerSettings.visionKey] || providerSettings.visionModel).trim() || providerSettings.visionModel,
    settingsSnapshot: settings,
    providerKeys
  };
}
