export const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const REQUEST_TIMEOUT_MS = 12000;

export function safeMessage(message, apiKey) {
  const text = typeof message === 'string' ? message : 'Request failed';
  return apiKey ? text.split(apiKey).join('[hidden]') : text;
}

export async function fetchJson(url, headers, apiKey, label, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let data;
  try {
    response = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      const parseError = new Error(`${label} returned an unreadable response (HTTP ${response.status}).`);
      parseError.code = 'UNREADABLE_RESPONSE';
      throw parseError;
    }
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') throw new Error(`${label} request timed out.`);
    if (error?.code === 'UNREADABLE_RESPONSE') throw error;
    throw new Error(`${label} request failed. Check the connection and try again.`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
    const error = new Error(`${label}: ${safeMessage(message, apiKey)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}
