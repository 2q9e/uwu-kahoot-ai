import { getApiKeys } from '../core/storage.js';
import { enrichOpenRouterThroughput, fetchProviderModels } from '../core/model-catalog.js';

export const CATALOG_STORAGE_PREFIX = 'uwuKahootModelCatalogV1_';
export const GEMINI_SPEED_STORAGE_KEY = 'uwuKahootGeminiSpeedV2';
const OPENROUTER_THROUGHPUT_SCAN_LIMIT = 20;
const OPENAI_SPEED_STORAGE_KEY = 'uwuKahootOpenAISpeedV2';
const OPENAI_SPEED_METHOD = 'stream-median-v2';

export function createProviderModelCatalog({
  providers,
  getCurrentProvider,
  getCurrentSettings,
  modelInput,
  refreshModelsBtn,
  catalogHelp,
  populateBackupSlots,
  currentBackupSelection,
  renderModelCatalog,
  setCatalogStatus,
  setAiFeedback,
  persistSync,
  renderProviderQuota,
  resetVisibleModelLimit,
  populateFastModelOptions = () => {}
}) {
  const providerCatalogs = {};
  const measuredGeminiSpeeds = {};

  function getModels(provider = getCurrentProvider()) {
    return providerCatalogs[provider] || [];
  }

  function setModels(provider, models) {
    providerCatalogs[provider] = models;
  }

  async function getCurrentProviderKey(provider = getCurrentProvider()) {
    const saved = await getApiKeys(provider);
    return saved[0] || '';
  }

  async function restoreOpenAISpeedReadings(models) {
    try {
      const readings = (await chrome.storage.local.get(OPENAI_SPEED_STORAGE_KEY))[OPENAI_SPEED_STORAGE_KEY] || {};
      return models.map(model => {
        const cached = model.speedMethod === OPENAI_SPEED_METHOD ? model : {
          ...model,
          speed: null,
          latency: null,
          speedUpdatedAt: '',
          speedSource: '',
          speedMethod: '',
          speedSampleCount: 0,
          speedFirstTokenMs: null,
          speedStreamDurationMs: null,
          speedOutputTokens: null,
          outputTokenCountSource: ''
        };
        const reading = readings[model.id];
        return reading?.speedMethod === OPENAI_SPEED_METHOD ? { ...cached, ...reading } : cached;
      });
    } catch (_) {
      return models.map(model => model.speedMethod === OPENAI_SPEED_METHOD ? model : {
        ...model,
        speed: null,
        latency: null,
        speedUpdatedAt: '',
        speedSource: '',
        speedMethod: '',
        speedSampleCount: 0,
        speedFirstTokenMs: null,
        speedStreamDurationMs: null,
        speedOutputTokens: null,
        outputTokenCountSource: ''
      });
    }
  }

  async function adoptFastestOpenRouterModel(models) {
    const config = providers.openrouter;
    if (getCurrentProvider() !== 'openrouter' || getCurrentSettings().openrouterModel ||
        !modelInput || modelInput.value !== config.defaultModel) return false;
    const fastest = models.find(model => model.supportsAnswers && Number(model.speed) > 0) ||
      models.find(model => model.supportsAnswers);
    if (!fastest || fastest.id === modelInput.value) return false;

    modelInput.value = fastest.id;
    const backups = currentBackupSelection();
    populateBackupSlots(models, backups, fastest.id);
    if (await persistSync({ openrouterModel: fastest.id })) {
      getCurrentSettings().openrouterModel = fastest.id;
      setAiFeedback(`Selected ${fastest.name} as the fastest available free text model.`, 'success');
      return true;
    }
    return false;
  }

  async function restoreProviderCatalog(provider) {
    if (providerCatalogs[provider]) {
      populateBackupSlots(providerCatalogs[provider], currentBackupSelection(), modelInput?.value || '');
      renderModelCatalog();
      return;
    }
    try {
      const cacheKey = `${CATALOG_STORAGE_PREFIX}${provider}`;
      const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
      if (Array.isArray(cached?.models)) {
        const models = provider === 'openai' ? await restoreOpenAISpeedReadings(cached.models) : cached.models;
        providerCatalogs[provider] = models;
        populateFastModelOptions(provider, models);
        if (provider === 'openrouter') await adoptFastestOpenRouterModel(models);
        populateBackupSlots(models, getCurrentSettings()[providers[provider].backupKey], modelInput?.value || '');
        renderModelCatalog();
        const stamp = cached.fetchedAt ? new Date(cached.fetchedAt).toLocaleString() : 'previously';
        setCatalogStatus(`${cached.models.length} cached models · updated ${stamp}. Refresh for the current list.`, 'muted');
        return;
      }
    } catch (_) {  }
    providerCatalogs[provider] = [];
    populateFastModelOptions(provider, []);
    populateBackupSlots([], getCurrentSettings()[providers[provider].backupKey], modelInput?.value || '');
    renderModelCatalog();
    setCatalogStatus('No catalog loaded yet.');
  }

  async function refreshProviderCatalog() {
    if (!refreshModelsBtn) return;
    const provider = getCurrentProvider();
    resetVisibleModelLimit();
    refreshModelsBtn.disabled = true;
    refreshModelsBtn.textContent = 'Loading…';
    setCatalogStatus('Contacting provider model catalog…', 'loading');
    if (catalogHelp) catalogHelp.textContent = provider === 'openrouter'
      ? `Only $0 input and output models are listed. Throughput is the best free endpoint’s provider-reported 30-minute p50, not a live generation check.`
      : provider === 'gemini'
        ? 'Loads every API model. Speed checks run three short streams and use Google candidate token counts to calculate median output TPS and first-token time; quota or billing may apply.'
        : 'Loads models available to the saved OpenAI API key. Speed checks run three short streams and use token-level output data to calculate median visible-text TPS and first-token time; usage charges may apply.';
    try {
      const key = await getCurrentProviderKey(provider);
      if (!key) throw new Error('Enter or save this provider’s API key first.');
      let models = await fetchProviderModels(provider, key);
      if (provider === 'openai') models = await restoreOpenAISpeedReadings(models);
      providerCatalogs[provider] = models;
      populateFastModelOptions(provider, models);
      if (provider === getCurrentProvider()) {
        populateBackupSlots(models, currentBackupSelection(), modelInput?.value || '');
        renderModelCatalog();
        setCatalogStatus(`${models.length.toLocaleString()} ${provider === 'openrouter' ? 'free ' : ''}models found.`, 'success');
      }
      if (provider === 'openrouter') {
        if (provider === getCurrentProvider()) setCatalogStatus(`Found ${models.length.toLocaleString()} free models. Loading recent provider p50 throughput for the top ${Math.min(models.length, OPENROUTER_THROUGHPUT_SCAN_LIMIT)}…`, 'loading');
        models = await enrichOpenRouterThroughput(models, key, (done, total) => {
        if (provider === getCurrentProvider()) setCatalogStatus(`Loading endpoint p50 readings: ${done.toLocaleString()} / ${total.toLocaleString()}…`, 'loading');
        }, { limit: OPENROUTER_THROUGHPUT_SCAN_LIMIT });
        providerCatalogs[provider] = models;
        populateFastModelOptions(provider, models);
        if (provider === getCurrentProvider()) await adoptFastestOpenRouterModel(models);
        const speedCount = models.filter(model => Number.isFinite(Number(model.speed)) && Number(model.speed) > 0).length;
        if (provider === getCurrentProvider()) {
          populateBackupSlots(models, currentBackupSelection(), modelInput?.value || '');
          renderModelCatalog();
          setCatalogStatus(`${models.length.toLocaleString()} free models · provider p50 readings for ${speedCount.toLocaleString()}. These readings describe free endpoints over the last 30 minutes.`, 'success');
        }
      }
      const cacheKey = `${CATALOG_STORAGE_PREFIX}${provider}`;
      await chrome.storage.local.set({ [cacheKey]: { fetchedAt: new Date().toISOString(), models } });
      if (provider === getCurrentProvider()) await renderProviderQuota(provider, key);
    } catch (error) {
      if (provider === getCurrentProvider()) {
        setCatalogStatus(error.message || 'Could not load models.', 'error');
        await renderProviderQuota(provider);
      }
    } finally {
      refreshModelsBtn.disabled = false;
      refreshModelsBtn.textContent = 'Refresh';
    }
  }

  async function loadGeminiSpeedMeasurements() {
    try {
      const stored = await chrome.storage.local.get(GEMINI_SPEED_STORAGE_KEY);
      Object.assign(measuredGeminiSpeeds, stored[GEMINI_SPEED_STORAGE_KEY] || {});
    } catch (_) {  }
  }

  return {
    adoptFastestOpenRouterModel,
    getCurrentProviderKey,
    getMeasuredGeminiSpeeds: () => measuredGeminiSpeeds,
    getModels,
    loadGeminiSpeedMeasurements,
    refreshProviderCatalog,
    restoreProviderCatalog,
    setModels
  };
}
