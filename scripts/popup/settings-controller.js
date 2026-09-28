import {
  addProviderApiKey,
  getProviderConfigApiKeys,
  getProviderApiKeyEntries,
  migrateApiKeyToLocal
} from '../core/storage.js';
import { createApiKeyManager } from './api-key-manager-ui.js';
import { createModelCatalogUi } from './model-catalog-ui.js';
import { getApiStatusPresentation } from './api-status-presentation.js';
import { wirePreferenceControls } from './preference-controls.js';
import { DEFAULT_AI_PROVIDER, DEPRECATED_MODELS } from '../core/constants.js';
import { getOpenRouterDefaultMigration, getProviderModelSettingKeys, PROVIDER_SETTINGS } from '../ai/provider-config.js';

export function createPopupSettingsController() {
  const apiStatus = document.getElementById('apiStatus');
  const providerSaveStatus = document.getElementById('providerSaveStatus');
  const retrySettingsLoadBtn = document.getElementById('retrySettingsLoad');
  const highlightCb = document.getElementById('highlight');
  const autoclickCb = document.getElementById('autoclick');
  const pinHighlightCb = document.getElementById('pinHighlight');
  const pinAutoclickCb = document.getElementById('pinAutoclick');
  const silentCb = document.getElementById('silent');
  const fallbackCb = document.getElementById('aiFallback');
  const delaySlider = document.getElementById('answerDelay');
  const delayValue = document.getElementById('delayValue');
  const pluginEnabledCb = document.getElementById('pluginEnabled');
  const pluginEnabledLabel = document.getElementById('extensionEnabledLabel');
  const pluginEnabledStatus = document.getElementById('extensionEnabledStatus');
  const toggleAIConfig = document.getElementById('toggleAIConfig');
  const aiSection = document.getElementById('aiSection');
  const collapseArrow = document.getElementById('collapseArrow');
  const providerSelect = document.getElementById('aiProvider');
  const newApiKeyLabel = document.getElementById('newApiKeyLabel');
  const newApiKeySecret = document.getElementById('newApiKeySecret');
  const newApiKeyProviderLabel = document.getElementById('newApiKeyProviderLabel');
  const addApiKeyBtn = document.getElementById('addApiKey');
  const toggleNewApiKeyVisibility = document.getElementById('toggleNewApiKeyVisibility');
  const saveBtn = document.getElementById('saveApi');
  const aiFeedback = document.getElementById('aiFeedback');
  const MODEL_REASONING_STORAGE_KEY = 'modelReasoningEffort';

  function reportStorageFailure(stage = 'settings') {
    try { chrome.runtime.sendMessage({ action: 'recordDiagnostic', code: 'EXTENSION_STORAGE_ERROR', metadata: { stage } }).catch(() => {}); }
    catch (_) {}
  }

  const PROVIDER_KEY_LABELS = {
    openai: 'OpenAI API key',
    gemini: 'Google AI Studio API key',
    openrouter: 'OpenRouter API key'
  };
  const PROVIDERS = Object.fromEntries(Object.entries(PROVIDER_SETTINGS).map(([provider, settings]) => [provider, {
    ...settings,
    defaultModel: settings.model,
    defaultVision: settings.visionModel,
    keyLabel: PROVIDER_KEY_LABELS[provider]
  }]));

  let currentProvider = DEFAULT_AI_PROVIDER;
  let currentSettings = {};
  let apiSettingsState = 'loading';
  let providerChangeToken = 0;
  let pluginSettingRevision = 0;
  let latestPluginEnabled = true;
  let pluginStateLoaded = false;
  let pluginTogglePending = false;
  const latestPreferenceChanges = {};
  const providerKeyLoadErrors = new Set();

  const PREFERENCE_NORMALIZERS = {
    highlightOption: value => value !== false,
    autoClickOption: value => value !== false,
    pinHighlightOption: value => value !== false,
    pinAutoClickOption: value => !!value,
    silentMode: value => !!value,
    answerDelay: value => {
      const delay = Number(value ?? 0);
      return Number.isFinite(delay) ? Math.min(30, Math.max(0, delay)) : 0;
    },
    aiFallbackEnabled: value => value !== false
  };

  function applyPreferenceValue(key, value) {
    currentSettings[key] = value;
    const checkbox = {
      highlightOption: highlightCb,
      autoClickOption: autoclickCb,
      pinHighlightOption: pinHighlightCb,
      pinAutoClickOption: pinAutoclickCb,
      silentMode: silentCb,
      aiFallbackEnabled: fallbackCb
    }[key];
    if (checkbox) checkbox.checked = value;
    if (key === 'answerDelay') {
      if (delaySlider) delaySlider.value = value;
      updateDelayLabel(value);
    }
    if (key === 'aiFallbackEnabled') updateApiStatus();
  }

  function getCurrentPreferenceValues(settings) {
    return Object.fromEntries(Object.entries(PREFERENCE_NORMALIZERS).map(([key, normalize]) => [
      key,
      Object.hasOwn(latestPreferenceChanges, key)
        ? latestPreferenceChanges[key]
        : normalize(settings[key])
    ]));
  }

  function setProviderKeyLoadStatus(provider, loaded) {
    if (loaded) providerKeyLoadErrors.delete(provider);
    else providerKeyLoadErrors.add(provider);
    if (provider === currentProvider) updateApiStatus();
  }

  const apiKeyManager = createApiKeyManager({
    getCurrentProvider: () => currentProvider,
    getCurrentSettings: () => currentSettings,
    setAiFeedback,
    updateApiStatus,
    onProviderKeysLoaded: provider => setProviderKeyLoadStatus(provider, true),
    onProviderKeysLoadFailed: provider => setProviderKeyLoadStatus(provider, false)
  });
  const modelCatalog = createModelCatalogUi({
    getCurrentProvider: () => currentProvider,
    getCurrentSettings: () => currentSettings,
    providers: PROVIDERS,
    defaultProvider: DEFAULT_AI_PROVIDER,
    deprecatedModels: DEPRECATED_MODELS,
    setAiFeedback,
    persistSync,
    renderApiKeyManager: (provider, records) => apiKeyManager.render(provider, records),
    setProviderKeyLoadStatus
  });

  function updateApiStatus() {
    if (!apiStatus) return;
    const presentation = getApiStatusPresentation({
      state: apiSettingsState,
      currentProvider,
      currentSettings,
      providers: PROVIDERS,
      providerKeyLoadError: providerKeyLoadErrors.has(currentProvider)
    });
    apiStatus.textContent = presentation.text;
    apiStatus.className = presentation.className;
    apiStatus.title = presentation.title;
    apiStatus.setAttribute('aria-busy', presentation.ariaBusy);
  }

  function updateDelayLabel(value) {
    if (delayValue) delayValue.textContent = value > 0 ? `${value}s` : 'Off';
  }

  function renderPluginEnabled(enabled) {
    const isEnabled = enabled !== false;
    latestPluginEnabled = isEnabled;
    if (pluginEnabledCb) {
      pluginEnabledCb.checked = isEnabled;
      pluginStateLoaded = true;
      pluginEnabledCb.disabled = pluginTogglePending;
    }
    if (pluginEnabledLabel) pluginEnabledLabel.textContent = isEnabled ? 'Enabled' : 'Paused';
    if (pluginEnabledStatus) {
      pluginEnabledStatus.textContent = isEnabled
        ? 'Quiz detection, AI requests, and answer actions are on.'
        : 'Quiz detection, AI requests, and answer actions are paused.';
    }
    document.body.dataset.pluginEnabled = String(isEnabled);
  }

  function updateNewApiKeyProviderLabel() {
    if (newApiKeyProviderLabel) newApiKeyProviderLabel.textContent = PROVIDER_KEY_LABELS[currentProvider] || 'Provider API key';
  }

  function setProviderSaveStatus(message, state = '') {
    if (!providerSaveStatus) return;
    providerSaveStatus.textContent = message;
    providerSaveStatus.className = `api-inline-save-status ${state}`;
  }


  async function loadSettings() {
    const pluginRevisionAtRead = pluginSettingRevision;
    const settings = await chrome.storage.sync.get([
      'highlightOption', 'autoClickOption', 'pinHighlightOption', 'pinAutoClickOption',
      'silentMode', 'answerDelay', 'pluginEnabled', 'aiProvider', MODEL_REASONING_STORAGE_KEY,
      'aiFallbackEnabled', ...getProviderModelSettingKeys(),
      'fastBinaryAnswersEnabled'
    ]);
    const pluginEnabled = pluginRevisionAtRead === pluginSettingRevision
      ? settings.pluginEnabled !== false
      : latestPluginEnabled;
    currentSettings = { ...currentSettings, pluginEnabled };
    renderPluginEnabled(pluginEnabled);
    const migratedModels = getOpenRouterDefaultMigration(settings);
    if (Object.keys(migratedModels).length) {
      await chrome.storage.sync.set(migratedModels);
      Object.assign(settings, migratedModels);
    }
    await migrateApiKeyToLocal();
    const managedEntries = await Promise.all(Object.keys(PROVIDERS).map(async provider =>
      [provider, await getProviderApiKeyEntries(provider)]
    ));
    const privateEntries = await Promise.all(Object.keys(PROVIDERS).map(async provider =>
      [provider, await getProviderConfigApiKeys(provider)]
    ));
    const preferenceValues = getCurrentPreferenceValues(settings);
    currentSettings = {
      ...settings,
      ...preferenceValues,
      pluginEnabled: pluginRevisionAtRead === pluginSettingRevision
        ? settings.pluginEnabled !== false
        : latestPluginEnabled,
      privateApiKeys: Object.fromEntries(privateEntries),
      managedApiKeys: Object.fromEntries(managedEntries)
    };
    renderPluginEnabled(currentSettings.pluginEnabled);
    apiSettingsState = 'ready';

    for (const [key, value] of Object.entries(preferenceValues)) applyPreferenceValue(key, value);

    const storedProvider = settings.aiProvider;
    currentProvider = PROVIDERS[storedProvider] ? storedProvider : DEFAULT_AI_PROVIDER;
    if (providerSelect) providerSelect.value = currentProvider;
    updateNewApiKeyProviderLabel();
    modelCatalog.setReasoningEffort(settings[MODEL_REASONING_STORAGE_KEY]);
    return loadProviderFields(currentProvider);
  }

  function loadProviderFields(provider) {
    return modelCatalog.loadProviderFields(provider);
  }

  function handleSettingsLoadFailure() {
    reportStorageFailure('settings');
    apiSettingsState = 'unavailable';
    updateApiStatus();
    modelCatalog.setProviderFieldsLoading(false);
    retrySettingsLoadBtn?.classList.remove('hidden');
    setAiFeedback('Provider settings could not be loaded. Check extension storage, then retry.', 'error');
  }

  function setAiFeedback(message, state = '') {
    if (!aiFeedback) return;
    aiFeedback.textContent = message;
    aiFeedback.className = `settings-feedback ${state}`;
  }

  function persistSync(values) {
    return chrome.storage.sync.set(values).then(() => true).catch(() => {
      reportStorageFailure('settings');
      setAiFeedback('Could not save settings. Check extension storage and try again.', 'error');
      return false;
    });
  }

  async function loadSettingsWithRecovery() {
    try {
      const hasKey = await loadSettings();
      retrySettingsLoadBtn?.classList.add('hidden');
      return hasKey;
    } catch (_) {
      handleSettingsLoadFailure();
      return false;
    }
  }

  function wireSettings() {
    pluginEnabledCb?.addEventListener('change', async () => {
      const previousValue = currentSettings.pluginEnabled !== false;
      const nextValue = pluginEnabledCb.checked;
      const changeRevision = ++pluginSettingRevision;
      latestPluginEnabled = nextValue;
      pluginTogglePending = true;
      pluginEnabledCb.disabled = true;
      if (pluginEnabledStatus) pluginEnabledStatus.textContent = 'Saving extension state…';
      try {
        await chrome.storage.sync.set({ pluginEnabled: nextValue });
        currentSettings.pluginEnabled = nextValue;
        renderPluginEnabled(nextValue);
      } catch (_) {
        if (pluginSettingRevision === changeRevision) {
          renderPluginEnabled(previousValue);
          if (pluginEnabledStatus) pluginEnabledStatus.textContent = 'Could not save this change. Check extension storage and try again.';
        }
      } finally {
        pluginTogglePending = false;
        pluginEnabledCb.disabled = !pluginStateLoaded;
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (Object.hasOwn(changes, 'pluginEnabled')) {
        pluginSettingRevision += 1;
        currentSettings.pluginEnabled = changes.pluginEnabled.newValue !== false;
        renderPluginEnabled(currentSettings.pluginEnabled);
      }
      for (const [key, normalize] of Object.entries(PREFERENCE_NORMALIZERS)) {
        if (!Object.hasOwn(changes, key)) continue;
        const value = normalize(changes[key].newValue);
        latestPreferenceChanges[key] = value;
        applyPreferenceValue(key, value);
      }
    });

    wirePreferenceControls({
      checkboxPreferences: [
        [highlightCb, 'highlightOption'],
        [autoclickCb, 'autoClickOption'],
        [pinHighlightCb, 'pinHighlightOption'],
        [pinAutoclickCb, 'pinAutoClickOption'],
        [silentCb, 'silentMode']
      ],
      fallbackCheckbox: fallbackCb,
      delaySlider,
      persistSync,
      updateDelayLabel,
      getSavedPreferenceValue: key => PREFERENCE_NORMALIZERS[key](currentSettings[key]),
      getSavedFallbackValue: () => currentSettings.aiFallbackEnabled,
      onFallbackSaveFailed: () => setProviderSaveStatus('Fallback preference was not saved.', 'error'),
      onFallbackSaved: nextValue => {
        currentSettings.aiFallbackEnabled = nextValue;
        updateApiStatus();
        setProviderSaveStatus('Fallback preference saved immediately.', 'success');
      }
    });

    retrySettingsLoadBtn?.addEventListener('click', async () => {
      retrySettingsLoadBtn.disabled = true;
      retrySettingsLoadBtn.textContent = 'Retrying…';
      apiSettingsState = 'loading';
      updateApiStatus();
      modelCatalog.setProviderFieldsLoading(true);
      setAiFeedback('Retrying provider settings…');
      try {
        await loadSettings();
        retrySettingsLoadBtn.classList.add('hidden');
        if (!providerKeyLoadErrors.has(currentProvider)) setAiFeedback('Settings loaded.', 'success');
      } catch (_) {
        handleSettingsLoadFailure();
      } finally {
        retrySettingsLoadBtn.disabled = false;
        retrySettingsLoadBtn.textContent = 'Retry settings';
      }
    });

    providerSelect?.addEventListener('change', async () => {
      const nextProvider = providerSelect.value;
      if (!PROVIDERS[nextProvider]) {
        providerSelect.value = currentProvider;
        return;
      }
      const hasKeyDraft = Boolean(newApiKeySecret?.value.trim() || newApiKeyLabel?.value.trim());
      if (nextProvider !== currentProvider && hasKeyDraft) {
        providerSelect.value = currentProvider;
        setAiFeedback('Finish this key draft or clear both fields before switching providers.', 'error');
        (newApiKeySecret?.value.trim() ? newApiKeySecret : newApiKeyLabel)?.focus();
        return;
      }
      const changeToken = ++providerChangeToken;
      const previousProvider = currentProvider;
      modelCatalog.captureCurrentDraft();
      currentProvider = nextProvider;
      updateNewApiKeyProviderLabel();
      modelCatalog.setProviderFieldsLoading(true);
      modelCatalog.resetVisibleModelLimit();
      if (newApiKeySecret) newApiKeySecret.type = 'password';
      if (toggleNewApiKeyVisibility) {
        toggleNewApiKeyVisibility.textContent = 'Show';
        toggleNewApiKeyVisibility.setAttribute('aria-pressed', 'false');
      }
      setAiFeedback('');
      try {
        if (!await persistSync({ aiProvider: nextProvider })) {
          if (changeToken === providerChangeToken) {
            currentProvider = previousProvider;
            providerSelect.value = previousProvider;
            updateNewApiKeyProviderLabel();
            setProviderSaveStatus('Provider preference was not saved.', 'error');
          }
          return;
        }
        if (changeToken !== providerChangeToken) return;
        currentSettings.aiProvider = nextProvider;
        setProviderSaveStatus('Provider preference saved immediately.', 'success');
        await loadProviderFields(nextProvider);
      } finally {
        if (changeToken === providerChangeToken) modelCatalog.setProviderFieldsLoading(false);
      }
    });

    toggleAIConfig?.addEventListener('click', () => {
      const isHidden = aiSection.classList.toggle('hidden');
      collapseArrow.textContent = isHidden ? '＋' : '−';
      toggleAIConfig.setAttribute('aria-expanded', String(!isHidden));
    });

    toggleNewApiKeyVisibility?.addEventListener('click', () => {
      const visible = newApiKeySecret?.type === 'password';
      if (newApiKeySecret) newApiKeySecret.type = visible ? 'text' : 'password';
      toggleNewApiKeyVisibility.textContent = visible ? 'Hide' : 'Show';
      toggleNewApiKeyVisibility.setAttribute('aria-pressed', String(visible));
    });

    addApiKeyBtn?.addEventListener('click', async () => {
      const secret = newApiKeySecret?.value.trim() || '';
      if (!secret) {
        setAiFeedback('Paste a provider API key first.', 'error');
        return;
      }
      addApiKeyBtn.disabled = true;
      setAiFeedback('Adding key to local extension storage…');
      try {
        try {
          await addProviderApiKey(currentProvider, {
            label: newApiKeyLabel?.value.trim() || `Key ${(currentSettings.managedApiKeys?.[currentProvider] || []).length + 1}`,
            secret
          });
        } catch (error) {
          if (/storage|operation failed|context invalidated/i.test(String(error?.message || ''))) reportStorageFailure('settings');
          setAiFeedback(error.message || 'Could not add this key.', 'error');
          return;
        }

        if (newApiKeySecret) newApiKeySecret.value = '';
        if (newApiKeyLabel) newApiKeyLabel.value = '';
        if (newApiKeySecret) newApiKeySecret.type = 'password';
        if (toggleNewApiKeyVisibility) {
          toggleNewApiKeyVisibility.textContent = 'Show';
          toggleNewApiKeyVisibility.setAttribute('aria-pressed', 'false');
        }
        setAiFeedback('Key added. Test it to check provider access.', 'success');
        setProviderSaveStatus('API key saved immediately.', 'success');
        try {
          await apiKeyManager.render(currentProvider);
        } catch (error) {
          if (/storage|operation failed|context invalidated/i.test(String(error?.message || ''))) reportStorageFailure('settings');
          const detail = error?.message ? ' ' + error.message : '';
          setAiFeedback('Key added and saved. The key list could not be refreshed. Reopen API settings to reload it.' + detail, 'error');
        }
      } finally {
        addApiKeyBtn.disabled = false;
      }
    });

    saveBtn?.addEventListener('click', async () => {
      const config = PROVIDERS[currentProvider] || PROVIDERS[DEFAULT_AI_PROVIDER];
      const { model, visionModel, fastModel, fastBinaryAnswersEnabled, backupModels, reasoningEffort } = modelCatalog.getFormValues();
      modelCatalog.populateBackupSlots(modelCatalog.getModels(currentProvider), backupModels, model);
      if (currentProvider === 'openrouter') {
        if (!modelCatalog.isFreeOpenRouterModel(model) || !modelCatalog.isFreeOpenRouterModel(visionModel) ||
            (fastModel && !modelCatalog.isFreeOpenRouterModel(fastModel)) || backupModels.some(id => !modelCatalog.isFreeOpenRouterModel(id))) {
          setAiFeedback('Refresh the OpenRouter catalog and choose only listed free models before saving.', 'error');
          return;
        }
      }
      let saveSucceeded = false;
      saveBtn.disabled = true;
      if (providerSelect) providerSelect.disabled = true;
      setAiFeedback('Saving model settings…');
      try {
        await chrome.storage.sync.set({
          aiProvider: currentProvider,
          [config.modelKey]: model,
          [config.visionKey]: visionModel,
          [config.fastModelKey]: fastModel,
          [config.backupKey]: backupModels,
          [MODEL_REASONING_STORAGE_KEY]: reasoningEffort,
          fastBinaryAnswersEnabled
        });
        currentSettings = {
          ...currentSettings,
          aiProvider: currentProvider,
          [config.modelKey]: model,
          [config.visionKey]: visionModel,
          [config.fastModelKey]: fastModel,
          [config.backupKey]: backupModels,
          [MODEL_REASONING_STORAGE_KEY]: reasoningEffort,
          fastBinaryAnswersEnabled
        };
        modelCatalog.refreshSelectionSummary();
        updateApiStatus();
        setAiFeedback('Model settings saved.', 'success');
        saveSucceeded = true;
      } catch (_) {
        reportStorageFailure('settings');
        setAiFeedback('Could not save model settings. Check extension storage and try again.', 'error');
      } finally {
        if (!modelCatalog.isProviderFieldsLoading()) {
          modelCatalog.refreshSelectionSummary();
          saveBtn.disabled = !modelCatalog.isModelSettingsDirty();
          if (providerSelect) providerSelect.disabled = false;
        }
      }
      if (saveSucceeded && saveBtn) {
        const orig = saveBtn.textContent;
        saveBtn.textContent = 'Saved!';
        saveBtn.classList.add('saved');
        setTimeout(() => { saveBtn.textContent = orig; saveBtn.classList.remove('saved'); }, 1200);
      }
    });

  }

  return {
    loadSettingsWithRecovery,
    wireSettings,
    async initializeModelCatalog() {
      modelCatalog.wireModelControls();
      await modelCatalog.loadGeminiSpeedMeasurements();
      modelCatalog.renderModelCatalog();
    },
    expandAdvancedSettings() {
      aiSection?.classList.remove('hidden');
      if (collapseArrow) collapseArrow.textContent = '−';
      toggleAIConfig?.setAttribute('aria-expanded', 'true');
    }
  };
}
