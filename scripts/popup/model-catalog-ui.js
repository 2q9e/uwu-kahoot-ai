import { normalizeBackupModels, normalizeReasoningEffort } from '../core/model-routing.js';
import { createProviderQuotaUi } from './provider-quota-ui.js';
import { createBackupModelUi } from './backup-model-ui.js';
import { createModelCatalogRenderer } from './model-catalog-renderer.js';
import { createProviderFieldsLoader } from './provider-fields-loader.js';
import { CATALOG_STORAGE_PREFIX, createProviderModelCatalog } from './provider-model-catalog.js';
import { getFastModelOptions } from './fast-model-selection.js';
import { createModelCatalogControls } from './model-catalog-controls.js';

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
  const visionModelPicker = document.getElementById('visionModelPicker');
  const refreshVisionModelsButton = document.getElementById('refreshVisionModels');
  const visionPickerHelp = document.getElementById('visionPickerHelp');
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
  const CUSTOM_VISION_MODEL = '__custom_vision_model__';
  const providerFormPanels = ['apiKeysPanel', 'modelSettingsPanel', 'fastBinaryPanel', 'backupModelsPanel', 'modelCatalogPanel']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  let providerFieldsLoading = false;
  let modelSettingsDirty = false;

  function updateModelSaveControls() {
    if (saveSettingsButton) saveSettingsButton.disabled = providerFieldsLoading || !modelSettingsDirty;
    const saveLink = document.getElementById('apiSaveNavLink');
    if (saveLink) {
      saveLink.classList.toggle('unsaved', modelSettingsDirty);
      saveLink.setAttribute('aria-label', modelSettingsDirty
        ? 'Go to save section; model settings have unsaved changes'
        : 'Go to save section; model settings are saved');
    }
  }

  function setProviderFieldsLoading(loading) {
    providerFieldsLoading = Boolean(loading);
    for (const panel of providerFormPanels) {
      if (panel.matches('details.api-advanced-panel')) {
        panel.inert = false;
        for (const child of panel.children) {
          if (child.tagName !== 'SUMMARY') child.inert = providerFieldsLoading;
        }
      } else {
        panel.inert = providerFieldsLoading;
      }
      if (providerFieldsLoading) panel.setAttribute('aria-busy', 'true');
      else panel.removeAttribute('aria-busy');
    }
    if (providerSelect) providerSelect.disabled = providerFieldsLoading;
    updateModelSaveControls();
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
    updateVisionModelPicker(models);
  }

  function updateVisionModelPicker(models) {
    if (!visionModelPicker) return;
    const provider = getCurrentProvider();
    const config = providers[provider] || providers[defaultProvider];
    const current = String(visionInput?.value || '').trim() || config.defaultVision;
    const visionModels = models.filter(model => model?.id && model.supportsVision && model.supportsAnswers !== false);
    const currentModel = visionModels.find(model => model.id === current);
    const defaultModel = visionModels.find(model => model.id === config.defaultVision);
    const remainingModels = visionModels
      .filter(model => model.id !== current && model.id !== config.defaultVision)
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)) || a.id.localeCompare(b.id));
    const fragment = document.createDocumentFragment();
    const firstOption = document.createElement('option');
    firstOption.value = '';
    firstOption.textContent = visionModels.length ? 'Choose an image model…' : 'Find image models to browse';
    firstOption.disabled = true;
    fragment.append(firstOption);

    if (current && !currentModel) {
      const option = document.createElement('option');
      option.value = CUSTOM_VISION_MODEL;
      option.textContent = `Current model ID · ${current}`;
      fragment.append(option);
    }

    const choices = [
      ...(currentModel ? [{ ...currentModel, pickerPrefix: 'Current' }] : []),
      ...(defaultModel && defaultModel.id !== current ? [{ ...defaultModel, pickerPrefix: 'Provider default' }] : []),
      ...remainingModels
    ];
    for (const model of choices) {
      const option = document.createElement('option');
      option.value = model.id;
      const displayName = model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id;
      option.textContent = model.pickerPrefix ? `${model.pickerPrefix} · ${displayName}` : displayName;
      fragment.append(option);
    }
    visionModelPicker.replaceChildren(fragment);
    visionModelPicker.value = currentModel ? currentModel.id : current ? CUSTOM_VISION_MODEL : '';
    if (visionPickerHelp) {
      visionPickerHelp.textContent = visionModels.length
        ? `${visionModels.length} image-capable model${visionModels.length === 1 ? '' : 's'} found for ${provider}. Choosing one fills the model ID below.`
        : 'No image models are loaded yet. Find image models to load this provider’s catalog; you can also enter a model ID below.';
    }
  }

  function syncVisionModelPicker() {
    if (!visionModelPicker) return;
    const current = String(visionInput?.value || '').trim();
    const available = Array.from(visionModelPicker.options).some(option => option.value === current);
    if (available) {
      visionModelPicker.value = current;
      return;
    }
    const custom = Array.from(visionModelPicker.options).find(option => option.value === CUSTOM_VISION_MODEL);
    if (current && custom) {
      custom.textContent = `Current model ID · ${current}`;
      visionModelPicker.value = CUSTOM_VISION_MODEL;
      return;
    }
    updateVisionModelPicker(providerCatalog?.getModels(getCurrentProvider()) || []);
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
    syncVisionModelPicker();
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
    modelSettingsDirty = dirty;
    if (modelSelectionState) {
      modelSelectionState.textContent = dirty ? 'Unsaved changes' : 'Saved setup';
      modelSelectionState.classList.toggle('unsaved', dirty);
      modelSelectionState.classList.toggle('saved', !dirty);
    }
    updateModelSaveControls();
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

  refreshVisionModelsButton?.addEventListener('click', async () => {
    const provider = getCurrentProvider();
    const originalText = refreshVisionModelsButton.textContent;
    refreshVisionModelsButton.disabled = true;
    refreshVisionModelsButton.textContent = 'Loading…';
    if (visionPickerHelp) visionPickerHelp.textContent = `Checking ${provider} for image-capable models…`;
    try {
      await providerCatalog.refreshProviderCatalog(refreshVisionModelsButton);
      if (provider === getCurrentProvider()) {
        const models = providerCatalog.getModels(provider);
        if (!models.some(model => model.supportsVision && model.supportsAnswers !== false) && visionPickerHelp) {
          visionPickerHelp.textContent = models.length
            ? `No image-capable models were listed for ${provider}. You can enter a model ID below or try another provider.`
            : 'No models loaded. Check that a provider API key is saved, then try again. The model catalog has the full error details.';
        }
      }
    } catch (_) {
      if (provider === getCurrentProvider() && visionPickerHelp) {
        visionPickerHelp.textContent = 'Could not load image models. Check the model catalog status below and try again.';
      }
    } finally {
      refreshVisionModelsButton.disabled = false;
      refreshVisionModelsButton.textContent = originalText;
    }
  });
  visionModelPicker?.addEventListener('change', () => {
    const selectedModel = visionModelPicker.value;
    if (!selectedModel || selectedModel === CUSTOM_VISION_MODEL || !visionInput) return;
    visionInput.value = selectedModel;
    refreshSelectionSummary();
    modelRenderer.renderModelCatalog();
    const model = providerCatalog.getModels(getCurrentProvider()).find(item => item.id === selectedModel);
    setAiFeedback(`Selected ${model?.name || selectedModel} for image questions. Save model settings to apply it.`, '');
  });
  visionInput?.addEventListener('input', syncVisionModelPicker);

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

  const modelControls = createModelCatalogControls({
    elements: {
      refreshModelsBtn,
      modelSearchInput,
      modelCapabilityFilter,
      showMoreModelsBtn,
      modelInput,
      visionInput,
      reasoningSelect,
      fastBinaryCheckbox,
      fastBinaryModelSelect,
      backupModelSelects,
      useProviderDefaultsButton,
      useFastestModelButton
    },
    getCurrentProvider,
    providers,
    defaultProvider,
    providerCatalog,
    modelRenderer,
    backupModelUi,
    refreshSelectionSummary,
    setAiFeedback
  });

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
    isModelSettingsDirty: () => modelSettingsDirty,
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
    wireModelControls: modelControls.wireModelControls
  };
}
