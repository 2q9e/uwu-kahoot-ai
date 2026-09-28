import { normalizeReasoningEffort } from '../core/model-routing.js';
import { PROVIDER_SETTINGS } from './provider-config.js';
import { AI_REQUEST_BUDGET_MS, makeAbortError, withProviderFallback } from './provider-fallback.js';
import { callModelOnce, callVisionOnce } from './provider-format.js';

export { AI_REQUEST_BUDGET_MS, makeAbortError };

async function getSettingsSnapshot(opts) {
  return opts.settingsSnapshot || chrome.storage.sync.get([
    'modelReasoningEffort', 'aiFallbackEnabled',
    ...Object.values(PROVIDER_SETTINGS).flatMap(settings => [settings.modelKey, settings.visionKey, settings.backupKey])
  ]);
}

export async function callModel(provider, apiKey, model, userPrompt, opts = {}) {
  const settingsSnapshot = await getSettingsSnapshot(opts);
  const reasoningEffort = opts.reasoningEffortOverride ? opts.reasoningEffort : settingsSnapshot.modelReasoningEffort;
  const requestOpts = { ...opts, reasoningEffort: normalizeReasoningEffort(reasoningEffort) };
  return withProviderFallback(provider, apiKey, model, 'modelKey', (target, requestBudget) =>
    callModelOnce(target.provider, target.apiKey, target.model, userPrompt, { ...requestOpts, requestBudget }),
  { settingsSnapshot, providerKeys: opts.providerKeys, signal: opts.signal, deadline: opts.deadline, attemptCounter: opts.attemptCounter });
}

export async function callVision(provider, apiKey, visionModel, systemPrompt, textPrompt, imageUrl, opts = {}) {
  const settingsSnapshot = await getSettingsSnapshot(opts);
  const reasoningEffort = opts.reasoningEffortOverride ? opts.reasoningEffort : settingsSnapshot.modelReasoningEffort;
  const requestOpts = { ...opts, reasoningEffort: normalizeReasoningEffort(reasoningEffort) };
  return withProviderFallback(provider, apiKey, visionModel, 'visionKey', (target, requestBudget) =>
    callVisionOnce(target.provider, target.apiKey, target.model, systemPrompt, textPrompt, imageUrl, { ...requestOpts, requestBudget }),
  { settingsSnapshot, providerKeys: opts.providerKeys, signal: opts.signal, deadline: opts.deadline, attemptCounter: opts.attemptCounter });
}
