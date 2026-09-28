import { geminiThinkingConfig } from './model-routing.js';
import { recordProviderUsage } from './provider-usage.js';
import { GEMINI_MODELS_URL } from './model-catalog-transport.js';
import {
  createSpeedSample,
  postSseJson,
  SPEED_MAX_OUTPUT_TOKENS,
  SPEED_OUTPUT_TARGET,
  SPEED_SAMPLE_COUNT,
  summarizeSpeedSamples
} from './model-speed-shared.js';

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
