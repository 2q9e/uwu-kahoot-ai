import { safeMessage } from './model-catalog-transport.js';

const SPEED_REQUEST_TIMEOUT_MS = 30000;
export const SPEED_SAMPLE_COUNT = 3;
export const SPEED_OUTPUT_TARGET = 64;
export const SPEED_MAX_OUTPUT_TOKENS = 96;
const SPEED_MIN_OUTPUT_TOKENS = 24;
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

export function summarizeSpeedSamples(samples) {
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

export function createSpeedSample({ startedAt, firstOutputAt, lastOutputAt, outputChunks, inputTokens, outputTokens, providerOutputTokens = outputTokens, label }) {
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

export async function postSseJson(url, headers, body, apiKey, label, onEvent) {
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
