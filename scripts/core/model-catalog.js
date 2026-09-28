import { GEMINI_MODELS_URL, OPENROUTER_URL, OPENAI_MODELS_URL, fetchJson } from './model-catalog-transport.js';
import { isFreePrice } from './model-catalog-utils.js';

export { OPENROUTER_METRICS_CONCURRENCY, enrichOpenRouterThroughput } from './model-throughput.js';
export { measureGeminiModel, measureOpenAIModel } from './model-speed.js';

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

export async function fetchOpenRouterQuota(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('OpenRouter API key is not set.');
  return fetchJson(`${OPENROUTER_URL}/key`, { Authorization: `Bearer ${key}` }, key, 'OpenRouter key quota');
}
