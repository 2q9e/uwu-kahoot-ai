import { chooseFastestModel } from './fast-model-selection.js';

export function createModelCatalogControls({
  elements,
  getCurrentProvider,
  providers,
  defaultProvider,
  providerCatalog,
  modelRenderer,
  backupModelUi,
  refreshSelectionSummary,
  setAiFeedback
}) {
  const {
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
  } = elements;

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

  return { wireModelControls };
}
