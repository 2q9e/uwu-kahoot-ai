export function wirePreferenceControls({
  checkboxPreferences,
  fallbackCheckbox,
  delaySlider,
  persistSync,
  updateDelayLabel,
  getSavedFallbackValue,
  onFallbackSaveFailed,
  onFallbackSaved
}) {
  for (const [input, key] of checkboxPreferences) {
    input?.addEventListener('change', async () => {
      const nextValue = input.checked;
      if (!await persistSync({ [key]: nextValue })) input.checked = !nextValue;
    });
  }

  fallbackCheckbox?.addEventListener('change', async () => {
    const nextValue = fallbackCheckbox.checked;
    if (!await persistSync({ aiFallbackEnabled: nextValue })) {
      fallbackCheckbox.checked = getSavedFallbackValue() !== false;
      onFallbackSaveFailed();
      return;
    }
    onFallbackSaved(nextValue);
  });

  let delayDebounce = null;
  delaySlider?.addEventListener('input', () => {
    const value = parseFloat(delaySlider.value);
    updateDelayLabel(value);
    clearTimeout(delayDebounce);
    delayDebounce = setTimeout(() => persistSync({ answerDelay: value }), 250);
  });
}
