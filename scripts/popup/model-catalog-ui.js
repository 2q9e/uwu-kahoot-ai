import { getProviderApiKeyEntries } from '../core/storage.js';
import { normalizeBackupModels, normalizeReasoningEffort } from '../core/model-routing.js';
import { createProviderQuotaUi } from './provider-quota-ui.js';
import { createBackupModelUi } from './backup-model-ui.js';
import { createModelCatalogRenderer } from './model-catalog-renderer.js';
import { CATALOG_STORAGE_PREFIX, createProviderModelCatalog } from './provider-model-catalog.js';

const MODEL_REASONING_STORAGE_KEY = 'modelReasoningEffort';

export function createModelCatalogUi({ getCurrentProvider, getCurrentSettings, providers, defaultProvider, deprecatedModels, setAiFeedback, persistSync, renderApiKeyManager }) {
  const modelInput = document.getElementById('aiModel');
  const visionInput = document.getElementById('aiVisionModel');
  const reasoningSelect = document.getElementById('reasoningEffort');
  const fastBinaryCheckbox = document.getElementById('fastBinaryAnswers');
  const fastBinaryModelSelect = document.getElementById('fastBinaryModel');
  const fastBinaryModelHelp = document.getElementById('fastBinaryModelHelp');
  const textModelOptions = document.getElementById('textModelOptions');
  const visionModelOptions = document.getElementById('visionModelOptions');
  const modelCapabilityFilter = document.getElementById('modelCapabilityFilter');
  const useProviderDefaultsButton = document.getElementById('useProviderDefaults');
  const useFastestModelButton = document.getElementById('useFastestModel');
  const modelSelectionState = document.getElementById('modelSelectionState');
  const modelSelectionText = document.getElementById('modelSelectionText');
  const modelSelectionVision = document.getElementById('modelSelectionVision');
  const modelSelectionFastLane = document.getElementById('modelSelectionFastLane');
  const modelSelectionReasoning = document.getElementById('modelSelectionReasoning');
  const primaryModelHelp = document.getElementById('primaryModelHelp');
  const visionModelHelp = document.getElementById('visionModelHelp');
  const backupModelSelects = [...document.querySelectorAll('.backup-model')];
  const backupCount = document.getElementById('backupCount');
  const refreshModelsBtn = document.getElementById('refreshModels');
  const modelSearchInput = document.getElementById('modelSearch');
  const catalogStatus = document.getElementById('catalogStatus');
  const catalogHelp = document.getElementById('catalogHelp');
  const modelCatalogList = document.getElementById('modelCatalogList');
  const showMoreModelsBtn = document.getElementById('showMoreModels');

  function setCatalogStatus(message, state = '') {
    if (!catalogStatus) return;
    catalogStatus.textContent = message;
    catalogStatus.className = `catalog-status ${state}`;
  }

  let providerCatalog;
  const providerQuotaUi = createProviderQuotaUi({
    providers,
    getProviderKey: provider => providerCatalog.getCurrentProviderKey(provider)
  });
  const backupModelUi = createBackupModelUi({
    backupModelSelects,
    backupCount,
    modelInput,
    providers,
    getCurrentProvider,
    getCurrentSettings,
    getModels: provider => providerCatalog?.getModels(provider) || [],
    persistSync
  });
  function updateModelSuggestions(models = providerCatalog?.getModels(getCurrentProvider()) || []) {
    const fill = (list, items) => {
      if (!list) return;
      const fragment = document.createDocumentFragment();
      for (const model of items.slice(0, 400)) {
        const option = document.createElement('option');
        option.value = model.id;
        option.label = model.name || model.id;
        fragment.append(option);
      }
      list.replaceChildren(fragment);
    };
    fill(textModelOptions, models.filter(model => model?.id && model.supportsAnswers !== false));
    fill(visionModelOptions, models.filter(model => model?.id && model.supportsVision));
  }
  function modelDisplayName(id, models) {
    const model = models.find(item => item.id === id);
    return model ? `${model.name} · ${model.id}` : `${id} · custom or not in the loaded catalog`;
  }
  function refreshSelectionSummary() {
    const provider = getCurrentProvider();
    const config = providers[provider] || providers[defaultProvider];
    const settings = getCurrentSettings();
    const models = providerCatalog?.getModels(provider) || [];
    const model = modelInput?.value.trim() || config.defaultModel;
    const vision = visionInput?.value.trim() || config.defaultVision;
    const effort = normalizeReasoningEffort(reasoningSelect?.value);
    if (modelSelectionText) modelSelectionText.textContent = modelDisplayName(model, models);
    if (modelSelectionVision) modelSelectionVision.textContent = modelDisplayName(vision, models);
    if (modelSelectionFastLane) {
      const fastLaneEnabled = fastBinaryCheckbox?.checked === true;
      const fastModel = String(fastBinaryModelSelect?.value || '').trim();
      modelSelectionFastLane.textContent = !fastLaneEnabled
        ? 'Off'
        : fastModel
          ? `Enabled · ${modelDisplayName(fastModel, models)}`
          : 'Enabled · automatic';
    }
    if (modelSelectionReasoning) modelSelectionReasoning.textContent = reasoningSelect?.selectedOptions?.[0]?.textContent || effort;
    const savedModel = String(settings[config.modelKey] || config.defaultModel).trim();
    const savedVision = String(settings[config.visionKey] || config.defaultVision).trim();
    const savedBackups = normalizeBackupModels(settings[config.backupKey], savedModel);
    const currentBackups = backupModelUi.currentBackupSelection();
    const savedFastModel = String(settings[config.fastModelKey] || '').trim();
    const fastModel = String(fastBinaryModelSelect?.value || '').trim();
    const savedFastLane = settings.fastBinaryAnswersEnabled !== false;
    const fastLane = fastBinaryCheckbox?.checked === true;
    const savedEffort = normalizeReasoningEffort(settings[MODEL_REASONING_STORAGE_KEY]);
    const dirty = model !== savedModel || vision !== savedVision || effort !== savedEffort ||
      fastModel !== savedFastModel || fastLane !== savedFastLane ||
      JSON.stringify(currentBackups) !== JSON.stringify(savedBackups);
    if (modelSelectionState) {
      modelSelectionState.textContent = dirty ? 'Unsaved changes' : 'Saved setup';
      modelSelectionState.classList.toggle('unsaved', dirty);
      modelSelectionState.classList.toggle('saved', !dirty);
    }
  }
  const modelRenderer = createModelCatalogRenderer({
    catalogPrefix: CATALOG_STORAGE_PREFIX,
    getCurrentProvider,
    getModels: provider => providerCatalog?.getModels(provider) || [],
    setModels: (provider, models) => providerCatalog.setModels(provider, models),
    getMeasuredGeminiSpeeds: () => providerCatalog.getMeasuredGeminiSpeeds(),
    modelInput,
    visionInput,
    modelSearchInput,
    modelCapabilityFilter,
    modelCatalogList,
    showMoreModelsBtn,
    currentBackupSelection: backupModelUi.currentBackupSelection,
    populateBackupSlots: backupModelUi.populateBackupSlots,
    getCurrentProviderKey: provider => providerCatalog.getCurrentProviderKey(provider),
    setAiFeedback,
    onSelectionChange: refreshSelectionSummary,
    onModelsUpdated: (provider, models) => {
      if (provider === getCurrentProvider()) {
        populateFastModelOptions(provider, models, getCurrentSettings()[providers[provider]?.fastModelKey]);
      }
    },
    renderProviderQuota: providerQuotaUi.renderProviderQuota
  });
  function populateFastModelOptions(provider, models = [], savedModel = '') {
    if (!fastBinaryModelSelect) return;
    const selected = String(savedModel || '').trim();
    const automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = provider === 'openrouter'
      ? 'Automatic · fastest measured free model'
      : provider === 'gemini'
        ? 'Automatic · fastest measured / Flash-Lite'
        : 'Automatic · primary model';
    fastBinaryModelSelect.replaceChildren(automatic);
    const available = models.filter(model => model?.id && model.supportsAnswers !== false);
    const measuredGemini = provider === 'gemini' ? providerCatalog?.getMeasuredGeminiSpeeds() || {} : {};
    for (const model of available) {
      const option = document.createElement('option');
      option.value = model.id;
      const measuredSpeed = Number(model.speed) > 0 ? Number(model.speed) : Number(measuredGemini[model.id]?.tokensPerSecond);
      const speed = measuredSpeed > 0
        ? ` · ${Math.round(measuredSpeed)} ${provider === 'openrouter' ? 'endpoint p50' : 'stream'} tok/s`
        : '';
      option.textContent = `${model.name || model.id}${speed} — ${model.id}`;
      fastBinaryModelSelect.append(option);
    }
    if (selected && !available.some(model => model.id === selected)) {
      const saved = document.createElement('option');
      saved.value = selected;
      saved.textContent = `Saved override — ${selected}`;
      fastBinaryModelSelect.append(saved);
    }
    fastBinaryModelSelect.value = selected;
    if (fastBinaryModelHelp) {
      fastBinaryModelHelp.textContent = provider === 'openrouter'
        ? 'Automatic chooses the cached free model with the highest recent throughput. Until a catalog is loaded, it uses the configured OpenRouter fast free model.'
        : provider === 'gemini'
          ? 'Automatic uses the fastest Gemini model measured in this browser. Until then it uses the configured Gemini fast model.'
          : 'Automatic uses your selected primary model with the lowest reasoning effort.';
    }
  }
  providerCatalog = createProviderModelCatalog({
    providers,
    getCurrentProvider,
    getCurrentSettings,
    modelInput,
    refreshModelsBtn,
    catalogHelp,
    populateBackupSlots: backupModelUi.populateBackupSlots,
    currentBackupSelection: backupModelUi.currentBackupSelection,
    renderModelCatalog: () => {
      updateModelSuggestions();
      modelRenderer.renderModelCatalog();
      refreshSelectionSummary();
    },
    setCatalogStatus,
    setAiFeedback,
    persistSync,
    renderProviderQuota: providerQuotaUi.renderProviderQuota,
    resetVisibleModelLimit: modelRenderer.resetVisibleModelLimit,
    populateFastModelOptions: (provider, models) => {
      if (provider !== getCurrentProvider()) return;
      populateFastModelOptions(provider, models, getCurrentSettings()[providers[provider]?.fastModelKey]);
    }
  });

  function wireModelControls() {
    refreshModelsBtn?.addEventListener('click', providerCatalog.refreshProviderCatalog);
    modelSearchInput?.addEventListener('input', modelRenderer.handleSearch);
    modelCapabilityFilter?.addEventListener('change', modelRenderer.handleSearch);
    showMoreModelsBtn?.addEventListener('click', modelRenderer.showMoreModels);
    modelInput?.addEventListener('input', refreshSelectionSummary);
    visionInput?.addEventListener('input', refreshSelectionSummary);
    modelInput?.addEventListener('change', () => {
      const next = backupModelUi.currentBackupSelection();
      backupModelUi.populateBackupSlots(providerCatalog.getModels(getCurrentProvider()), next, modelInput.value);
      refreshSelectionSummary();
      modelRenderer.renderModelCatalog();
    });
    visionInput?.addEventListener('change', modelRenderer.renderModelCatalog);
    reasoningSelect?.addEventListener('change', refreshSelectionSummary);
    fastBinaryCheckbox?.addEventListener('change', refreshSelectionSummary);
    fastBinaryModelSelect?.addEventListener('change', () => {
      refreshSelectionSummary();
      setAiFeedback(fastBinaryModelSelect.value
        ? 'Fast-lane model changed. Save provider settings to apply it.'
        : 'Automatic fast-lane model selected. Save provider settings to apply it.');
    });
    for (const select of backupModelSelects) select.addEventListener('change', () => {
      const backups = backupModelUi.currentBackupSelection();
      backupModelUi.populateBackupSlots(providerCatalog.getModels(getCurrentProvider()), backups, modelInput?.value || '');
      refreshSelectionSummary();
    });
    useProviderDefaultsButton?.addEventListener('click', () => {
      const config = providers[getCurrentProvider()] || providers[defaultProvider];
      if (modelInput) modelInput.value = config.defaultModel;
      if (visionInput) visionInput.value = config.defaultVision;
      const backups = backupModelUi.currentBackupSelection();
      backupModelUi.populateBackupSlots(providerCatalog.getModels(getCurrentProvider()), backups, config.defaultModel);
      refreshSelectionSummary();
      modelRenderer.renderModelCatalog();
      setAiFeedback('Provider default models selected. Save provider settings to apply them.');
    });
    useFastestModelButton?.addEventListener('click', () => {
      const provider = getCurrentProvider();
      const config = providers[provider] || providers[defaultProvider];
      const models = providerCatalog.getModels(provider).filter(model => model?.supportsAnswers !== false);
      let fastest = null;
      let source = '';
      if (provider === 'gemini') {
        const measured = providerCatalog.getMeasuredGeminiSpeeds();
        fastest = models.filter(model => Number(measured[model.id]?.tokensPerSecond) > 0)
          .sort((a, b) => Number(measured[b.id].tokensPerSecond) - Number(measured[a.id].tokensPerSecond))[0] || null;
        if (fastest) source = 'your Gemini speed checks';
      } else {
        fastest = models.filter(model => Number(model.speed) > 0)
          .sort((a, b) => Number(b.speed) - Number(a.speed))[0] || null;
        if (fastest) source = provider === 'openrouter' ? 'recent OpenRouter throughput readings' : 'provider catalog speed data';
      }
      if (!fastest) {
        const firstFreeModel = provider === 'openrouter' ? models[0] : null;
        const id = firstFreeModel?.id || config.defaultModel;
        if (modelInput) modelInput.value = id;
        source = provider === 'openai'
          ? 'the provider default; per-model speed is not published'
          : firstFreeModel
            ? 'the first free model in the catalog because no endpoint speed reading is cached yet'
            : 'the provider default because no speed reading is available yet';
      } else if (modelInput) {
        modelInput.value = fastest.id;
      }
      const backups = backupModelUi.currentBackupSelection();
      backupModelUi.populateBackupSlots(models, backups, modelInput?.value || config.defaultModel);
      refreshSelectionSummary();
      modelRenderer.renderModelCatalog();
      setAiFeedback(`Selected ${modelInput?.value || config.defaultModel} using ${source}. Save provider settings to apply it.`, 'success');
    });
  }

  function isFreeOpenRouterModel(id) {
    const models = providerCatalog.getModels('openrouter');
    return models.some(item => item.id === id) || (!models.length && /:free$/i.test(id));
  }

  function setReasoningEffort(value) {
    if (reasoningSelect) reasoningSelect.value = normalizeReasoningEffort(value);
  }

  function getFormValues() {
    const config = providers[getCurrentProvider()] || providers[defaultProvider];
    const model = modelInput?.value.trim() || config.defaultModel;
    return {
      model,
      visionModel: visionInput?.value.trim() || config.defaultVision,
      fastModel: fastBinaryModelSelect?.value.trim() || '',
      fastBinaryAnswersEnabled: fastBinaryCheckbox?.checked === true,
      backupModels: backupModelUi.currentBackupSelection(),
      reasoningEffort: normalizeReasoningEffort(reasoningSelect?.value)
    };
  }

  async function loadGeminiSpeedMeasurements() {
    await providerCatalog.loadGeminiSpeedMeasurements();
    if (getCurrentProvider() === 'gemini') {
      const provider = providers.gemini;
      populateFastModelOptions('gemini', providerCatalog.getModels('gemini'), getCurrentSettings()[provider.fastModelKey]);
    }
  }

  async function loadProviderFields(provider) {
    const config = providers[provider] || providers[defaultProvider];
    if (modelSearchInput) modelSearchInput.value = '';
    setCatalogStatus('Loading saved model catalog…', 'loading');
    providerQuotaUi.setLoading();
    if (fastBinaryCheckbox) fastBinaryCheckbox.checked = getCurrentSettings().fastBinaryAnswersEnabled !== false;
    if (modelInput) {
      let model = (getCurrentSettings()[config.modelKey] || config.defaultModel).trim();
      if (provider === 'openai' && deprecatedModels.has(model.toLowerCase())) model = config.defaultModel;
      modelInput.value = model;
      modelInput.readOnly = provider === 'openrouter';
    }
    if (visionInput) {
      let visionModel = (getCurrentSettings()[config.visionKey] || config.defaultVision).trim();
      if (provider === 'openai' && deprecatedModels.has(visionModel.toLowerCase())) visionModel = config.defaultVision;
      visionInput.value = visionModel;
      visionInput.readOnly = provider === 'openrouter';
    }
    if (provider === 'openrouter') {
      if (primaryModelHelp) primaryModelHelp.textContent = 'Choose a listed free text model in the catalog below. Model IDs are locked to prevent accidentally routing quiz questions to paid models.';
      if (visionModelHelp) visionModelHelp.textContent = 'Choose a listed free model marked Image input in the catalog below.';
    } else {
      if (primaryModelHelp) primaryModelHelp.textContent = 'Choose a catalog model below or enter a provider model ID. This model handles normal text questions.';
      if (visionModelHelp) visionModelHelp.textContent = 'Used when a Kahoot question includes an image. Pick a catalog model marked Image input.';
    }
    if (catalogHelp) catalogHelp.textContent = provider === 'openrouter'
      ? 'OpenRouter TPS is the best free endpoint’s provider-reported 30-minute p50; it is metadata, not a live prompt test.'
      : provider === 'gemini'
        ? 'Measure speed runs three short streams, uses Google candidate token counts, and reports median stream TPS plus first-token time. Quota or billing may apply.'
        : 'Measure speed runs three short streams, uses OpenAI token-level stream data, and reports median stream TPS plus first-token time. Models without that data cannot be measured. Charges may apply.';

    const entries = await getProviderApiKeyEntries(provider);
    const settings = getCurrentSettings();
    settings.managedApiKeys = { ...(settings.managedApiKeys || {}), [provider]: entries };
    await renderApiKeyManager(provider);
    const hasSavedFallbackKey = Object.keys(providers).some(fallbackProvider =>
      fallbackProvider !== provider && (settings.managedApiKeys?.[fallbackProvider] || []).some(entry => entry.enabled)
    );
    const hasPrivateFallbackKey = Object.entries(settings.privateApiKeys || {}).some(([fallbackProvider, keys]) =>
      fallbackProvider !== provider && !!keys.length
    );
    const primaryModel = modelInput?.value || config.defaultModel;
    const backups = normalizeBackupModels(settings[config.backupKey], primaryModel);
    backupModelUi.populateBackupSlots(providerCatalog.getModels(provider), backups, primaryModel);
    await providerCatalog.restoreProviderCatalog(provider);
    updateModelSuggestions(providerCatalog.getModels(provider));
    populateFastModelOptions(provider, providerCatalog.getModels(provider), settings[config.fastModelKey]);
    await providerQuotaUi.renderProviderQuota(provider);
    refreshSelectionSummary();
    return entries.some(entry => entry.enabled) || !!settings.privateApiKeys?.[provider]?.length ||
      (settings.aiFallbackEnabled !== false && (hasSavedFallbackKey || hasPrivateFallbackKey));
  }

  return {
    currentBackupSelection: backupModelUi.currentBackupSelection,
    getFormValues,
    getModels: providerCatalog.getModels,
    isFreeOpenRouterModel,
    loadProviderFields,
    loadGeminiSpeedMeasurements,
    persistBackupSlots: backupModelUi.persistBackupSlots,
    populateBackupSlots: backupModelUi.populateBackupSlots,
    renderModelCatalog: () => {
      updateModelSuggestions();
      modelRenderer.renderModelCatalog();
      refreshSelectionSummary();
    },
    refreshSelectionSummary,
    renderProviderQuota: providerQuotaUi.renderProviderQuota,
    resetVisibleModelLimit: modelRenderer.resetVisibleModelLimit,
    restoreProviderCatalog: providerCatalog.restoreProviderCatalog,
    setReasoningEffort,
    setCatalogStatus,
    wireModelControls
  };
}
