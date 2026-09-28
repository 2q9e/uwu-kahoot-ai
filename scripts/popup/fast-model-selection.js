function getAutomaticOptionLabel(provider) {
  if (provider === 'openrouter') return 'Automatic · fastest measured free model';
  if (provider === 'gemini') return 'Automatic · fastest measured / Flash-Lite';
  return 'Automatic · primary model';
}

function getFastModelHelp(provider) {
  if (provider === 'openrouter') {
    return 'Automatic chooses the cached free model with the highest recent throughput. Until a catalog is loaded, it uses the configured OpenRouter fast free model.';
  }
  if (provider === 'gemini') {
    return 'Automatic uses the fastest Gemini model measured in this browser. Until then it uses the configured Gemini fast model.';
  }
  return 'Automatic uses your selected primary model with the lowest reasoning effort.';
}

export function getFastModelOptions(provider, models, selectedModel, measuredGeminiSpeeds = {}) {
  const selected = String(selectedModel || '').trim();
  const available = models.filter(model => model?.id && model.supportsAnswers !== false);
  const options = [{ value: '', text: getAutomaticOptionLabel(provider) }];

  for (const model of available) {
    const measuredSpeed = Number(model.speed) > 0
      ? Number(model.speed)
      : Number(measuredGeminiSpeeds[model.id]?.tokensPerSecond);
    const speed = measuredSpeed > 0
      ? ` · ${Math.round(measuredSpeed)} ${provider === 'openrouter' ? 'endpoint p50' : 'stream'} tok/s`
      : '';
    options.push({
      value: model.id,
      text: `${model.name || model.id}${speed} — ${model.id}`
    });
  }

  if (selected && !available.some(model => model.id === selected)) {
    options.push({ value: selected, text: `Saved override — ${selected}` });
  }

  return {
    selected,
    options,
    help: getFastModelHelp(provider)
  };
}

export function chooseFastestModel(provider, models, measuredGeminiSpeeds = {}, defaultModel) {
  const available = models.filter(model => model?.id && model.supportsAnswers !== false);
  let fastest = null;
  let source = '';

  if (provider === 'gemini') {
    fastest = available
      .filter(model => Number(measuredGeminiSpeeds[model.id]?.tokensPerSecond) > 0)
      .sort((a, b) => Number(measuredGeminiSpeeds[b.id].tokensPerSecond) - Number(measuredGeminiSpeeds[a.id].tokensPerSecond))[0] || null;
    if (fastest) source = 'your Gemini speed checks';
  } else {
    fastest = available
      .filter(model => Number(model.speed) > 0)
      .sort((a, b) => Number(b.speed) - Number(a.speed))[0] || null;
    if (fastest) source = provider === 'openrouter' ? 'recent OpenRouter throughput readings' : 'provider catalog speed data';
  }

  if (fastest) return { model: fastest.id, source };

  if (provider === 'openrouter' && available.length > 0) {
    return {
      model: available[0].id,
      source: 'the first free model in the catalog because no endpoint speed reading is cached yet'
    };
  }

  return {
    model: defaultModel,
    source: provider === 'openai'
      ? 'the provider default; per-model speed is not published'
      : 'the provider default because no speed reading is available yet'
  };
}
