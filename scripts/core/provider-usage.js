export const PROVIDER_USAGE_STORAGE_KEY = 'uwuKahootProviderUsageV1';
let usageWriteQueue = Promise.resolve();

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function readProviderUsage() {
  try {
    return (await chrome.storage.local.get(PROVIDER_USAGE_STORAGE_KEY))[PROVIDER_USAGE_STORAGE_KEY] || {};
  } catch (_) {
    return {};
  }
}

export function recordProviderUsageInBackground(provider, model, status, usage = {}) {
  if (!['openai', 'gemini', 'openrouter'].includes(provider)) return Promise.resolve();
  const update = async () => {
    try {
      const stored = await readProviderUsage();
      const today = todayUtc();
      const current = stored[provider]?.date === today ? stored[provider] : {
        date: today, requests: 0, successes: 0, rateLimits: 0, failures: 0,
        inputTokens: 0, outputTokens: 0, lastAt: '', lastModel: '', lastStatus: null
      };
      const numericStatus = Number(status) || 0;
      const next = {
        ...current,
        requests: current.requests + 1,
        successes: current.successes + (numericStatus >= 200 && numericStatus < 300 ? 1 : 0),
        rateLimits: current.rateLimits + (numericStatus === 429 ? 1 : 0),
        failures: current.failures + (numericStatus >= 400 ? 1 : 0),
        inputTokens: current.inputTokens + Math.max(0, Number(usage.inputTokens) || 0),
        outputTokens: current.outputTokens + Math.max(0, Number(usage.outputTokens) || 0),
        lastAt: new Date().toISOString(),
        lastModel: String(model || '').slice(0, 160),
        lastStatus: numericStatus || null
      };
      await chrome.storage.local.set({ [PROVIDER_USAGE_STORAGE_KEY]: { ...stored, [provider]: next } });
    } catch (_) {
    }
  };

  const write = usageWriteQueue.then(update, update);
  usageWriteQueue = write.then(() => undefined, () => undefined);
  return write;
}

export function recordProviderUsage(provider, model, status, usage = {}) {
  if (typeof document === 'undefined') {
    return recordProviderUsageInBackground(provider, model, status, usage);
  }
  try {
    return Promise.resolve(chrome.runtime.sendMessage({ action: 'recordProviderUsage', provider, model, status, usage }))
      .catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}
