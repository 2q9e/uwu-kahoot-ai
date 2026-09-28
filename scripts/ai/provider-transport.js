import { recordProviderUsage } from '../core/provider-usage.js';
import { makeAbortError } from './provider-fallback.js';

export const API_TIMEOUT_MS = 15000;
export const VISION_TIMEOUT_MS = 25000;
const MAX_RETRIES = 1;
const STYLE = 'color:#f0abfc;font-weight:bold';
const log = (...args) => console.log('%c[AI]', STYLE, ...args);

function responseUsage(provider, data) {
  if (provider === 'gemini') {
    return {
      inputTokens: data?.usageMetadata?.promptTokenCount,
      outputTokens: (Number(data?.usageMetadata?.candidatesTokenCount) || 0) + (Number(data?.usageMetadata?.thoughtsTokenCount) || 0)
    };
  }
  return {
    inputTokens: data?.usage?.prompt_tokens ?? data?.usage?.input_tokens,
    outputTokens: data?.usage?.completion_tokens ?? data?.usage?.output_tokens
  };
}

async function retryDelay(ms, signal) {
  if (signal?.aborted) throw makeAbortError();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    function done() { cleanup(); resolve(); }
    function onAbort() { cleanup(); reject(makeAbortError()); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function postJsonWithRetry(url, headers, body, timeoutMs, service, provider = '', model = '', { signal, requestBudget } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw makeAbortError();
    const remainingBudget = requestBudget ? requestBudget.deadline - Date.now() : timeoutMs;
    if (remainingBudget <= 0) {
      const error = new Error('AI request time budget expired.');
      error.name = 'TimeoutError';
      throw error;
    }
    if (attempt > 0) log(`${service} retry attempt`, attempt);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, remainingBudget)));
    let response;
    let data;
    let payload;
    let requestError;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (response.ok) {
        data = await response.json();
      } else {
        try {
          payload = await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
      }
    } catch (error) {
      requestError = error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
    if (requestError) {
      if (signal?.aborted) throw makeAbortError();
      lastError = controller.signal.aborted || requestError.name === 'AbortError'
        ? new Error(`${service} request timed out`)
        : requestError;
      void recordProviderUsage(provider, model, 599);
      if (attempt < MAX_RETRIES && Date.now() < (requestBudget?.deadline ?? Infinity)) {
        await retryDelay(Math.min(1000 * 2 ** attempt, 4000) * (0.5 + Math.random() * 0.5), signal);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      void recordProviderUsage(provider, model, 200, responseUsage(provider, data));
      return data;
    }
    void recordProviderUsage(provider, model, response.status);
    if ((response.status === 408 || response.status >= 500) && attempt < MAX_RETRIES && Date.now() < (requestBudget?.deadline ?? Infinity)) {
      await retryDelay(Math.min(1000 * 2 ** attempt, 4000) * (0.5 + Math.random() * 0.5), signal);
      continue;
    }

    let message = `HTTP ${response.status}`;
    message = payload?.error?.message || payload?.error || message;
    if (typeof message !== 'string') message = `HTTP ${response.status}`;
    const error = new Error(`${service}: ${message}`);
    error.status = response.status;
    throw error;
  }
  throw lastError ?? new Error(`${service} call failed after all retries`);
}
