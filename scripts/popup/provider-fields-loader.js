import { getProviderApiKeyEntries } from '../core/storage.js';
import { normalizeBackupModels, normalizeReasoningEffort } from '../core/model-routing.js';

const MODEL_REASONING_STORAGE_KEY = 'modelReasoningEffort';

export function createProviderFieldsLoader(dependencies) {
  const {
    getCurrentProvider,
    getCurrentSettings,
    providers,
    defaultProvider,
    deprecatedModels,
    providerModelDrafts,
    getSharedModelDraft,
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
  } = dependencies;
  let providerLoadToken = 0;

  async function loadProviderFields(provider) {
    const loadToken = ++providerLoadToken;
    const isCurrentLoad = () => loadToken === providerLoadToken && provider === getCurrentProvider();
    setProviderFieldsLoading(true);
    try {
      const config = providers[provider] || providers[defaultProvider];
      const settings = getCurrentSettings();
      const draft = providerModelDrafts.get(provider);
      const sharedDraft = getSharedModelDraft();
      if (modelSearchInput) modelSearchInput.value = '';
      setCatalogStatus('Loading saved model catalog…', 'loading');
      providerQuotaUi.setLoading();
      clearProviderKeyList('Loading keys for this provider…');
      if (fastBinaryCheckbox) fastBinaryCheckbox.checked = sharedDraft?.fastBinaryAnswersEnabled ?? settings.fastBinaryAnswersEnabled !== false;
      if (reasoningSelect) reasoningSelect.value = sharedDraft?.reasoningEffort ?? normalizeReasoningEffort(settings[MODEL_REASONING_STORAGE_KEY]);
      if (modelInput) {
        let model = String(draft?.model ?? settings[config.modelKey] ?? config.defaultModel).trim();
        if (provider === 'openai' && deprecatedModels.has(model.toLowerCase())) model = config.defaultModel;
        modelInput.value = model;
        modelInput.readOnly = provider === 'openrouter';
      }
      if (visionInput) {
        let visionModel = String(draft?.visionModel ?? settings[config.visionKey] ?? config.defaultVision).trim();
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

      const primaryModel = modelInput?.value || config.defaultModel;
      const backups = draft?.backupModels ?? normalizeBackupModels(settings[config.backupKey], primaryModel);
      backupModelUi.populateBackupSlots(providerCatalog.getModels(provider), backups, primaryModel);
      populateFastModelOptions(provider, providerCatalog.getModels(provider), draft?.fastModel ?? settings[config.fastModelKey]);

      let entries;
      try {
        entries = await getProviderApiKeyEntries(provider);
        if (!isCurrentLoad()) return false;
        settings.managedApiKeys = { ...(settings.managedApiKeys || {}), [provider]: entries };
        await renderApiKeyManager(provider);
        if (!isCurrentLoad()) return false;
      } catch (_) {
        if (!isCurrentLoad()) return false;
        clearProviderKeyList('Could not load keys for this provider.');
        setProviderKeyLoadStatus?.(provider, false);
        setAiFeedback('Could not load the selected provider’s saved keys. Check extension storage and try again.', 'error');
        refreshSelectionSummary();
        return false;
      }
      const hasSavedFallbackKey = Object.keys(providers).some(fallbackProvider =>
        fallbackProvider !== provider && (settings.managedApiKeys?.[fallbackProvider] || []).some(entry => entry.enabled)
      );
      const hasPrivateFallbackKey = Object.entries(settings.privateApiKeys || {}).some(([fallbackProvider, keys]) =>
        fallbackProvider !== provider && !!keys.length
      );
      await providerCatalog.restoreProviderCatalog(provider, isCurrentLoad, Boolean(draft));
      if (!isCurrentLoad()) return false;
      updateModelSuggestions(providerCatalog.getModels(provider));
      const loadedPrimaryModel = modelInput?.value || config.defaultModel;
      const loadedBackups = draft?.backupModels ?? normalizeBackupModels(settings[config.backupKey], loadedPrimaryModel);
      backupModelUi.populateBackupSlots(providerCatalog.getModels(provider), loadedBackups, loadedPrimaryModel);
      populateFastModelOptions(provider, providerCatalog.getModels(provider), draft?.fastModel ?? settings[config.fastModelKey]);
      await providerQuotaUi.renderProviderQuota(provider);
      if (!isCurrentLoad()) return false;
      refreshSelectionSummary();
      return entries.some(entry => entry.enabled) || !!settings.privateApiKeys?.[provider]?.length ||
        (settings.aiFallbackEnabled !== false && (hasSavedFallbackKey || hasPrivateFallbackKey));
    } finally {
      if (isCurrentLoad()) setProviderFieldsLoading(false);
    }
  }

  return loadProviderFields;
}
