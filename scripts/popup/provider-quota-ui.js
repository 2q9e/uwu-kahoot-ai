import { fetchOpenRouterQuota } from '../core/model-catalog.js';
import { PROVIDER_USAGE_STORAGE_KEY } from '../core/provider-usage.js';

export function createProviderQuotaUi({ providers, getProviderKey }) {
  const providerQuota = document.getElementById('providerQuota');
  const OPENROUTER_QUOTA_URL = 'https://openrouter.ai/account';
  const GEMINI_QUOTA_URL = 'https://aistudio.google.com/rate-limit?timeRange=last-28-days';

  function quotaLink(url, label) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    return link;
  }

  function renderGeminiQuota(usage = {}, available = true) {
    providerQuota.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = 'Google AI Studio quota';
    if (!available) {
      const unavailable = document.createElement('p');
      unavailable.className = 'quota-note';
      unavailable.textContent = 'Extension usage is unavailable because local storage could not be read.';
      providerQuota.append(title, unavailable);
      return;
    }
    const local = document.createElement('p');
    const date = new Date().toISOString().slice(0, 10);
    const today = usage.date === date ? usage : {};
    local.textContent = `This extension today (UTC): ${Number(today.requests || 0).toLocaleString()} requests · ${Number(today.inputTokens || 0).toLocaleString()} input tokens · ${Number(today.outputTokens || 0).toLocaleString()} output tokens · ${Number(today.rateLimits || 0).toLocaleString()} rate-limit responses.`;
    const note = document.createElement('p');
    note.className = 'quota-note';
    note.textContent = 'These counts cover this extension only. Google’s public model API does not return your project’s remaining RPM/TPM/RPD quota; limits are shared per project and vary by model.';
    const priceNote = document.createElement('p');
    priceNote.className = 'quota-note';
    priceNote.textContent = 'Model availability does not mean the model is free. Check current pricing before using a billed project.';
    providerQuota.append(title, local, note, priceNote,
      quotaLink(GEMINI_QUOTA_URL, 'View live rate limits in AI Studio ↗'),
      document.createTextNode(' · '),
      quotaLink('https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing ↗'));
  }

  async function renderProviderQuota(provider, suppliedKey = '') {
    if (!providerQuota) return;
    if (provider === 'gemini') {
      try {
        const stored = await chrome.storage.local.get(PROVIDER_USAGE_STORAGE_KEY);
        renderGeminiQuota(stored[PROVIDER_USAGE_STORAGE_KEY]?.gemini || {});
      } catch (_) { renderGeminiQuota({}, false); }
      return;
    }
    providerQuota.replaceChildren();
    if (provider !== 'openrouter') {
      const title = document.createElement('strong');
      title.textContent = `${providers[provider]?.keyLabel || 'Provider'} usage`;
      const note = document.createElement('p');
      note.className = 'quota-note';
      note.textContent = 'This provider does not expose account quota in the extension model catalog.';
      providerQuota.append(title, note);
      return;
    }
    const title = document.createElement('strong');
    title.textContent = 'OpenRouter quota';
    const detail = document.createElement('p');
    detail.textContent = 'Loading key usage…';
    providerQuota.append(title, detail);
    try {
      const key = suppliedKey || await getProviderKey('openrouter');
      if (!key) {
        detail.textContent = 'Save or enter an OpenRouter key, then refresh the catalog to view its account quota.';
        return;
      }
      const response = await fetchOpenRouterQuota(key);
      const data = response?.data || {};
      const remaining = data.limit_remaining == null ? NaN : Number(data.limit_remaining);
      const usage = data.usage == null ? NaN : Number(data.usage);
      const limit = data.limit == null ? NaN : Number(data.limit);
      const reset = data.limit_reset ? String(data.limit_reset) : 'provider reset schedule';
      const isFree = data.is_free_tier === true;
      detail.textContent = Number.isFinite(remaining)
        ? `${isFree ? 'Free account' : 'Current key'} · $${remaining.toFixed(2)} remaining${Number.isFinite(limit) ? ` of $${limit.toFixed(2)}` : ''}${Number.isFinite(usage) ? ` · $${usage.toFixed(2)} used` : ''} · reset: ${reset}.`
        : isFree
          ? 'Free account key. OpenRouter’s free model request limits vary by model and are not represented by a remaining-credit amount.'
          : 'OpenRouter returned no remaining-credit value for this key.';
      const note = document.createElement('p');
      note.className = 'quota-note';
      note.textContent = 'This is key-level account usage. Free model endpoints can still have separate provider rate limits.';
      providerQuota.append(note, quotaLink(OPENROUTER_QUOTA_URL, 'Open OpenRouter usage ↗'));
    } catch (error) {
      detail.textContent = error.message || 'Could not load OpenRouter quota.';
    }
  }

  function setLoading() {
    if (providerQuota) providerQuota.textContent = 'Loading provider usage…';
  }

  return { renderProviderQuota, setLoading };
}
