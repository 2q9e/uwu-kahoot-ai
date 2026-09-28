
import {
  addProviderApiKey,
  getProviderConfigApiKeys,
  getProviderApiKeyEntries,
  migrateApiKeyToLocal
} from '../core/storage.js';
import { initializeLiveSession, setLiveStatus } from './live-session.js';
import { initializePopupStats } from './stats-summary.js';
import { createApiKeyManager } from './api-key-manager-ui.js';
import { createModelCatalogUi } from './model-catalog-ui.js';
import { DEFAULT_AI_PROVIDER, DEPRECATED_MODELS } from '../core/constants.js';
import { PREVIOUS_OPENROUTER_DEFAULT, PROVIDER_SETTINGS } from '../ai/provider-config.js';

const versionLabel    = document.getElementById('versionLabel');
const apiStatus       = document.getElementById('apiStatus');
const openStatsBtn = document.getElementById('openStats');
const openStatsCardBtn = document.getElementById('openStatsCard');
const openApiDashboardBtn = document.getElementById('openApiDashboard');
const apiPageIntro = document.getElementById('apiPageIntro');
const highlightCb     = document.getElementById('highlight');
const autoclickCb     = document.getElementById('autoclick');
const pinHighlightCb  = document.getElementById('pinHighlight');
const pinAutoclickCb  = document.getElementById('pinAutoclick');
const silentCb        = document.getElementById('silent');
const fallbackCb      = document.getElementById('aiFallback');
const delaySlider     = document.getElementById('answerDelay');
const delayValue      = document.getElementById('delayValue');
const toggleAIConfig  = document.getElementById('toggleAIConfig');
const aiSection       = document.getElementById('aiSection');
const collapseArrow   = document.getElementById('collapseArrow');
const providerSelect  = document.getElementById('aiProvider');
const newApiKeyLabel = document.getElementById('newApiKeyLabel');
const newApiKeySecret = document.getElementById('newApiKeySecret');
const addApiKeyBtn = document.getElementById('addApiKey');
const toggleNewApiKeyVisibility = document.getElementById('toggleNewApiKeyVisibility');
const saveBtn         = document.getElementById('saveApi');
const aiFeedback      = document.getElementById('aiFeedback');
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
const isApiPage = new URLSearchParams(location.search).get('api') === '1';

let currentProvider = DEFAULT_AI_PROVIDER;
let currentSettings = {};
let apiSettingsState = 'loading';
let providerChangeToken = 0;
const providerKeyLoadErrors = new Set();

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
  renderApiKeyManager: provider => apiKeyManager.render(provider),
  setProviderKeyLoadStatus
});
const isDashboardFrame = new URLSearchParams(location.search).get('dashboard') === '1';

if (isApiPage) {
  document.documentElement.classList.add('api-page-html');
  document.body.classList.add('api-page');
  document.title = 'UwU Kahoot AI · Provider settings';
  apiPageIntro?.classList.remove('hidden');
  if (versionLabel) versionLabel.textContent = 'Provider settings';
}

if (isDashboardFrame) {
  document.documentElement.classList.add('dashboard-html');
  document.body.classList.add('dashboard-embedded');
  const reportDashboardHeight = () => {
    const height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    window.parent.postMessage({ source: 'uwukahootai-dashboard-frame', height }, location.origin);
  };
  const resizeObserver = new ResizeObserver(() => requestAnimationFrame(reportDashboardHeight));
  resizeObserver.observe(document.documentElement);
  window.addEventListener('load', reportDashboardHeight, { once: true });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.source !== 'uwukahootai-dashboard-mode') return;
    document.body.dataset.dashboardMode = event.data.mode === 'classic' ? 'classic' : '3d';
    requestAnimationFrame(reportDashboardHeight);
  });
}


async function openStatsPage(button) {
  if (button) button.disabled = true;
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('pages/stats.html') });
    if (button === openStatsBtn) window.close();
  } catch (_) {
    if (button) button.disabled = false;
    setLiveStatus('error', 'Could not open stats', 'Try opening the extension popup again.');
  }
}
openStatsBtn?.addEventListener('click', () => openStatsPage(openStatsBtn));
openStatsCardBtn?.addEventListener('click', () => openStatsPage(openStatsCardBtn));

openApiDashboardBtn?.addEventListener('click', async () => {
  openApiDashboardBtn.disabled = true;
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('pages/popup.html?api=1') });
    window.close();
  } catch (_) {
    openApiDashboardBtn.disabled = false;
    setLiveStatus('error', 'Could not open API settings', 'Try opening the extension popup again.');
  }
});


function updateApiStatus() {
  if (!apiStatus) return;
  if (apiSettingsState !== 'ready') {
    const unavailable = apiSettingsState === 'unavailable';
    apiStatus.textContent = unavailable ? 'Settings unavailable' : 'Checking keys…';
    apiStatus.className = `api-pill ${unavailable ? 'missing' : 'checking'}`;
    apiStatus.title = unavailable ? 'Extension storage could not be read. Reopen the extension and try again.' : 'Checking the configured provider keys.';
    apiStatus.setAttribute('aria-busy', String(!unavailable));
    return;
  }
  apiStatus.setAttribute('aria-busy', 'false');
  if (providerKeyLoadErrors.has(currentProvider)) {
    apiStatus.textContent = 'Key status unknown';
    apiStatus.className = 'api-pill checking';
    apiStatus.title = 'Saved keys for this provider could not be loaded. Check the key list message and try again.';
    return;
  }
  const privateKeys = currentSettings.privateApiKeys || {};
  const managedKeys = currentSettings.managedApiKeys || {};
  const hasSavedPreferredKey = (managedKeys[currentProvider] || []).some(key => key.enabled);
  const hasPrivatePreferredKey = !!privateKeys[currentProvider]?.length;
  const fallbackKeyCount = Object.keys(PROVIDERS).reduce((total, provider) => provider === currentProvider
    ? total
    : total + (managedKeys[provider] || []).filter(key => key.enabled).length + (privateKeys[provider]?.length || 0), 0);
  const hasFallbackKey = fallbackKeyCount > 0;
  const fallbackEnabled = currentSettings.aiFallbackEnabled !== false;

  if (hasSavedPreferredKey) {
    const activeCount = (managedKeys[currentProvider] || []).filter(key => key.enabled).length;
    const primaryKey = (managedKeys[currentProvider] || []).find(key => key.enabled);
    const lastTest = primaryKey?.lastTest;
    apiStatus.textContent = lastTest ? (lastTest.ok ? 'Key test passed' : 'Key test failed') : 'Key not tested';
    apiStatus.className = `api-pill ${lastTest ? (lastTest.ok ? 'ok' : 'missing') : 'checking'}`;
    apiStatus.title = `${activeCount} managed key${activeCount === 1 ? '' : 's'} enabled for the preferred provider. The first enabled key is tried first. ${lastTest ? `The first key was last checked ${new Date(lastTest.at).toLocaleString()}: ${lastTest.message}` : 'Run Test key to check provider access.'}`;
  } else if (hasPrivatePreferredKey) {
    apiStatus.textContent = 'Local key · not tested';
    apiStatus.className = 'api-pill local';
    apiStatus.title = 'A key is configured in the local-only source file and has not been verified.';
  } else if (fallbackEnabled && hasFallbackKey) {
    apiStatus.textContent = 'Fallback configured';
    apiStatus.className = 'api-pill fallback';
    apiStatus.title = `No key is enabled for the selected provider; ${fallbackKeyCount} enabled key${fallbackKeyCount === 1 ? '' : 's'} for another provider can be tried as fallback.`;
  } else {
    apiStatus.textContent = 'No active key';
    apiStatus.className = 'api-pill missing';
    apiStatus.title = 'No enabled key can currently be used. Add a key for the selected provider or enable a configured fallback.';
  }
}

function updateDelayLabel(value) {
  if (delayValue) delayValue.textContent = value > 0 ? `${value}s` : 'Off';
}


async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'highlightOption', 'autoClickOption', 'pinHighlightOption', 'pinAutoClickOption',
    'silentMode', 'answerDelay', 'aiProvider', MODEL_REASONING_STORAGE_KEY,
    'aiFallbackEnabled',
    'openaiModel', 'openaiVisionModel',
    'openaiBackupModels',
    'openaiFastModel',
    'geminiModel', 'geminiVisionModel',
    'geminiBackupModels', 'geminiFastModel',
    'openrouterModel', 'openrouterVisionModel', 'openrouterBackupModels', 'openrouterFastModel',
    'fastBinaryAnswersEnabled'
  ]);
  const migratedModels = {};
  if (settings.openrouterModel === PREVIOUS_OPENROUTER_DEFAULT) migratedModels.openrouterModel = PROVIDERS.openrouter.defaultModel;
  if (settings.openrouterVisionModel === PREVIOUS_OPENROUTER_DEFAULT) migratedModels.openrouterVisionModel = PROVIDERS.openrouter.defaultVision;
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
  currentSettings = {
    ...settings,
    privateApiKeys: Object.fromEntries(privateEntries),
    managedApiKeys: Object.fromEntries(managedEntries)
  };
  apiSettingsState = 'ready';

  if (highlightCb) highlightCb.checked = settings.highlightOption !== false;
  if (autoclickCb) autoclickCb.checked = settings.autoClickOption !== false;
  if (pinHighlightCb) pinHighlightCb.checked = settings.pinHighlightOption !== false;
  if (pinAutoclickCb) pinAutoclickCb.checked = !!settings.pinAutoClickOption;
  if (silentCb) silentCb.checked = !!settings.silentMode;
  if (fallbackCb) fallbackCb.checked = settings.aiFallbackEnabled !== false;

  const storedDelay = Number(settings.answerDelay ?? 0);
  const delay = Number.isFinite(storedDelay) ? Math.min(30, Math.max(0, storedDelay)) : 0;
  if (delaySlider) delaySlider.value = delay;
  updateDelayLabel(delay);

  const storedProvider = settings.aiProvider;
  currentProvider = PROVIDERS[storedProvider] ? storedProvider : DEFAULT_AI_PROVIDER;
  if (providerSelect) providerSelect.value = currentProvider;
  modelCatalog.setReasoningEffort(settings[MODEL_REASONING_STORAGE_KEY]);
  return loadProviderFields(currentProvider);
}

function loadProviderFields(provider) {
  return modelCatalog.loadProviderFields(provider);
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

function wireSettings() {
  const persistCheckbox = (input, key) => input?.addEventListener('change', async () => {
    const nextValue = input.checked;
    if (!await persistSync({ [key]: nextValue })) input.checked = !nextValue;
  });
  persistCheckbox(highlightCb, 'highlightOption');
  persistCheckbox(autoclickCb, 'autoClickOption');
  persistCheckbox(pinHighlightCb, 'pinHighlightOption');
  persistCheckbox(pinAutoclickCb, 'pinAutoClickOption');
  persistCheckbox(silentCb, 'silentMode');
  fallbackCb?.addEventListener('change', async () => {
    const nextValue = fallbackCb.checked;
    if (!await persistSync({ aiFallbackEnabled: nextValue })) {
      fallbackCb.checked = currentSettings.aiFallbackEnabled !== false;
      return;
    }
    currentSettings.aiFallbackEnabled = nextValue;
    updateApiStatus();
  });

  let delayDebounce = null;
  delaySlider?.addEventListener('input', () => {
    const v = parseFloat(delaySlider.value);
    updateDelayLabel(v);
    clearTimeout(delayDebounce);
    delayDebounce = setTimeout(() => persistSync({ answerDelay: v }), 250);
  });

  providerSelect?.addEventListener('change', async () => {
    const changeToken = ++providerChangeToken;
    const nextProvider = providerSelect.value;
    if (!PROVIDERS[nextProvider]) return;
    const previousProvider = currentProvider;
    modelCatalog.captureCurrentDraft();
    currentProvider = nextProvider;
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
        }
        return;
      }
      if (changeToken !== providerChangeToken) return;
      currentSettings.aiProvider = nextProvider;
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
      await addProviderApiKey(currentProvider, {
        label: newApiKeyLabel?.value.trim() || `Key ${(currentSettings.managedApiKeys?.[currentProvider] || []).length + 1}`,
        secret
      });
      if (newApiKeySecret) newApiKeySecret.value = '';
      if (newApiKeyLabel) newApiKeyLabel.value = '';
      if (newApiKeySecret) newApiKeySecret.type = 'password';
      if (toggleNewApiKeyVisibility) {
        toggleNewApiKeyVisibility.textContent = 'Show';
        toggleNewApiKeyVisibility.setAttribute('aria-pressed', 'false');
      }
      setAiFeedback('Key added. Test it to check provider access.', 'success');
      await apiKeyManager.render(currentProvider);
    } catch (error) {
      if (/storage|operation failed|context invalidated/i.test(String(error?.message || ''))) reportStorageFailure('settings');
      setAiFeedback(error.message || 'Could not add this key.', 'error');
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
    setAiFeedback('Saving provider settings…');
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
      setAiFeedback('Provider model settings saved.', 'success');
      saveSucceeded = true;
    } catch (_) {
      reportStorageFailure('settings');
      setAiFeedback('Could not save. Check extension storage and try again.', 'error');
    } finally {
      if (!modelCatalog.isProviderFieldsLoading()) {
        saveBtn.disabled = false;
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


(async function init() {
  if (versionLabel) versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
  if (isApiPage) {
    if (versionLabel) versionLabel.textContent = 'Provider settings';
  } else {
    initializePopupStats();
    await initializeLiveSession();
  }
  let hasKey = false;
  try {
    hasKey = await loadSettings();
  } catch (_) {
    reportStorageFailure('settings');
    apiSettingsState = 'unavailable';
    updateApiStatus();
    setAiFeedback('Provider settings could not be loaded. Reopen the extension and try again.', 'error');
  }
  wireSettings();
  modelCatalog.wireModelControls();
  await modelCatalog.loadGeminiSpeedMeasurements();
  modelCatalog.renderModelCatalog();
  if (isApiPage || !hasKey) {
    aiSection?.classList.remove('hidden');
    if (collapseArrow) collapseArrow.textContent = '−';
    toggleAIConfig?.setAttribute('aria-expanded', 'true');
  }
})();
