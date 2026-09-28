import { OPENROUTER_URL, fetchJson } from './model-catalog-transport.js';
import { isFreePrice } from './model-catalog-utils.js';

const METRICS_REQUEST_TIMEOUT_MS = 3500;
const METRICS_CACHE_TTL_MS = 60 * 60 * 1000;
const METRICS_STORAGE_KEY = 'uwuKahootOpenRouterMetricsV1';
export const OPENROUTER_METRICS_CONCURRENCY = 6;

function safeOpenRouterModelPath(modelId) {
  return String(modelId).split('/').map(part => encodeURIComponent(part).replace(/%3A/gi, ':')).join('/');
}

function freeEndpointMetrics(payload) {
  const endpoints = Array.isArray(payload?.data?.endpoints) ? payload.data.endpoints : [];
  const free = endpoints.filter(endpoint => isFreePrice(endpoint?.pricing?.prompt) && isFreePrice(endpoint?.pricing?.completion));
  const measured = free.map(endpoint => ({
    providerName: String(endpoint.provider_name || endpoint.name || ''),
    speed: Number(endpoint.throughput_last_30m?.p50),
    latency: Number(endpoint.latency_last_30m?.p50),
    uptime: Number(endpoint.uptime_last_30m)
  })).filter(endpoint => Number.isFinite(endpoint.speed) && endpoint.speed > 0);
  measured.sort((a, b) => b.speed - a.speed);
  return measured[0] || null;
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function enrichOpenRouterThroughput(models, apiKey, onProgress = () => {}, options = {}) {
  const enrichOptions = options && typeof options === 'object' ? options : {};
  let cache = {};
  try {
    cache = (await chrome.storage.local.get(METRICS_STORAGE_KEY))[METRICS_STORAGE_KEY] || {};
  } catch (_) {  }

  const requestedLimit = enrichOptions.limit === undefined ? models.length : Number(enrichOptions.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : models.length;
  const forceRefresh = enrichOptions.force === true;
  const selectedIds = Array.isArray(enrichOptions.modelIds)
    ? new Set(enrichOptions.modelIds.map(id => String(id || '').trim()).filter(Boolean))
    : null;
  const enrichmentCandidates = selectedIds
    ? models.filter(model => selectedIds.has(model.id)).slice(0, limit)
    : models.slice(0, limit);
  const now = Date.now();
  const staleModels = enrichmentCandidates.filter(model => {
    const cacheEntry = cache[model.id];
    const checkedAt = Number(cacheEntry?.checkedAt || cacheEntry?.updatedAt);
    return forceRefresh || !Number.isFinite(checkedAt) || now - checkedAt > METRICS_CACHE_TTL_MS;
  });
  let completed = enrichmentCandidates.length - staleModels.length;
  onProgress(completed, enrichmentCandidates.length);

  const nextMetrics = await mapConcurrent(staleModels, OPENROUTER_METRICS_CONCURRENCY, async model => {
    let metrics = null;
    let lookupCompleted = false;
    try {
      const path = safeOpenRouterModelPath(model.id);
      const payload = await fetchJson(`${OPENROUTER_URL}/models/${path}/endpoints`, {
        Authorization: `Bearer ${apiKey}`
      }, apiKey, 'OpenRouter throughput lookup', METRICS_REQUEST_TIMEOUT_MS);
      lookupCompleted = true;
      metrics = freeEndpointMetrics(payload);
    } catch (_) {  }
    if (metrics) {
      const measuredAt = Date.now();
      cache[model.id] = { ...metrics, updatedAt: measuredAt, checkedAt: measuredAt };
    } else if (lookupCompleted) {
      cache[model.id] = { ...(cache[model.id] || {}), checkedAt: Date.now() };
    }
    completed += 1;
    onProgress(completed, enrichmentCandidates.length);
    return [model.id, cache[model.id]];
  });

  for (const [id, metrics] of nextMetrics) cache[id] = metrics;
  const cacheEntries = Object.entries(cache).sort((a, b) => Number(b[1]?.updatedAt) - Number(a[1]?.updatedAt)).slice(0, 500);
  try { await chrome.storage.local.set({ [METRICS_STORAGE_KEY]: Object.fromEntries(cacheEntries) }); }
  catch (_) {  }

  const originalOrder = new Map(models.map((model, index) => [model.id, index]));
  return models.map(model => {
    const metrics = cache[model.id] || {};
    return {
      ...model,
      speed: Number.isFinite(Number(metrics.speed)) ? Number(metrics.speed) : null,
      latency: Number.isFinite(Number(metrics.latency)) ? Number(metrics.latency) : null,
      speedProvider: metrics.providerName || '',
      uptime: Number.isFinite(Number(metrics.uptime)) ? Number(metrics.uptime) : null,
      speedUpdatedAt: metrics.updatedAt ? new Date(metrics.updatedAt).toISOString() : '',
      speedSource: Number.isFinite(Number(metrics.speed)) ? 'OpenRouter 30-minute p50' : ''
    };
  }).sort((a, b) => {
    const speedA = Number.isFinite(Number(a.speed)) ? Number(a.speed) : 0;
    const speedB = Number.isFinite(Number(b.speed)) ? Number(b.speed) : 0;
    if (speedA !== speedB) return speedB - speedA;
    return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
  });
}
