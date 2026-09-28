import {
  geminiThinkingConfig,
  normalizeReasoningEffort,
  openAIReasoningEffort,
  openRouterReasoningEffort
} from '../core/model-routing.js';
import { providerLabel } from './provider-config.js';
import { makeAbortError } from './provider-fallback.js';
import { API_TIMEOUT_MS, VISION_TIMEOUT_MS, postJsonWithRetry } from './provider-transport.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_CATALOG_CACHE_KEY = 'uwuKahootModelCatalogV1_openrouter';
const GEMINI_THINKING_TOKEN_PADDING = Object.freeze({
  none: 128,
  minimal: 128,
  low: 256,
  medium: 512,
  high: 1024,
  xhigh: 2048,
  max: 2048
});
const OPENAI_REASONING_TOKEN_PADDING = Object.freeze({
  none: 200,
  minimal: 200,
  low: 500,
  medium: 1200,
  high: 2500,
  xhigh: 4000,
  max: 12000
});

function isOpenAIReasoningModel(model) {
  return /^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/i.test(model.trim());
}

function createGeminiGenerationConfig(model, effort, maxTokens, stop) {
  const generationConfig = {
    maxOutputTokens: maxTokens + (GEMINI_THINKING_TOKEN_PADDING[effort] ?? 128)
  };
  const thinkingConfig = geminiThinkingConfig(model, effort);
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  if (stop?.length) generationConfig.stopSequences = stop;
  return generationConfig;
}

function addOpenAIReasoningConfig(body, model, maxTokens, effort) {
  const apiEffort = openAIReasoningEffort(effort, model);
  body.max_completion_tokens = maxTokens + (OPENAI_REASONING_TOKEN_PADDING[apiEffort] ?? 500);
  body.reasoning_effort = apiEffort;
}

async function addOpenRouterRouting(body, model, effort) {
  body.provider = { sort: 'throughput' };
  if (await openRouterModelSupportsReasoning(model)) {
    body.reasoning = { effort: openRouterReasoningEffort(effort) };
  }
}

function chatCompletionsUrl(provider) {
  return provider === 'openrouter' ? OPENROUTER_URL : OPENAI_URL;
}

function chatHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

async function openRouterModelSupportsReasoning(modelId) {
  try {
    const cached = (await chrome.storage.local.get(OPENROUTER_CATALOG_CACHE_KEY))[OPENROUTER_CATALOG_CACHE_KEY];
    const model = cached?.models?.find(item => item.id === modelId);
    if (!model) return true;
    return model.supportedParameters?.includes('reasoning') || model.supportedParameters?.includes('reasoning_effort') || false;
  } catch (_) {
    return true;
  }
}

function getGeminiResponseText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .filter(part => typeof part.text === 'string' && !part.thought)
    .map(part => part.text)
    .join('')
    .trim();
  if (text) return text;

  const reason = data?.promptFeedback?.blockReason || candidate?.finishReason || 'no text returned';
  throw new Error(`Google AI Studio: ${reason}`);
}

export async function callModelOnce(provider, apiKey, model, userPrompt, opts = {}) {
  const {
    systemPrompt = 'You answer multiple-choice questions.',
    maxTokens = 40,
    stop = undefined,
    reasoningEffort = 'minimal',
    signal,
    requestBudget
  } = opts;
  const effort = normalizeReasoningEffort(reasoningEffort);

  if (provider === 'gemini') {
    const generationConfig = createGeminiGenerationConfig(model, effort, maxTokens, stop);
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig
    };
    const url = `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`;
    const data = await postJsonWithRetry(url, {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    }, body, API_TIMEOUT_MS, 'Google AI Studio', provider, model, { signal, requestBudget });
    const text = getGeminiResponseText(data);
    return { choices: [{ message: { content: text } }] };
  }

  const usesOpenAIReasoning = provider === 'openai' && isOpenAIReasoningModel(model);
  const body = {
    model,
    messages: [
      { role: usesOpenAIReasoning ? 'developer' : 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
  if (provider === 'openrouter') await addOpenRouterRouting(body, model, effort);
  if (usesOpenAIReasoning) {
    addOpenAIReasoningConfig(body, model, maxTokens, effort);
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0;
    if (stop) body.stop = stop;
  }

  const data = await postJsonWithRetry(chatCompletionsUrl(provider), chatHeaders(apiKey), body, API_TIMEOUT_MS, providerLabel(provider), provider, model, { signal, requestBudget });
  return data;
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function imageUrlToGeminiPart(imageUrl, timeoutMs, parentSignal, requestBudget) {
  const dataUrl = String(imageUrl || '').match(/^data:(image\/(?:png|jpe?g|webp|gif|heic|heif));base64,([\s\S]+)$/i);
  if (dataUrl) {
    const mimeType = dataUrl[1].toLowerCase().replace('image/jpg', 'image/jpeg');
    return { inline_data: { mime_type: mimeType, data: dataUrl[2] } };
  }

  let url;
  try { url = new URL(imageUrl); }
  catch { throw new Error('Gemini image input must be an HTTPS image URL.'); }
  if (url.protocol !== 'https:') throw new Error('Gemini image input must be an HTTPS image URL.');

  if (parentSignal?.aborted) throw makeAbortError();
  const remainingBudget = requestBudget ? requestBudget.deadline - Date.now() : timeoutMs;
  if (remainingBudget <= 0) throw new Error('AI request time budget expired.');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, remainingBudget)));
  let fetchCompleted = false;
  try {
    const response = await fetch(url.href, { signal: controller.signal, credentials: 'omit' });
    fetchCompleted = true;
    if (!response.ok) throw new Error(`Could not download the question image for Gemini (HTTP ${response.status}).`);

    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg');
    const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);
    if (!supportedTypes.has(mimeType)) throw new Error(`Gemini does not support this question image type (${mimeType || 'unknown'}).`);

    const length = Number(response.headers.get('content-length'));
    const maxImageBytes = 14 * 1024 * 1024;
    if (Number.isFinite(length) && length > maxImageBytes) throw new Error('Question image is too large to send to Gemini.');
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxImageBytes) throw new Error('Question image is too large to send to Gemini.');
    return { inline_data: { mime_type: mimeType, data: bytesToBase64(buffer) } };
  } catch (error) {
    if (parentSignal?.aborted) throw makeAbortError();
    if (error.name === 'AbortError') throw new Error('Timed out downloading the question image for Gemini.');
    if (fetchCompleted) throw error;
    throw new Error(`Could not download the question image for Gemini: ${error.message}`);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export async function callVisionOnce(provider, apiKey, visionModel, systemPrompt, textPrompt, imageUrl, opts = {}) {
  const { maxTokens = 500, timeoutMs = VISION_TIMEOUT_MS, temperature = 0.1, signal, requestBudget } = opts;
  const effort = normalizeReasoningEffort(opts.reasoningEffort);
  if (provider === 'gemini') {
    const imagePart = await imageUrlToGeminiPart(imageUrl, timeoutMs, signal, requestBudget);
    const generationConfig = createGeminiGenerationConfig(visionModel, effort, maxTokens);
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: textPrompt }, imagePart] }],
      generationConfig
    };
    const url = `${GEMINI_URL}/${encodeURIComponent(visionModel)}:generateContent`;
    const data = await postJsonWithRetry(url, {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    }, body, timeoutMs, 'Google AI Studio vision', provider, visionModel, { signal, requestBudget });
    return getGeminiResponseText(data);
  }

  const usesOpenAIReasoning = provider === 'openai' && isOpenAIReasoningModel(visionModel);
  const body = {
    model: visionModel,
    messages: [
      { role: usesOpenAIReasoning ? 'developer' : 'system', content: systemPrompt },
      { role: 'user', content: [
        { type: 'text', text: textPrompt },
        { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
      ]}
    ]
  };
  if (!usesOpenAIReasoning) body.temperature = temperature;
  if (provider === 'openrouter') await addOpenRouterRouting(body, visionModel, effort);
  if (usesOpenAIReasoning) {
    addOpenAIReasoningConfig(body, visionModel, maxTokens, effort);
  } else {
    body.max_tokens = maxTokens;
  }

  const data = await postJsonWithRetry(chatCompletionsUrl(provider), chatHeaders(apiKey), body, timeoutMs, `${providerLabel(provider)} vision`, provider, visionModel, { signal, requestBudget });
  return (data?.choices?.[0]?.message?.content || '').trim();
}
