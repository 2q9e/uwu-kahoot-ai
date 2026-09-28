const PROVIDER_CHECKS = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: key => ({ Authorization: `Bearer ${key}` }),
    service: 'OpenAI'
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    headers: key => ({ 'x-goog-api-key': key }),
    service: 'Google AI Studio'
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/key',
    headers: key => ({ Authorization: `Bearer ${key}` }),
    service: 'OpenRouter'
  }
};

function genericMessage(status, ok) {
  if (ok) return 'Key accepted; provider API is reachable.';
  if (status === 401) return 'Key rejected (HTTP 401). Check the key value.';
  if (status === 403) return 'Access denied (HTTP 403). Check key permissions.';
  if (status === 429) return 'Provider rate limited this check (HTTP 429). Try again later.';
  if (status >= 500) return `Provider temporarily unavailable (HTTP ${status}).`;
  return `Provider check failed (HTTP ${status}).`;
}

export async function validateProviderApiKey(provider, key, options = {}) {
  const safeOptions = options && typeof options === 'object' ? options : {};
  const timeoutMs = safeOptions.timeoutMs ?? 10_000;
  const config = PROVIDER_CHECKS[provider];
  const secret = typeof key === 'string' ? key.trim() : '';
  if (!config || !secret) return { ok: false, status: 0, message: 'Enter a key for a supported provider.' };

  const fetchImpl = safeOptions.fetchImpl === undefined ? fetch : safeOptions.fetchImpl;
  const requestedTimeout = typeof timeoutMs === 'number' || typeof timeoutMs === 'string' ? Number(timeoutMs) : NaN;
  const boundedTimeout = Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(60_000, Math.floor(requestedTimeout)))
    : 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout);
  try {
    const response = await fetchImpl(config.url, {
      method: 'GET',
      headers: config.headers(secret),
      signal: controller.signal,
      cache: 'no-store'
    });
    if (controller.signal.aborted) {
      return { ok: false, status: 0, message: 'Provider check timed out. Try again later.' };
    }
    const rawStatus = Number(response?.status);
    const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 0;
    const ok = response?.ok === true && status >= 200 && status < 300;
    return { ok, status, message: genericMessage(status, ok) };
  } catch (_) {
    if (controller.signal.aborted) return { ok: false, status: 0, message: 'Provider check timed out. Try again later.' };
    return { ok: false, status: 0, message: 'Could not reach the provider. Check your connection and try again.' };
  } finally {
    clearTimeout(timer);
  }
}
