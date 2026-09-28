import { getApiKeys } from '../core/storage.js';
import {
  getModelPriority,
  normalizeBackupModels
} from '../core/model-routing.js';
import { PROVIDER_FALLBACK_ORDER, PROVIDER_SETTINGS, providerLabel } from './provider-config.js';

export const AI_REQUEST_BUDGET_MS = 45000;
const MAX_PROVIDER_ATTEMPTS = 9;
const STYLE = 'color:#f0abfc;font-weight:bold';
const log = (...args) => console.log('%c[AI]', STYLE, ...args);
const warn = (...args) => console.warn('%c[AI]', STYLE, ...args);

async function getProviderAttempts(primaryProvider, primaryApiKey, primaryModel, modelField, settingsSnapshot, providerKeys = {}) {
  const sync = settingsSnapshot || await chrome.storage.sync.get([
    'aiFallbackEnabled', ...Object.values(PROVIDER_SETTINGS).flatMap(settings => [settings.modelKey, settings.visionKey, settings.backupKey])
  ]);
  const attempts = [];
  const primaryKeys = providerKeys[primaryProvider] || await getApiKeys(primaryProvider);
  const orderedPrimaryKeys = [primaryApiKey, ...primaryKeys].filter((key, index, keys) => key && keys.indexOf(key) === index);
  const appendProviderAttempts = (provider, keys, chosenModel) => {
    const settings = PROVIDER_SETTINGS[provider];
    const backups = normalizeBackupModels(sync[settings.backupKey], chosenModel);
    const priority = getModelPriority(chosenModel, backups);
    for (const apiKey of keys) {
      for (const model of priority) attempts.push({ provider, apiKey, model });
    }
  };
  appendProviderAttempts(primaryProvider, orderedPrimaryKeys, primaryModel);
  if (sync.aiFallbackEnabled === false) return attempts;

  const candidates = PROVIDER_FALLBACK_ORDER.filter(provider => provider !== primaryProvider);
  const candidateKeys = await Promise.all(candidates.map(provider => providerKeys[provider] || getApiKeys(provider)));
  candidates.forEach((provider, index) => {
    const settings = PROVIDER_SETTINGS[provider];
    const key = settings[modelField];
    const fallbackModel = (sync[key] || settings[modelField === 'modelKey' ? 'model' : 'visionModel']).trim();
    appendProviderAttempts(provider, candidateKeys[index], fallbackModel);
  });
  return attempts;
}

function canFailOver(error) {
  const status = error?.status;
  return status == null || status === 400 || status === 401 || status === 402 || status === 403 || status === 404 || status === 408 ||
    status === 409 || status === 425 || status === 429 || status >= 500;
}

function canRotateProviderKey(error) {
  const status = error?.status;
  return status === 401 || status === 402 || status === 403 || status === 429 ||
    (status === 400 && /api.?key|invalid key|key.*(?:invalid|expired|revoked|quota)/i.test(error.message || ''));
}

function findNextProviderAttempt(attempts, currentIndex, error, attempted) {
  const current = attempts[currentIndex];
  const find = predicate => attempts.findIndex((candidate, index) => index > currentIndex && !attempted.has(index) && predicate(candidate));
  const keyRejected = [401, 402, 403].includes(error?.status) ||
    (error?.status === 400 && /api.?key|invalid key|key.*(?:invalid|expired|revoked|quota)/i.test(error.message || ''));
  const retryByModel = !keyRejected && (error?.status == null || [400, 404, 408, 409, 425, 429].includes(error.status) || error.status >= 500);
  if (retryByModel) {
    const nextModel = find(candidate => candidate.provider === current.provider && candidate.apiKey === current.apiKey && candidate.model !== current.model);
    if (nextModel >= 0) return nextModel;
  }
  if (canRotateProviderKey(error)) {
    const nextKey = find(candidate => candidate.provider === current.provider && candidate.apiKey !== current.apiKey);
    if (nextKey >= 0) return nextKey;
  }
  return find(candidate => candidate.provider !== current.provider);
}

export function makeAbortError() {
  const error = new Error('AI request was cancelled.');
  error.name = 'AbortError';
  return error;
}

function redactProviderError(error, apiKey) {
  const message = String(error?.message || 'Provider request failed');
  const safeMessage = apiKey ? message.split(apiKey).join('[hidden]') : message;
  const safe = new Error(safeMessage.slice(0, 300));
  if (Number.isFinite(error?.status)) safe.status = error.status;
  if (error?.name === 'AbortError') safe.name = 'AbortError';
  return safe;
}

export async function withProviderFallback(provider, apiKey, model, modelField, request, requestContext = {}) {
  const deadline = Math.min(Number(requestContext.deadline) || Infinity, Date.now() + AI_REQUEST_BUDGET_MS);
  const signal = requestContext.signal;
  const attemptCounter = requestContext.attemptCounter || { value: 0 };
  const reportProgress = progress => {
    try { requestContext.onProgress?.(progress); } catch (_) {}
  };
  if (signal?.aborted) throw makeAbortError();
  if (Date.now() >= deadline) throw new Error('AI request time budget expired.');
  const attempts = await getProviderAttempts(provider, apiKey, model, modelField, requestContext.settingsSnapshot, requestContext.providerKeys);
  if (signal?.aborted) throw makeAbortError();
  if (Date.now() >= deadline) throw new Error('AI request time budget expired.');
  const attempted = new Set();
  let index = 0;
  let lastError = null;
  while (index >= 0 && index < attempts.length && !attempted.has(index) && attemptCounter.value < MAX_PROVIDER_ATTEMPTS && Date.now() < deadline) {
    if (signal?.aborted) throw makeAbortError();
    attempted.add(index);
    attemptCounter.value += 1;
    const target = attempts[index];
    reportProgress({ event: 'attempt', provider: target.provider, model: target.model, attempt: attemptCounter.value });
    try {
      const result = await request(target, { deadline });
      if (index > 0) log(`Answered using fallback ${providerLabel(target.provider)} model ${target.model}`);
      reportProgress({ event: 'success', provider: target.provider, model: target.model, attempt: attemptCounter.value });
      return result;
    } catch (rawError) {
      const error = redactProviderError(rawError, target.apiKey);
      if (signal?.aborted || error.name === 'AbortError') throw makeAbortError();
      lastError = error;
      const nextIndex = attemptCounter.value < MAX_PROVIDER_ATTEMPTS && Date.now() < deadline && canFailOver(error)
        ? findNextProviderAttempt(attempts, index, error, attempted)
        : -1;
      const next = nextIndex >= 0 ? attempts[nextIndex] : null;
      reportProgress({
        event: 'failed', provider: target.provider, model: target.model,
        attempt: attemptCounter.value, httpStatus: Number.isFinite(error.status) ? error.status : null,
        nextProvider: next?.provider || null, nextModel: next?.model || null
      });
      if (!next) {
        if (attempts.length === 1 && attempted.size === 1) throw error;
        break;
      }
      warn(`${providerLabel(target.provider)} model ${target.model} failed (${error.status ? `HTTP ${error.status}` : error.message}); trying ${providerLabel(next.provider)} model ${next.model}`);
      index = nextIndex;
    }
  }
  if (signal?.aborted) throw makeAbortError();
  if (lastError) {
    const reason = lastError.status
      ? `HTTP ${lastError.status}${lastError.message ? ` · ${lastError.message}` : ''}`
      : lastError.message;
    const bounded = attemptCounter.value >= MAX_PROVIDER_ATTEMPTS || Date.now() >= deadline;
    const finalError = new Error(bounded
      ? `AI fallback budget ended after ${attemptCounter.value} attempts. Last error: ${reason}.`
      : `All configured AI attempts failed. Last error: ${reason}.`);
    if (Number.isFinite(lastError.status)) finalError.status = lastError.status;
    throw finalError;
  }
  throw new Error('AI request stopped because its time or fallback-attempt budget expired.');
}
