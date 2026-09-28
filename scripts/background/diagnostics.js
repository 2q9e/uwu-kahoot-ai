export const DIAGNOSTICS_STORAGE_KEY = 'uwuKahootDiagnosticsV1';

export const DIAGNOSTIC_CATALOG = Object.freeze({
  AI_KEY_MISSING: ['No API key is configured', 'The selected provider has no saved key available.', 'Open API settings, choose a provider, and add a key.'],
  AI_KEY_REJECTED: ['Provider rejected the API key', 'The provider returned an authentication error.', 'Check the key in API settings and confirm it belongs to the selected provider.'],
  AI_ACCESS_DENIED: ['Provider denied access', 'The account or key cannot use this model or endpoint.', 'Check account access and select a model available to this key.'],
  AI_BILLING_LIMIT: ['Provider billing limit reached', 'The provider rejected the request because of credits or billing.', 'Check the provider account’s credits and billing settings.'],
  AI_RATE_LIMIT: ['Provider rate limit reached', 'The provider is temporarily limiting requests.', 'Wait briefly, then retry; configure a fallback provider for busy periods.'],
  AI_MODEL_UNAVAILABLE: ['Model was not found', 'The provider could not find the configured model.', 'Refresh the model catalog and select an available model.'],
  AI_REQUEST_INVALID: ['Provider rejected the request format', 'The selected model may not support this request or its input type.', 'Check the text or image model selection and try a compatible model.'],
  AI_TIMEOUT: ['AI request timed out', 'The provider or image download did not finish within the request window.', 'Retry, use a faster model, or check the network connection.'],
  AI_PROVIDER_UNAVAILABLE: ['Provider is temporarily unavailable', 'The provider returned a server error.', 'Retry in a moment or use a configured fallback provider.'],
  AI_NETWORK: ['Could not reach the AI provider', 'The request could not connect to the provider.', 'Check the network, VPN, firewall, or provider status, then retry.'],
  AI_IMAGE_MISSING: ['Question image is missing', 'This question needs an image, but none was available to the AI request.', 'Wait for the image to appear, then retry the question.'],
  AI_IMAGE_UNSUPPORTED: ['Image input is not supported', 'The image URL, file type, or size is not supported by this provider.', 'Choose a vision model that supports the image type or retry after the page finishes loading.'],
  AI_IMAGE_DOWNLOAD: ['Could not load the question image', 'The image could not be downloaded from the Kahoot page.', 'Check that the image is visible, then retry or choose another vision provider.'],
  AI_RESPONSE_BLOCKED: ['Provider blocked the response', 'The provider returned a safety or content block instead of an answer.', 'Retry once; if it repeats, choose another provider or model.'],
  AI_ANSWER_UNCLEAR: ['AI response did not identify an answer', 'The response could not be matched to one of the available answers.', 'Check the visible choices and retry with a different model.'],
  AI_PROVIDER_ERROR: ['AI provider request failed', 'The provider did not return a usable answer.', 'Check API settings and provider availability, then retry.'],
  QUESTION_CHOICES_INCOMPLETE: ['Answer choices did not finish loading', 'The page did not expose enough readable choices, so no AI request was sent.', 'Wait for all choices to appear or reload the Kahoot tab before retrying.'],
  QUESTION_TITLE_MISSING: ['Question text was not detected', 'Kahoot data did not include readable question text.', 'Wait for the question to finish loading or reload the Kahoot tab.'],
  QUESTION_DATA_UNREADABLE: ['Kahoot question data could not be read', 'The page script received question data in an unexpected format.', 'Reload the Kahoot tab and try again; share Debug details if it repeats.'],
  ANSWER_NO_CONTROLS: ['Answer controls were not found', 'The question was detected, but no answer buttons appeared in the page.', 'Wait for the answer screen to finish loading, then retry.'],
  ANSWER_NO_MATCH: ['AI answer did not match a page choice', 'The returned answer could not be mapped confidently to a visible choice.', 'Check that the choices are complete and retry.'],
  ANSWER_NOT_CLICKABLE: ['Answer button did not become clickable', 'The matching choice stayed disabled or hidden.', 'Wait for Kahoot’s timer or loading state to finish, then retry.'],
  PIN_TARGET_MISSING: ['Pin target was not found', 'The map or image target was not available in the page.', 'Wait for the pin question image to load, then retry.'],
  JUMBLE_TILES_MISSING: ['Jumble tiles were not found', 'No readable tiles appeared in the page.', 'Wait for the tiles to load or reload the Kahoot tab.'],
  JUMBLE_ORDER_UNCLEAR: ['Jumble answer could not be mapped', 'The suggested word could not be matched to the visible tiles.', 'Check the visible tiles and retry.'],
  SLIDER_TARGET_MISSING: ['Slider control was not found', 'The question was detected, but its slider input was not available.', 'Wait for the slider to load, then retry.'],
  TEXT_ANSWER_TARGET_MISSING: ['Text answer field was not found', 'The question was detected, but its answer field was not available.', 'Wait for the field to appear, then retry.'],
  KAHOOT_WS_NOT_READY: ['Kahoot connection is not ready', 'The answer could not be sent over the page’s WebSocket connection.', 'Reconnect or reload the Kahoot tab; the suggested answer remains visible.'],
  KAHOOT_PIN_WS_NOT_READY: ['Pin position was not sent over Kahoot connection', 'The pin was placed on the page, but the live connection was not ready. The page submit action may still accept it.', 'Check the point on the map and use Kahoot’s submit action if available, then retry after the connection is ready.'],
  KAHOOT_SLIDER_WS_NOT_READY: ['Slider value was not sent over Kahoot connection', 'The value was set on the page, but the live connection was not ready. The page submit action may still accept it.', 'Check the selected value and use Kahoot’s submit action if available, then retry after the connection is ready.'],
  CONTENT_SCRIPT_DISCONNECTED: ['Kahoot tab is disconnected', 'The extension could not reach its script in the selected tab.', 'Reload the Kahoot tab and select it again in the extension.'],
  BACKGROUND_WORKER_UNAVAILABLE: ['Extension background did not respond', 'The question request could not reach the extension’s background worker.', 'Reload the extension from the browser’s extensions page, then reload Kahoot.'],
  EXTENSION_STORAGE_ERROR: ['Extension storage could not be read or written', 'A settings or local history operation failed.', 'Check that extension storage is enabled and reload the extension.'],
  EXTENSION_UNHANDLED_ERROR: ['Background runtime error detected', 'The extension background encountered an unhandled JavaScript error.', 'Open Debug details and use the stage/provider information to narrow down the issue.'],
  CONTENT_SCRIPT_UNHANDLED_ERROR: ['Kahoot page script error was caught', 'The extension’s page script encountered an unhandled JavaScript error.', 'Reload the Kahoot tab; if it repeats, share the Debug details report.'],
  KAHOOT_TAB_UNAVAILABLE: ['Kahoot tab could not be reached', 'The selected tab may have closed or navigated away.', 'Choose an open Kahoot tab and retry.'],
  RETRY_REQUEST_FAILED: ['Retry could not start', 'The selected tab did not accept a retry request.', 'Reload the Kahoot tab and try again.'],
  UNCLASSIFIED_ERROR: ['Unclassified extension error', 'The extension caught an error without a known failure category.', 'Share the Debug details report so the failure can be traced.']
});

const VALID_STAGES = new Set([
  'background', 'content', 'detection', 'settings', 'image', 'provider', 'answer', 'matching',
  'dispatch', 'kahoot', 'storage', 'statistics', 'popup', 'retry'
]);
const VALID_PROVIDERS = new Set(['openai', 'gemini', 'openrouter']);
const VALID_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'AbortError']);

export function classifyAiFailure(error, stage = 'provider') {
  const status = Number(error?.status);
  const message = String(error?.message || '').toLowerCase();
  if (/no\s+.+api key configured|api key (?:is )?not configured/.test(message)) return 'AI_KEY_MISSING';
  if (stage === 'settings' || /extension storage|storage(?: area|\.sync|\.local)|extension context invalidated/.test(message)) return 'EXTENSION_STORAGE_ERROR';
  if (/(?:invalid|expired|revoked).*api key|api key.*(?:invalid|expired|revoked)/.test(message)) return 'AI_KEY_REJECTED';
  if (status === 401) return 'AI_KEY_REJECTED';
  if (status === 403) return 'AI_ACCESS_DENIED';
  if (status === 402) return 'AI_BILLING_LIMIT';
  if (status === 429) return 'AI_RATE_LIMIT';
  if (status === 404) return 'AI_MODEL_UNAVAILABLE';
  if (status === 400) return 'AI_REQUEST_INVALID';
  if (status === 408 || error?.name === 'TimeoutError' || /timed? ?out|time budget expired/.test(message)) return 'AI_TIMEOUT';
  if (status >= 500 && status <= 599) return 'AI_PROVIDER_UNAVAILABLE';
  if (/no image (?:url|found)|image is missing/.test(message)) return 'AI_IMAGE_MISSING';
  if (/image.*(?:support|type|too large|https image)|unsupported.*image/.test(message)) return 'AI_IMAGE_UNSUPPORTED';
  if (/download.*image|image.*download/.test(message)) return 'AI_IMAGE_DOWNLOAD';
  if (/safety|blocked|promptfeedback|finish reason/.test(message)) return 'AI_RESPONSE_BLOCKED';
  if (/could not identify|did not identify|could not parse|invalid (?:slider )?value|no choices to match/.test(message)) return 'AI_ANSWER_UNCLEAR';
  if (error?.name === 'TypeError' || /failed to fetch|network|connection/.test(message)) return 'AI_NETWORK';
  return 'AI_PROVIDER_ERROR';
}

export function diagnosticPresentation(code) {
  const [title, detail, recovery] = DIAGNOSTIC_CATALOG[code] || DIAGNOSTIC_CATALOG.UNCLASSIFIED_ERROR;
  return { code: DIAGNOSTIC_CATALOG[code] ? code : 'UNCLASSIFIED_ERROR', title, detail, recovery };
}

export function createDiagnosticRecord(code, metadata = {}) {
  const presentation = diagnosticPresentation(code);
  const model = typeof metadata.model === 'string' && /^[a-z0-9][a-z0-9._:/-]{0,99}$/i.test(metadata.model) &&
    !/^(?:sk-|AIza|Bearer\b)/i.test(metadata.model)
    ? metadata.model
    : undefined;
  const httpStatus = Number(metadata.httpStatus);
  const attempt = Number(metadata.attempt);
  const record = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    time: new Date().toISOString(),
    ...presentation,
    stage: VALID_STAGES.has(metadata.stage) ? metadata.stage : 'background',
    ...(VALID_PROVIDERS.has(metadata.provider) ? { provider: metadata.provider } : {}),
    ...(model ? { model } : {}),
    ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
    ...(VALID_ERROR_NAMES.has(metadata.errorName) ? { errorName: metadata.errorName } : {}),
    ...(Number.isInteger(attempt) && attempt > 0 && attempt <= 9 ? { attempt } : {})
  };
  for (const key of ['dataChoiceCount', 'visibleChoiceCount', 'expectedChoiceCount']) {
    const count = Number(metadata[key]);
    if (Number.isInteger(count) && count >= 0 && count <= 50) record[key] = count;
  }
  return record;
}
