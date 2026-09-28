export function wirePreferenceControls({
  checkboxPreferences,
  fallbackCheckbox,
  delaySlider,
  persistSync,
  updateDelayLabel,
  getSavedPreferenceValue,
  getSavedFallbackValue,
  onFallbackSaveFailed,
  onFallbackSaved
}) {
  const latestWriteByKey = new Map();
  const preferenceWriteQueues = new Map();
  let nextWriteId = 0;

  function startWrite(key) {
    const writeId = ++nextWriteId;
    latestWriteByKey.set(key, writeId);
    return writeId;
  }

  function isLatestWrite(key, writeId) {
    return latestWriteByKey.get(key) === writeId;
  }

  function persistPreference(key, value) {
    const writeId = startWrite(key);
    const previousWrite = preferenceWriteQueues.get(key) || Promise.resolve();
    const write = previousWrite.catch(() => {})
      .then(() => persistSync({ [key]: value }))
      .catch(() => false);
    preferenceWriteQueues.set(key, write);
    return { writeId, write };
  }

  function savedValue(key) {
    return key === 'aiFallbackEnabled'
      ? getSavedFallbackValue() !== false
      : getSavedPreferenceValue(key);
  }

  for (const [input, key] of checkboxPreferences) {
    input?.addEventListener('change', async () => {
      const nextValue = input.checked;
      const { writeId, write } = persistPreference(key, nextValue);
      if (!await write && isLatestWrite(key, writeId)) {
        input.checked = savedValue(key);
      }
    });
  }

  fallbackCheckbox?.addEventListener('change', async () => {
    const nextValue = fallbackCheckbox.checked;
    const { writeId, write } = persistPreference('aiFallbackEnabled', nextValue);
    if (!await write) {
      if (isLatestWrite('aiFallbackEnabled', writeId)) {
        fallbackCheckbox.checked = savedValue('aiFallbackEnabled');
        onFallbackSaveFailed();
      }
      return;
    }
    if (isLatestWrite('aiFallbackEnabled', writeId)) onFallbackSaved(nextValue);
  });

  let delayDebounce = null;
  async function saveDelay(value) {
    const { writeId, write } = persistPreference('answerDelay', value);
    if (!await write && isLatestWrite('answerDelay', writeId)) {
      const savedDelay = getSavedPreferenceValue('answerDelay');
      if (delaySlider) delaySlider.value = savedDelay;
      updateDelayLabel(savedDelay);
    }
  }

  delaySlider?.addEventListener('input', () => {
    const value = parseFloat(delaySlider.value);
    updateDelayLabel(value);
    clearTimeout(delayDebounce);
    delayDebounce = setTimeout(() => {
      delayDebounce = null;
      void saveDelay(value);
    }, 250);
  });

  delaySlider?.addEventListener('change', () => {
    const value = parseFloat(delaySlider.value);
    updateDelayLabel(value);
    clearTimeout(delayDebounce);
    delayDebounce = null;
    void saveDelay(value);
  });
}
