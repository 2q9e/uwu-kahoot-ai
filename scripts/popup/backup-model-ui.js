import { normalizeBackupModels } from '../core/model-routing.js';
import { modelOptionLabel } from './model-catalog-format.js';

export function createBackupModelUi({ backupModelSelects, backupCount, modelInput, providers, getCurrentProvider, getCurrentSettings, getModels, persistSync }) {
  function currentBackupSelection() {
    return normalizeBackupModels(backupModelSelects.map(select => select.value), modelInput?.value || '');
  }

  function updateBackupCount() {
    if (!backupCount) return;
    backupCount.textContent = `${currentBackupSelection().length} / 5`;
  }

  function populateBackupSlots(models = [], selections = currentBackupSelection(), primary = modelInput?.value || '') {
    const backups = normalizeBackupModels(selections, primary);
    const available = models.filter(model => model?.id && model.id !== primary && model.supportsAnswers !== false);
    backupModelSelects.forEach((select, slotIndex) => {
      const previous = backups[slotIndex] || '';
      select.replaceChildren(new Option('No backup', ''));
      for (const model of available) select.add(new Option(modelOptionLabel(model), model.id));
      if (previous && !available.some(model => model.id === previous)) {
        select.add(new Option(`${previous} · custom`, previous));
      }
      select.value = previous;
    });
    updateBackupCount();
  }

  async function persistBackupSlots() {
    const config = providers[getCurrentProvider()];
    const primary = modelInput?.value.trim() || config.defaultModel;
    const next = normalizeBackupModels(backupModelSelects.map(select => select.value), primary);
    populateBackupSlots(getModels(getCurrentProvider()), next, primary);
    const saved = await persistSync({ [config.backupKey]: next });
    if (saved) {
      getCurrentSettings()[config.backupKey] = next;
      updateBackupCount();
    }
    return saved;
  }

  return { currentBackupSelection, populateBackupSlots, persistBackupSlots, updateBackupCount };
}
