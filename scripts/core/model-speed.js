import { geminiThinkingConfig } from './model-routing.js';
import { recordProviderUsage } from './provider-usage.js';
import { GEMINI_MODELS_URL, safeMessage } from './model-catalog-transport.js';

const SPEED_REQUEST_TIMEOUT_MS = 30000;
const SPEED_SAMPLE_COUNT = 3;
const SPEED_MIN_OUTPUT_TOKENS = 24;
const SPEED_OUTPUT_TARGET = 64;
const SPEED_MAX_OUTPUT_TOKENS = 96;
const SPEED_MEASUREMENT_METHOD = 'stream-median-v2';

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
