import { recordProviderUsage } from './provider-usage.js';
import {
  createSpeedSample,
  postSseJson,
  SPEED_MAX_OUTPUT_TOKENS,
  SPEED_OUTPUT_TARGET,
  SPEED_SAMPLE_COUNT,
  summarizeSpeedSamples
} from './model-speed-shared.js';

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
