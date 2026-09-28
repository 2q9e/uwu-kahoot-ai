import { enrichOpenRouterThroughput, measureGeminiModel, measureOpenAIModel } from '../core/model-catalog.js';

const OPENAI_SPEED_STORAGE_KEY = 'uwuKahootOpenAISpeedV2';
const GEMINI_SPEED_STORAGE_KEY = 'uwuKahootGeminiSpeedV2';
let paidSpeedChecksConfirmed = false;

function confirmPaidSpeedCheck(providerName) {
  if (paidSpeedChecksConfirmed) return true;
  const accepted = window.confirm(
    `A ${providerName} speed check sends three short generation requests and may incur provider charges. Continue?`
  );
  if (accepted) paidSpeedChecksConfirmed = true;
  return accepted;
}

export function createModelCatalogSpeedActions({
  catalogPrefix,
  getCurrentProvider,
  getModels,
  setModels,
  getMeasuredGeminiSpeeds,
  getCurrentProviderKey,
  setAiFeedback,
  onModelsUpdated,
  renderProviderQuota,
  renderModelCatalog
}) {
  async function measureGeminiSpeed(model, button) {
    const key = await getCurrentProviderKey('gemini');
    const isCurrentProvider = () => getCurrentProvider() === 'gemini';
    if (!key) {
      if (isCurrentProvider()) setAiFeedback('Enter or save your Google AI Studio key before measuring speed.', 'error');
      return;
    }
    if (!isCurrentProvider()) return;
    if (!confirmPaidSpeedCheck('Google AI Studio')) {
      setAiFeedback('Speed check canceled; no requests were sent.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Measuring 1/3…';
    try {
      const result = await measureGeminiModel(key, model.id, (done, total) => {
        if (isCurrentProvider() && button.isConnected) {
          button.textContent = done >= total ? 'Summarizing…' : `Measuring ${done + 1}/${total}…`;
        }
      });
      const measuredSpeeds = getMeasuredGeminiSpeeds();
      measuredSpeeds[model.id] = { ...result, sampledAt: new Date().toISOString() };
      try {
        const saved = await chrome.storage.local.get(GEMINI_SPEED_STORAGE_KEY);
        const speeds = { ...(saved[GEMINI_SPEED_STORAGE_KEY] || {}), [model.id]: measuredSpeeds[model.id] };
        const entries = Object.entries(speeds).slice(-100);
        await chrome.storage.local.set({ [GEMINI_SPEED_STORAGE_KEY]: Object.fromEntries(entries) });
      } catch (_) {  }
      onModelsUpdated('gemini', getModels('gemini'));
      if (isCurrentProvider()) {
        setAiFeedback(`${model.name}: median streamed TPS ${result.tokensPerSecond} candidate tok/s across ${result.sampleCount} runs · median first token ${result.firstTokenMs} ms.`, 'success');
        renderModelCatalog();
      }
      await renderProviderQuota('gemini', key);
    } catch (error) {
      if (isCurrentProvider()) setAiFeedback(error.message || 'Speed check failed.', 'error');
      await renderProviderQuota('gemini', key);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async function measureOpenRouterSpeed(model, button) {
    const key = await getCurrentProviderKey('openrouter');
    if (!key) {
      setAiFeedback('Enter or save your OpenRouter key before checking throughput.', 'error');
      return;
    }
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const measuredModels = await enrichOpenRouterThroughput([model], key, () => {}, { modelIds: [model.id], limit: 1, force: true });
      const measurement = measuredModels.find(item => item.id === model.id);
      const updated = getModels('openrouter').map(item => item.id === model.id ? {
        ...item,
        speed: measurement?.speed ?? null,
        latency: measurement?.latency ?? null,
        speedProvider: measurement?.speedProvider || '',
        uptime: measurement?.uptime ?? null,
        speedUpdatedAt: measurement?.speedUpdatedAt || '',
        speedSource: measurement?.speedSource || ''
      } : item);
      setModels('openrouter', updated);
      onModelsUpdated('openrouter', updated);
      try {
        await chrome.storage.local.set({
          [`${catalogPrefix}openrouter`]: { fetchedAt: new Date().toISOString(), models: updated }
        });
      } catch (_) {  }
      setAiFeedback(measurement?.speed ? `${model.name}: ${Math.round(measurement.speed)} output tok/s p50 from ${measurement.speedProvider || 'a free endpoint'}.` : `No current free-endpoint throughput reading is available for ${model.name}.`, measurement?.speed ? 'success' : '');
      renderModelCatalog();
    } catch (error) {
      setAiFeedback(error.message || 'Could not check free-endpoint throughput.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function measureOpenAISpeed(model, button) {
    const key = await getCurrentProviderKey('openai');
    if (!key) {
      setAiFeedback('Enter or save an OpenAI key before measuring speed.', 'error');
      return;
    }
    if (!confirmPaidSpeedCheck('OpenAI')) {
      setAiFeedback('Speed check canceled; no requests were sent.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Measuring 1/3…';
    try {
      const result = await measureOpenAIModel(key, model.id, (done, total) => {
        button.textContent = done >= total ? 'Summarizing…' : `Measuring ${done + 1}/${total}…`;
      });
      const sampledAt = new Date().toISOString();
      const speedRecord = {
        speed: result.tokensPerSecond,
        latency: result.firstTokenMs / 1000,
        speedUpdatedAt: sampledAt,
        speedSource: 'Median client-observed stream TPS',
        speedMethod: result.measurementMethod,
        speedSampleCount: result.sampleCount,
        speedMin: result.minTokensPerSecond,
        speedMax: result.maxTokensPerSecond,
        speedFirstTokenMs: result.firstTokenMs,
        speedStreamDurationMs: result.streamDurationMs,
        outputTokenCountSource: result.outputTokenCountSource,
        speedOutputTokens: result.outputTokens
      };
      let speedCache = {};
      try {
        speedCache = (await chrome.storage.local.get(OPENAI_SPEED_STORAGE_KEY))[OPENAI_SPEED_STORAGE_KEY] || {};
      } catch (_) {  }
      const updated = getModels('openai').map(item => item.id === model.id ? { ...item, ...speedRecord } : item);
      setModels('openai', updated);
      onModelsUpdated('openai', updated);
      const nextSpeedCache = { ...speedCache, [model.id]: speedRecord };
      const recentSpeeds = Object.entries(nextSpeedCache)
        .sort((a, b) => Date.parse(b[1]?.speedUpdatedAt || '') - Date.parse(a[1]?.speedUpdatedAt || ''))
        .slice(0, 200);
      try {
        await chrome.storage.local.set({ [OPENAI_SPEED_STORAGE_KEY]: Object.fromEntries(recentSpeeds) });
      } catch (_) {  }
      setAiFeedback(`${model.name}: median streamed TPS ${result.tokensPerSecond} visible text tok/s across ${result.sampleCount} runs · median first token ${result.firstTokenMs} ms. OpenAI usage charges may apply.`, 'success');
      renderModelCatalog();
    } catch (error) {
      setAiFeedback(error.message || 'OpenAI speed check failed.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Measure speed';
    }
  }

  return { measureGeminiSpeed, measureOpenAISpeed, measureOpenRouterSpeed };
}
