export function formatCatalogTokens(value) {
  const amount = Number(value) || 0;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(amount % 1_000 ? 1 : 0)}K`;
  return String(amount);
}

export function modelOptionLabel(model) {
  const limit = model.inputLimit ? ` · ${formatCatalogTokens(model.inputLimit)} ctx` : '';
  const speedValue = Number.isFinite(Number(model.speed)) && Number(model.speed) > 0 ? Math.round(model.speed) : 0;
  const speed = speedValue ? ` · ${speedValue} ${model.provider === 'openrouter' ? 'endpoint p50' : 'stream'} tok/s` : '';
  return `${model.name}${limit}${speed} — ${model.id}`.slice(0, 180);
}

export function formatModelSpeed(model, measuredGeminiSpeeds = {}) {
  if (model.provider === 'openai') {
    if (Number(model.speed) > 0) {
      const sample = model.speedUpdatedAt ? ` · checked ${new Date(model.speedUpdatedAt).toLocaleString()}` : '';
      const firstToken = model.speedFirstTokenMs != null && Number.isFinite(Number(model.speedFirstTokenMs))
        ? ` · median first token ${Math.round(model.speedFirstTokenMs)} ms` : '';
      const tokenLabel = model.outputTokenCountSource === 'openai-stream-logprobs' ? 'visible text tokens/sample' : 'output tokens/sample';
      const count = Number(model.speedOutputTokens) > 0 ? ` · ${Math.round(model.speedOutputTokens)} ${tokenLabel}` : '';
      const range = Number(model.speedMin) > 0 && Number(model.speedMax) > 0 ? ` · range ${model.speedMin}–${model.speedMax}` : '';
      return `Stream TPS (median of ${model.speedSampleCount || 1}): ${Number(model.speed)} tok/s${count}${firstToken}${range}${sample}`;
    }
    return 'No stream TPS reading yet. Measure speed runs three short streams; usage charges may apply.';
  }
  if (model.provider === 'gemini') {
    const measured = measuredGeminiSpeeds[model.id];
    return measured ? `Stream TPS (median of ${measured.sampleCount || 1}): ${measured.tokensPerSecond} tok/s · ${measured.outputTokens} candidate tokens/sample · median first token ${measured.firstTokenMs} ms`
      : 'No stream TPS reading yet. Measure speed runs three short streams; Google quota or billing may apply.';
  }
  if (model.provider === 'openrouter') {
    if (Number.isFinite(Number(model.speed)) && Number(model.speed) > 0) {
      const latency = Number.isFinite(Number(model.latency)) && Number(model.latency) > 0 ? ` · ${Math.round(model.latency * 1000)} ms p50 latency` : '';
      const provider = model.speedProvider ? ` via ${model.speedProvider}` : '';
      const when = model.speedUpdatedAt ? ` · sample ${new Date(model.speedUpdatedAt).toLocaleTimeString()}` : '';
      return `Best free endpoint · provider-reported 30-minute p50: ${Math.round(model.speed)} tok/s${provider}${latency}${when}`;
    }
    return 'No recent free-endpoint throughput reading.';
  }
  return 'No speed reading is available for this model.';
}
