export const MAX_BACKUP_MODELS = 5;
export const MODEL_REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function normalizeBackupModels(value, primaryModel = '', max = MAX_BACKUP_MODELS) {
  let items = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = items.split(/[\n,]+/); }
  }
  if (!Array.isArray(items)) return [];
  const primary = String(primaryModel || '').trim().toLowerCase();
  const result = [];
  const seen = new Set(primary ? [primary] : []);
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const model = item.trim().slice(0, 160);
    const normalized = model.toLowerCase();
    if (!model || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(model);
    if (result.length >= max) break;
  }
  return result;
}

export function getModelPriority(primaryModel, backupModels = []) {
  const primary = String(primaryModel || '').trim();
  return [primary, ...normalizeBackupModels(backupModels, primary)].filter(Boolean);
}

export function normalizeReasoningEffort(value) {
  return MODEL_REASONING_LEVELS.includes(value) ? value : 'none';
}

export function geminiThinkingConfig(modelId, effortValue) {
  const model = String(modelId || '').toLowerCase();
  const effort = normalizeReasoningEffort(effortValue);
  const isRoboticsEr2 = /(?:^|-)robotics-er-2(?:-|$)/.test(model);
  const isGemini3 = /(?:^|-)3(?:\.|-|$)/.test(model) || isRoboticsEr2;
  if (isGemini3) {
    const imageMinimalHighOnly = /gemini-3\.1-flash(?:-lite)?-image(?:-|$)/.test(model);
    if (imageMinimalHighOnly) {
      return { thinkingLevel: effort === 'high' || effort === 'xhigh' || effort === 'max' ? 'high' : 'minimal' };
    }

    const supportsMinimal = /gemini-3\.(?:6|5)-flash(?:-lite)?|gemini-3\.1-flash(?:-lite)?|gemini-3-flash|robotics-er-2/i.test(model);
    const level = (effort === 'none' || effort === 'minimal') ? (supportsMinimal ? 'minimal' : 'low')
      : (effort === 'xhigh' || effort === 'max') ? 'high' : effort;
    return { thinkingLevel: level };
  }
  if (!/(?:^|-)2\.5(?:-|$)/.test(model)) return null;
  const isPro = /2\.5-pro/.test(model);
  const isFlashLite = /2\.5-flash-lite/.test(model);
  if (effort === 'none') {
    return isPro ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
  }
  if (effort === 'minimal') return { thinkingBudget: isFlashLite ? 0 : 128 };
  if (effort === 'low') return { thinkingBudget: isFlashLite ? 512 : 1024 };
  if (effort === 'medium') return { thinkingBudget: 4096 };
  return { thinkingBudget: -1 };
}

export function openRouterReasoningEffort(effortValue) {
  const effort = normalizeReasoningEffort(effortValue);
  return effort === 'max' ? 'xhigh' : effort;
}

export function openAIReasoningEffort(effortValue, modelId = '') {
  const effort = normalizeReasoningEffort(effortValue);
  const model = String(modelId || '').trim().toLowerCase();

  if (/^gpt-5(?:\.\d+)?-pro(?:-|$)/.test(model)) return 'high';

  if (/^gpt-6-astra(?:-|$)/.test(model)) {
    if (effort === 'none' || effort === 'minimal') return 'low';
    return effort;
  }
  if (/^gpt-6-(?:sol|luna)(?:-|$)|^gpt-5\.6(?:-|$)/.test(model)) {
    return effort === 'minimal' ? 'low' : effort;
  }

  if (/^gpt-5\.5(?:-|$)/.test(model)) {
    if (effort === 'minimal') return 'low';
    if (effort === 'max') return 'xhigh';
    return effort;
  }

  if (/^gpt-5\.1(?:-|$)/.test(model) && !/^gpt-5\.1-codex-max(?:-|$)/.test(model)) {
    if (effort === 'minimal') return 'low';
    if (effort === 'xhigh' || effort === 'max') return 'high';
    return effort;
  }

  if (/^o[134](?:-|$)/.test(model)) {
    if (effort === 'none' || effort === 'minimal') return 'low';
    if (effort === 'xhigh' || effort === 'max') return 'high';
  }
  if (/^gpt-5(?:-|$)/.test(model)) {
    if (effort === 'none') return 'minimal';
    if (effort === 'xhigh' || effort === 'max') return 'high';
  }

  if (!model) {
    if (effort === 'none') return 'minimal';
    if (effort === 'xhigh') return 'high';
    if (effort === 'max') return 'xhigh';
  }
  return effort;
}
