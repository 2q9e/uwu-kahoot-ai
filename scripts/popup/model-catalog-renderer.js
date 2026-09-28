import { formatCatalogTokens, formatModelSpeed } from './model-catalog-format.js';
import { createModelCatalogSpeedActions } from './model-catalog-speed-actions.js';

let paidSpeedActionNoteSequence = 0;

export function createModelCatalogRenderer({
  catalogPrefix,
  getCurrentProvider,
  getModels,
  setModels,
  getMeasuredGeminiSpeeds,
  modelInput,
  visionInput,
  modelSearchInput,
  modelCapabilityFilter,
  modelCatalogList,
  showMoreModelsBtn,
  currentBackupSelection,
  populateBackupSlots,
  getCurrentProviderKey,
  setAiFeedback,
  onSelectionChange = () => {},
  onModelsUpdated = () => {},
  renderProviderQuota
}) {
  let visibleLimit = 50;
  const { measureGeminiSpeed, measureOpenAISpeed, measureOpenRouterSpeed } = createModelCatalogSpeedActions({
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
  });

  function createAction(text, className = 'catalog-action secondary') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
  }

  function appendPaidSpeedAction(actions, model, measureSpeed, title) {
    const group = document.createElement('div');
    group.className = 'model-speed-action';
    const measure = createAction('Measure speed');
    measure.title = title;
    measure.addEventListener('click', () => measureSpeed(model, measure));
    const costNote = document.createElement('span');
    costNote.className = 'model-speed-cost-note';
    costNote.id = `paid-speed-cost-note-${++paidSpeedActionNoteSequence}`;
    costNote.textContent = '3 short generation requests · provider charges may apply';
    measure.setAttribute('aria-describedby', costNote.id);
    group.append(measure, costNote);
    actions.append(group);
  }

  function appendModelActions(actions, model, allModels) {
    const useText = createAction(model.supportsAnswers === false ? 'Not for quiz text' : 'Use for answers', 'catalog-action');
    useText.disabled = model.supportsAnswers === false;
    useText.addEventListener('click', () => {
      if (modelInput) modelInput.value = model.id;
      populateBackupSlots(allModels, currentBackupSelection(), model.id);
      onSelectionChange();
      setAiFeedback(`Selected ${model.name}. Save model settings to apply it.`, '');
      renderModelCatalog();
    });
    actions.append(useText);

    if (model.supportsVision) {
      const useVision = createAction('Use for vision');
      useVision.addEventListener('click', () => {
        if (visionInput) visionInput.value = model.id;
        onSelectionChange();
        setAiFeedback(`Selected ${model.name} for image questions. Save model settings to apply it.`, '');
        renderModelCatalog();
      });
      actions.append(useVision);
    }

    const addBackup = createAction('Add backup');
    addBackup.disabled = model.supportsAnswers === false;
    addBackup.addEventListener('click', async () => {
      const existing = currentBackupSelection();
      if (model.id === (modelInput?.value || '').trim() || existing.includes(model.id)) {
        setAiFeedback('That model is already selected as the primary or a backup.', '');
        return;
      }
      const next = [...existing, model.id].slice(0, 5);
      if (existing.length >= 5) {
        setAiFeedback('All five backup slots are filled. Choose a slot to replace one.', 'error');
        return;
      }
      populateBackupSlots(allModels, next, modelInput?.value || '');
      onSelectionChange();
      setAiFeedback(`Added ${model.name} as backup ${next.length}. Save model settings to apply it.`, 'success');
      renderModelCatalog();
    });
    actions.append(addBackup);

    if (model.provider === 'gemini' && model.supportsAnswers !== false) {
      appendPaidSpeedAction(
        actions,
        model,
        measureGeminiSpeed,
        'Runs three short streaming generations and reports median TPS plus first-token time using Google candidate token counts. Quota or billing may apply.'
      );
    }

    if (model.provider === 'openai' && model.supportsAnswers !== false) {
      appendPaidSpeedAction(
        actions,
        model,
        measureOpenAISpeed,
        'Runs three short streaming generations and reports median TPS plus first-token time using token-level stream data. Models without that data cannot be measured. Usage charges may apply.'
      );
    }

    if (model.provider === 'openrouter') {
      const measure = createAction(model.speed ? 'Refresh TPS' : 'Check TPS');
      measure.title = 'Reads the best free endpoint’s provider-reported 30-minute p50 throughput; it does not generate a response.';
      measure.addEventListener('click', () => measureOpenRouterSpeed(model, measure));
      actions.append(measure);
    }
  }

  function renderModelCatalog() {
    if (!modelCatalogList) return;
    modelCatalogList.replaceChildren();
    const allModels = getModels(getCurrentProvider());
    const query = (modelSearchInput?.value || '').trim().toLowerCase();
    const capability = modelCapabilityFilter?.value || 'all';
    const measuredGemini = getMeasuredGeminiSpeeds();
    const models = allModels.filter(model => {
      const textMatches = !query || `${model.name} ${model.id} ${model.description}`.toLowerCase().includes(query);
      if (!textMatches) return false;
      if (capability === 'text') return model.supportsAnswers !== false;
      if (capability === 'vision') return model.supportsVision === true;
      if (capability === 'reasoning') return model.supportsReasoning === true;
      if (capability === 'measured') return Number(model.speed) > 0 || Number(measuredGemini[model.id]?.tokensPerSecond) > 0;
      return true;
    });
    if (!models.length) {
      if (showMoreModelsBtn) showMoreModelsBtn.classList.add('hidden');
      const empty = document.createElement('div');
      empty.className = 'catalog-empty';
      empty.textContent = allModels.length ? 'No models match this filter.' : 'Refresh to load this provider’s model catalog.';
      modelCatalogList.append(empty);
      return;
    }

    const visibleModels = models.slice(0, visibleLimit);
    const fragment = document.createDocumentFragment();
    for (const model of visibleModels) {
      const card = document.createElement('article');
      card.className = 'model-card';
      const heading = document.createElement('div');
      heading.className = 'model-card-heading';
      const name = document.createElement('strong');
      name.textContent = model.name;
      const id = document.createElement('code');
      id.textContent = model.id;
      heading.append(name, id);
      card.append(heading);

      const selected = document.createElement('div');
      selected.className = 'model-card-selection';
      if (model.id === modelInput?.value.trim()) {
        const textBadge = document.createElement('span');
        textBadge.textContent = 'Primary text model';
        selected.append(textBadge);
      }
      if (model.id === visionInput?.value.trim()) {
        const visionBadge = document.createElement('span');
        visionBadge.textContent = 'Image-question model';
        selected.append(visionBadge);
      }
      if (selected.childElementCount) card.append(selected);

      const detail = document.createElement('p');
      detail.className = 'model-card-meta';
      const bits = [];
      if (model.inputLimit) bits.push(`Input ${formatCatalogTokens(model.inputLimit)}`);
      if (model.outputLimit) bits.push(`Output ${formatCatalogTokens(model.outputLimit)}`);
      bits.push(model.supportsAnswers === false ? `Other API methods: ${(model.methods || []).join(', ') || 'not for quiz text'}` : 'Text answers supported');
      bits.push(model.supportsReasoning ? 'Reasoning' : 'No reasoning flag');
      if (model.supportsVision) bits.push('Image input');
      if (model.provider === 'openrouter') bits.push('Free');
      detail.textContent = bits.join(' · ');
      card.append(detail);

      const speed = document.createElement('p');
      speed.className = 'model-card-speed';
      speed.textContent = formatModelSpeed(model, getMeasuredGeminiSpeeds());
      card.append(speed);

      if (model.description) {
        const description = document.createElement('p');
        description.className = 'model-card-description';
        description.textContent = model.description.slice(0, 260);
        card.append(description);
      }

      const actions = document.createElement('div');
      actions.className = 'model-card-actions';
      appendModelActions(actions, model, allModels);
      card.append(actions);
      fragment.append(card);
    }
    modelCatalogList.append(fragment);
    if (showMoreModelsBtn) {
      const remaining = Math.max(0, models.length - visibleModels.length);
      showMoreModelsBtn.classList.toggle('hidden', remaining === 0);
      showMoreModelsBtn.textContent = remaining ? `Show ${Math.min(50, remaining)} more models · ${remaining.toLocaleString()} remaining` : 'Show more models';
    }
  }

  function resetVisibleModelLimit() {
    visibleLimit = 50;
  }

  function handleSearch() {
    visibleLimit = 50;
    renderModelCatalog();
  }

  function showMoreModels() {
    visibleLimit += 50;
    renderModelCatalog();
  }

  return { handleSearch, renderModelCatalog, resetVisibleModelLimit, showMoreModels };
}
