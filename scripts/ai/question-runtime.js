import { AI_REQUEST_BUDGET_MS } from './provider-client.js';
import { getAISettings } from './provider-config.js';

export const NEED_IMAGE = 'NEED_IMAGE';
const STYLE = 'color:#f0abfc;font-weight:bold';
export const log = (...args) => console.log('%c[AI]', STYLE, ...args);
export const warn = (...args) => console.warn('%c[AI]', STYLE, ...args);

export async function getQuestionSetup(options = {}) {
  const settings = await getAISettings();
  const requestContext = {
    signal: options?.signal,
    deadline: options?.deadline ?? Date.now() + AI_REQUEST_BUDGET_MS,
    settingsSnapshot: settings.settingsSnapshot,
    providerKeys: settings.providerKeys,
    attemptCounter: { value: 0 }
  };
  return { ...settings, requestContext };
}
