import { geminiThinkingConfig } from './model-routing.js';
import { recordProviderUsage } from './provider-usage.js';

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const REQUEST_TIMEOUT_MS = 12000;
const SPEED_REQUEST_TIMEOUT_MS = 30000;
const SPEED_SAMPLE_COUNT = 3;
const SPEED_MIN_OUTPUT_TOKENS = 24;
const SPEED_OUTPUT_TARGET = 64;
const SPEED_MAX_OUTPUT_TOKENS = 96;
const SPEED_MEASUREMENT_METHOD = 'stream-median-v2';
const METRICS_REQUEST_TIMEOUT_MS = 3500;
const METRICS_CACHE_TTL_MS = 60 * 60 * 1000;
export const OPENROUTER_METRICS_CONCURRENCY = 6;
const METRICS_STORAGE_KEY = 'uwuKahootOpenRouterMetricsV1';

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundOne(value) {
  return Math.round(Number(value) * 10) / 10;
}

function summarizeSpeedSamples(samples) {
  const rates = samples.map(sample => sample.tokensPerSecond);
  return {
    tokensPerSecond: roundOne(median(rates)),
    minTokensPerSecond: roundOne(Math.min(...rates)),
    maxTokensPerSecond: roundOne(Math.max(...rates)),
    firstTokenMs: Math.round(median(samples.map(sample => sample.firstTokenMs))),
    streamDurationMs: Math.round(median(samples.map(sample => sample.streamDurationMs))),
    elapsedMs: Math.round(median(samples.map(sample => sample.elapsedMs))),
    outputTokens: Math.round(median(samples.map(sample => sample.outputTokens))),
    providerOutputTokens: Math.round(median(samples.map(sample => sample.providerOutputTokens || sample.outputTokens))),
    inputTokens: samples.reduce((total, sample) => total + sample.inputTokens, 0),
    totalOutputTokens: samples.reduce((total, sample) => total + (sample.providerOutputTokens || sample.outputTokens), 0),
    sampleCount: samples.length,
    samples,
    tokensPerSecondIsEstimate: false,
    outputTokenCountSource: 'provider-metadata',
    measurementMethod: SPEED_MEASUREMENT_METHOD
  };
}

function createSpeedSample({ startedAt, firstOutputAt, lastOutputAt, outputChunks, inputTokens, outputTokens, providerOutputTokens = outputTokens, label }) {
  const durationMs = Number(lastOutputAt) - Number(firstOutputAt);
  if (!Number.isFinite(Number(outputTokens)) || Number(outputTokens) < SPEED_MIN_OUTPUT_TOKENS) {
    throw new Error(`${label} returned too few counted output tokens for a reliable TPS reading.`);
  }
  if (!Number.isFinite(durationMs) || durationMs < 1 || outputChunks < 2) {
    throw new Error(`${label} buffered the response into too few stream chunks to measure TPS accurately. No speed was saved.`);
  }
  return {
    tokensPerSecond: Number(outputTokens) / (durationMs / 1000),
    firstTokenMs: Math.max(0, firstOutputAt - startedAt),
    streamDurationMs: durationMs,
    elapsedMs: Math.max(1, performance.now() - startedAt),
    inputTokens: Math.max(0, Number(inputTokens) || 0),
    outputTokens: Number(outputTokens),
    providerOutputTokens: Number(providerOutputTokens) || Number(outputTokens),
    outputChunks
  };
}

async function readSseJsonEvents(response, onEvent) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('Provider did not return a readable event stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;
  let doneMarker = false;

  const dispatch = rawEvent => {
    const data = rawEvent.split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') {
      doneMarker = true;
      return;
    }
    let payload;
    try { payload = JSON.parse(data); }
    catch { throw new Error('Provider returned an invalid streaming event.'); }
    eventCount += 1;
    onEvent(payload, performance.now());
  };

  try {
    let streamDone = false;
    while (!streamDone) {
      const part = await reader.read();
      streamDone = part.done;
      if (part.value) buffer += decoder.decode(part.value, { stream: true });
      if (streamDone) buffer += decoder.decode();
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) dispatch(buffer);
    return { eventCount, doneMarker };
  } catch (error) {
    try { await reader.cancel(); } catch (_) {  }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch (_) {  }
  }
}

async function postSseJson(url, headers, body, apiKey, label, onEvent) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SPEED_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_) {  }
      const message = payload?.error?.message || `HTTP ${response.status}`;
      const error = new Error(`${label}: ${safeMessage(message, apiKey)}`);
      error.status = response.status;
      throw error;
    }
    const stream = await readSseJsonEvents(response, onEvent);
    return { status: response.status, stream };
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`${label} speed check timed out.`);
      timeoutError.status = 599;
      throw timeoutError;
    }
    if (error?.status) throw error;
    const failure = new Error(`${label} speed check failed. Check the connection and try again.`);
    failure.status = 599;
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
}

function safeMessage(message, apiKey) {
  const text = typeof message === 'string' ? message : 'Request failed';
  return apiKey ? text.split(apiKey).join('[hidden]') : text;
}

async function fetchJson(url, headers, apiKey, label, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${label} request timed out.`);
    throw new Error(`${label} request failed. Check the connection and try again.`);
  } finally {
    clearTimeout(timeout);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`${label} returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
    const error = new Error(`${label}: ${safeMessage(message, apiKey)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function normalizeGeminiModel(model) {
  const id = String(model?.baseModelId || model?.name || '').replace(/^models\//, '').trim();
  const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
  if (!id) return null;
  const modelId = id.replace(/^models\//, '');
  const supportsAnswers = methods.includes('generateContent') && !/(?:tts|embedding|live|audio)/i.test(modelId);
  const canUseForVision = supportsAnswers && /^(?:gemini|gemma)/i.test(modelId);
  return {
    id: modelId,
    name: String(model.displayName || modelId),
    description: String(model.description || ''),
    provider: 'gemini',
    supportsAnswers,
    inputLimit: Number(model.inputTokenLimit) || null,
    outputLimit: Number(model.outputTokenLimit) || null,
    supportsReasoning: model.thinking === true || /(?:gemini-(?:2\.5|3\.)|thinking)/i.test(modelId),
    supportsVision: canUseForVision,
    methods,
    temperature: Number.isFinite(Number(model.temperature)) ? Number(model.temperature) : null,
    topK: Number.isFinite(Number(model.topK)) ? Number(model.topK) : null,
    speed: null,
    latency: null,
    speedSource: ''
  };
}

async function fetchGeminiModels(apiKey) {
  const models = [];
  let pageToken = '';
  do {
    const url = new URL(GEMINI_MODELS_URL);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await fetchJson(url.href, { 'x-goog-api-key': apiKey }, apiKey, 'Google AI Studio model catalog');
    models.push(...(Array.isArray(page.models) ? page.models : []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return models.map(normalizeGeminiModel).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isFreePrice(value) {
  if (value === null || value === undefined || value === '') return false;
  const price = Number(value);
  return Number.isFinite(price) && price === 0;
}

export function normalizeOpenRouterModel(model) {
  const pricing = model?.pricing || {};
  if (!isFreePrice(pricing.prompt) || !isFreePrice(pricing.completion)) return null;
  const modalities = Array.isArray(model?.architecture?.input_modalities)
    ? model.architecture.input_modalities.map(value => String(value).toLowerCase()) : [];
  const supportsTextInput = modalities.includes('text');
  const supportsImageInput = modalities.includes('image');
  const supportedParameters = Array.isArray(model?.supported_parameters) ? model.supported_parameters : [];
  return {
    id: String(model.id || '').trim(),
    name: String(model.name || model.id || 'Unnamed model'),
    description: String(model.description || ''),
    provider: 'openrouter',
    supportsAnswers: supportsTextInput,
    inputLimit: Number(model.context_length) || null,
    outputLimit: Number(model.top_provider?.max_completion_tokens) || null,
    supportsReasoning: supportedParameters.includes('reasoning') || supportedParameters.includes('reasoning_effort'),
    supportsVision: supportsImageInput,
    modalities,
    supportedParameters,
    pricePrompt: 0,
    priceCompletion: 0,
    speed: null,
    latency: null,
    speedSource: '',
    speedProvider: '',
    uptime: null
  };
}

async function fetchOpenRouterModels(apiKey) {
  const url = new URL(`${OPENROUTER_URL}/models`);
  url.searchParams.set('sort', 'throughput-high-to-low');
  url.searchParams.set('output_modalities', 'text');
  url.searchParams.set('max_price', '0');
  const data = await fetchJson(url.href, { Authorization: `Bearer ${apiKey}` }, apiKey, 'OpenRouter model catalog');
  return (Array.isArray(data?.data) ? data.data : []).map(normalizeOpenRouterModel)
    .filter(model => model?.id);
}

async function fetchOpenAIModels(apiKey) {
  const data = await fetchJson(OPENAI_MODELS_URL, { Authorization: `Bearer ${apiKey}` }, apiKey, 'OpenAI model catalog');
  return (Array.isArray(data?.data) ? data.data : [])
    .filter(model => model?.id && !/(?:embedding|tts|whisper|moderation|realtime|transcri|image|audio)/i.test(model.id))
    .map(model => ({
      id: String(model.id), name: String(model.id), description: 'Chat-capable API model', provider: 'openai',
      inputLimit: null, outputLimit: null, supportsAnswers: true,
      supportsReasoning: /^(?:o[134](?:-|$)|gpt-[56](?:[.-]|$))/i.test(model.id), supportsVision: /(?:gpt-4\.1|gpt-4o|gpt-[56])/i.test(model.id),
      methods: ['chat.completions'], speed: null, latency: null, speedSource: ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchProviderModels(provider, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Enter or save this provider’s API key first.');
  if (provider === 'gemini') return fetchGeminiModels(key);
  if (provider === 'openrouter') return fetchOpenRouterModels(key);
  if (provider === 'openai') return fetchOpenAIModels(key);
  throw new Error('Model discovery is not available for this provider.');
}

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

export async function fetchOpenRouterQuota(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('OpenRouter API key is not set.');
  return fetchJson(`${OPENROUTER_URL}/key`, { Authorization: `Bearer ${key}` }, key, 'OpenRouter key quota');
}

export async function measureOpenAIModel(apiKey, modelId, onProgress = () => {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Enter or save an OpenAI key before measuring speed.');
  const model = String(modelId || '').trim();
  if (!/^[a-z0-9][a-z0-9._/-]{1,140}$/i.test(model)) throw new Error('Choose a valid model from the catalog.');
  const samples = [];

  for (let run = 0; run < SPEED_SAMPLE_COUNT; run += 1) {
    onProgress(run, SPEED_SAMPLE_COUNT);
    const startedAt = performance.now();
    let firstOutputAt = null;
    let lastOutputAt = null;
    let outputChunks = 0;
    let visibleOutputTokens = 0;
    let missingTokenLogprobs = false;
    let usage = null;
    let usageRecorded = false;
    try {
      const result = await postSseJson('https://api.openai.com/v1/chat/completions', {
        Authorization: `Bearer ${key}`
      }, {
        model,
        messages: [{ role: 'user', content: `For a speed check, output exactly ${SPEED_OUTPUT_TARGET} repetitions of the word amber separated by single spaces. Output nothing else.` }],
        max_completion_tokens: SPEED_MAX_OUTPUT_TOKENS,
        logprobs: true,
        stream: true,
        stream_options: { include_usage: true, include_obfuscation: false }
      }, key, 'OpenAI', (payload, receivedAt) => {
        if (payload?.usage && typeof payload.usage === 'object') usage = payload.usage;
        const content = payload?.choices?.[0]?.delta?.content;
        const logprobs = payload?.choices?.[0]?.logprobs?.content;
        const text = typeof content === 'string'
          ? content
          : Array.isArray(content) ? content.map(part => part?.text || '').join('') : '';
        if (text && (!Array.isArray(logprobs) || !logprobs.length)) missingTokenLogprobs = true;
        if (Array.isArray(logprobs)) visibleOutputTokens += logprobs.length;
        if (text || (Array.isArray(logprobs) && logprobs.length)) {
          if (firstOutputAt === null) firstOutputAt = receivedAt;
          lastOutputAt = receivedAt;
          outputChunks += 1;
        }
      });
      if (!result.stream.doneMarker) throw new Error('OpenAI closed the speed stream before its completion marker.');
      const providerOutputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
      const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens) || 0;
      if (usage) {
        await recordProviderUsage('openai', model, result.status, { inputTokens, outputTokens: providerOutputTokens });
        usageRecorded = true;
      }
      if (!Number.isFinite(providerOutputTokens) || providerOutputTokens <= 0) {
        throw new Error('OpenAI did not return final provider token usage, so an accurate TPS reading is unavailable.');
      }
      if (visibleOutputTokens <= 0) {
        throw new Error('This OpenAI model did not provide streamed token-level data, so accurate TPS is unavailable for it.');
      }
      if (missingTokenLogprobs) {
        throw new Error('OpenAI omitted token-level data for part of the streamed output, so accurate TPS is unavailable for this run.');
      }
      samples.push(createSpeedSample({
        startedAt,
        firstOutputAt,
        lastOutputAt,
        outputChunks,
        inputTokens,
        outputTokens: visibleOutputTokens,
        providerOutputTokens,
        label: 'OpenAI'
      }));
      onProgress(run + 1, SPEED_SAMPLE_COUNT);
    } catch (error) {
      if (!usageRecorded) await recordProviderUsage('openai', model, error?.status || 599);
      throw error;
    }
  }

  return {
    ...summarizeSpeedSamples(samples),
    outputTokenCountSource: 'openai-stream-logprobs',
    speedLabel: 'Median client-observed stream TPS'
  };
}

export async function measureGeminiModel(apiKey, modelId, onProgress = () => {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Enter or save a Google AI Studio key first.');
  const model = String(modelId || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,120}$/i.test(model)) throw new Error('Choose a valid model from the catalog.');
  const url = `${GEMINI_MODELS_URL}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const thinkingConfig = geminiThinkingConfig(model, 'none');
  const thinkingBudget = Number(thinkingConfig?.thinkingBudget);
  const maxOutputTokens = Math.max(SPEED_MAX_OUTPUT_TOKENS, Number.isFinite(thinkingBudget) && thinkingBudget > 0
    ? thinkingBudget + SPEED_MAX_OUTPUT_TOKENS : SPEED_MAX_OUTPUT_TOKENS);
  const generationConfig = { maxOutputTokens, temperature: 0 };
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  const samples = [];

  for (let run = 0; run < SPEED_SAMPLE_COUNT; run += 1) {
    onProgress(run, SPEED_SAMPLE_COUNT);
    const startedAt = performance.now();
    let firstOutputAt = null;
    let lastOutputAt = null;
    let outputChunks = 0;
    let usage = null;
    let usageRecorded = false;
    try {
      const result = await postSseJson(url, { 'x-goog-api-key': key }, {
        contents: [{ role: 'user', parts: [{ text: `For a speed check, output exactly ${SPEED_OUTPUT_TARGET} repetitions of the word amber separated by single spaces. Output nothing else.` }] }],
        generationConfig
      }, key, 'Google AI Studio', (payload, receivedAt) => {
        if (payload?.usageMetadata && typeof payload.usageMetadata === 'object') usage = payload.usageMetadata;
        const parts = payload?.candidates?.[0]?.content?.parts || [];
        const visibleText = parts.filter(part => part?.thought !== true).map(part => part?.text || '').join('');
        if (visibleText) {
          if (firstOutputAt === null) firstOutputAt = receivedAt;
          lastOutputAt = receivedAt;
          outputChunks += 1;
        }
      });
      const outputTokens = Number(usage?.candidatesTokenCount);
      const inputTokens = Number(usage?.promptTokenCount) || 0;
      if (usage) {
        await recordProviderUsage('gemini', model, result.status, { inputTokens, outputTokens });
        usageRecorded = true;
      }
      if (!Number.isFinite(outputTokens) || outputTokens <= 0) {
        throw new Error('Google AI Studio did not return provider token usage, so an accurate TPS reading is unavailable.');
      }
      samples.push(createSpeedSample({
        startedAt, firstOutputAt, lastOutputAt, outputChunks, inputTokens, outputTokens, label: 'Google AI Studio'
      }));
      onProgress(run + 1, SPEED_SAMPLE_COUNT);
    } catch (error) {
      if (!usageRecorded) await recordProviderUsage('gemini', model, error?.status || 599);
      throw error;
    }
  }

  return {
    ...summarizeSpeedSamples(samples),
    maxOutputTokens,
    reasoningLevel: thinkingConfig?.thinkingLevel || '',
    speedLabel: 'Median client-observed stream TPS'
  };
}
