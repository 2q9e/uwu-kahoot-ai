import { normalizeBackupModels, normalizeReasoningEffort } from '../core/model-routing.js';
import { createProviderQuotaUi } from './provider-quota-ui.js';
import { createBackupModelUi } from './backup-model-ui.js';
import { createModelCatalogRenderer } from './model-catalog-renderer.js';
import { createProviderFieldsLoader } from './provider-fields-loader.js';
import { CATALOG_STORAGE_PREFIX, createProviderModelCatalog } from './provider-model-catalog.js';
import { chooseFastestModel, getFastModelOptions } from './fast-model-selection.js';

const MODEL_REASONING_STORAGE_KEY = 'modelReasoningEffort';

export function createModelCatalogUi({ getCurrentProvider, getCurrentSettings, providers, defaultProvider, deprecatedModels, setAiFeedback, persistSync, renderApiKeyManager, setProviderKeyLoadStatus }) {
  const providerModelDrafts = new Map();
  let sharedModelDraft = null;
  const modelInput = document.getElementById('aiModel');
  const visionInput = document.getElementById('aiVisionModel');
  const providerSelect = document.getElementById('aiProvider');
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
  const saveSettingsButton = document.getElementById('saveApi');
  const apiKeyList = document.getElementById('apiKeyList');
  const apiKeySummary = document.getElementById('apiKeySummary');
  const localConfigKeys = document.getElementById('localConfigKeys');
  const testEnabledKeysButton = document.getElementById('testEnabledApiKeys');
  const providerFormPanels = ['apiKeysPanel', 'modelSettingsPanel', 'fastBinaryPanel', 'backupModelsPanel', 'modelCatalogPanel']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  let providerFieldsLoading = false;

  function setProviderFieldsLoading(loading) {
    providerFieldsLoading = Boolean(loading);
    for (const panel of providerFormPanels) {
      panel.inert = providerFieldsLoading;
      if (providerFieldsLoading) panel.setAttribute('aria-busy', 'true');
      else panel.removeAttribute('aria-busy');
    }
    if (providerSelect) providerSelect.disabled = providerFieldsLoading;
    if (saveSettingsButton) saveSettingsButton.disabled = providerFieldsLoading;
  }

  function clearProviderKeyList(message) {
    apiKeyList?.replaceChildren();
    localConfigKeys?.replaceChildren();
    if (apiKeySummary) apiKeySummary.textContent = message;
    if (testEnabledKeysButton) testEnabledKeysButton.disabled = true;
  }

  setProviderFieldsLoading(true);

  function setCatalogStatus(message, state = '') {
    if (!catalogStatus) return;
    catalogStatus.textContent = message;
    catalogStatus.className = `catalog-status ${state}`;
  }

  let providerCatalog;
  const providerQuotaUi = createProviderQuotaUi({
    providers,
    getCurrentProvider,
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
    const providerFieldsDirty = model !== savedModel || vision !== savedVision || fastModel !== savedFastModel ||
      JSON.stringify(currentBackups) !== JSON.stringify(savedBackups);
    if (providerFieldsDirty) {
      providerModelDrafts.set(provider, {
        model,
        visionModel: vision,
        fastModel,
        backupModels: [...currentBackups]
      });
    } else {
      providerModelDrafts.delete(provider);
    }
    sharedModelDraft = effort !== savedEffort || fastLane !== savedFastLane
      ? { reasoningEffort: effort, fastBinaryAnswersEnabled: fastLane }
      : null;
    const dirty = providerFieldsDirty || sharedModelDraft !== null;
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
        const savedFastModel = getCurrentSettings()[providers[provider]?.fastModelKey];
        populateFastModelOptions(provider, models, fastBinaryModelSelect?.value ?? savedFastModel);
      }
    },
    renderProviderQuota: providerQuotaUi.renderProviderQuota
  });
  function populateFastModelOptions(provider, models = [], savedModel = '') {
    if (!fastBinaryModelSelect) return;
    const measuredGemini = provider === 'gemini' ? providerCatalog?.getMeasuredGeminiSpeeds() || {} : {};
    const fastModelOptions = getFastModelOptions(provider, models, savedModel, measuredGemini);
    const fragment = document.createDocumentFragment();
    for (const { value, text } of fastModelOptions.options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      fragment.append(option);
    }
    fastBinaryModelSelect.replaceChildren(fragment);
    fastBinaryModelSelect.value = fastModelOptions.selected;
    if (fastBinaryModelHelp) fastBinaryModelHelp.textContent = fastModelOptions.help;
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
      const savedFastModel = getCurrentSettings()[providers[provider]?.fastModelKey];
      populateFastModelOptions(provider, models, fastBinaryModelSelect?.value ?? savedFastModel);
    }
  });

  const loadProviderFields = createProviderFieldsLoader({
    getCurrentProvider,
    getCurrentSettings,
    providers,
    defaultProvider,
    deprecatedModels,
    providerModelDrafts,
    getSharedModelDraft: () => sharedModelDraft,
    modelSearchInput,
    setCatalogStatus,
    providerQuotaUi,
    clearProviderKeyList,
    fastBinaryCheckbox,
    reasoningSelect,
    modelInput,
    visionInput,
    primaryModelHelp,
    visionModelHelp,
    catalogHelp,
    backupModelUi,
    providerCatalog,
    populateFastModelOptions,
    setProviderKeyLoadStatus,
    setAiFeedback,
    refreshSelectionSummary,
    updateModelSuggestions,
    renderApiKeyManager,
    setProviderFieldsLoading
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
        ? 'Fast-lane model changed. Save model settings to apply it.'
        : 'Automatic fast-lane model selected. Save model settings to apply it.');
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
      setAiFeedback('Provider default models selected. Save model settings to apply them.');
    });
    useFastestModelButton?.addEventListener('click', () => {
      const provider = getCurrentProvider();
      const config = providers[provider] || providers[defaultProvider];
      const models = providerCatalog.getModels(provider).filter(model => model?.supportsAnswers !== false);
      const choice = chooseFastestModel(
        provider,
        models,
        provider === 'gemini' ? providerCatalog.getMeasuredGeminiSpeeds() : {},
        config.defaultModel
      );
      if (modelInput) modelInput.value = choice.model;
      const backups = backupModelUi.currentBackupSelection();
      backupModelUi.populateBackupSlots(models, backups, modelInput?.value || config.defaultModel);
      refreshSelectionSummary();
      modelRenderer.renderModelCatalog();
      setAiFeedback(`Selected ${modelInput?.value || config.defaultModel} using ${choice.source}. Save model settings to apply it.`, 'success');
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
      const savedFastModel = getCurrentSettings()[provider.fastModelKey];
      populateFastModelOptions('gemini', providerCatalog.getModels('gemini'), fastBinaryModelSelect?.value ?? savedFastModel);
    }
  }

  return {
    captureCurrentDraft: refreshSelectionSummary,
    currentBackupSelection: backupModelUi.currentBackupSelection,
    getFormValues,
    getModels: providerCatalog.getModels,
    isFreeOpenRouterModel,
    loadProviderFields,
    loadGeminiSpeedMeasurements,
    isProviderFieldsLoading: () => providerFieldsLoading,
    setProviderFieldsLoading,
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
