
'use strict';

if (window.__UwUKahootAIContentLoaded) {
  console.log('%c[UwU Kahoot AI]', 'color:#c026d3;font-weight:bold', 'Content script already loaded in this frame');
} else {
  window.__UwUKahootAIContentLoaded = true;

const isKahootPage = location.hostname === 'kahoot.it' || location.hostname.endsWith('.kahoot.it');
if (isKahootPage) {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('scripts/content/page-bridge.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

const TAG = '[UwU Kahoot AI]';
const STYLE = 'color:#c026d3;font-weight:bold';
const log = (...args) => console.log(`%c${TAG}`, STYLE, ...args);
const warn = (...args) => console.warn(`%c${TAG}`, STYLE, ...args);

function recordDiagnostic(code, metadata = {}) {
  try { chrome.runtime.sendMessage({ action: 'recordDiagnostic', code, metadata }).catch(() => {}); }
  catch (_) {}
}

const contentState = {
  currentQuestion: null,
  currentSolveId: null,
  currentAnswer: null,
  questionState: 'idle',
  questionError: null,
  currentQuestionReadiness: null,
  activeRequestId: null,
  lastSentHash: null,
  lastPreparedHash: null,
  loadingEndsAt: 0,
  pendingRetryHash: null,
  hasRetried: false,
  submitNonce: 0
};
const QUESTION_SCOPED_ACTIONS = new Set([
  'highlightAnswer', 'placePin', 'reorderJumble', 'setSlider', 'typeOpenEnded', 'showError', 'answerProgress',
  'getPinImageUrl', 'getQuestionImageUrl'
]);
const CHOICE_QUESTION_TYPES = new Set(['quiz', 'true_false', 'multiple_select_quiz']);
const NON_RETRYABLE_DIAGNOSTICS = new Set([
  'AI_KEY_MISSING', 'AI_KEY_REJECTED', 'AI_ACCESS_DENIED', 'AI_BILLING_LIMIT',
  'AI_RATE_LIMIT', 'AI_MODEL_UNAVAILABLE', 'AI_REQUEST_INVALID', 'AI_IMAGE_UNSUPPORTED', 'AI_ANSWER_UNCLEAR',
  'EXTENSION_STORAGE_ERROR'
]);

let cachedSettings = {
  pluginEnabled: true,
  highlightOption: true,
  autoClickOption: true,
  pinHighlightOption: true,
  pinAutoClickOption: false,
  answerDelay: 0,
  silentMode: false
};

const matching = globalThis.UwUKahootAIMatching;
const domAdapter = globalThis.UwUKahootAIDomAdapter;
const statusUi = globalThis.UwUKahootAIStatusUi.create({
  getSilentMode: () => cachedSettings.silentMode,
  getCurrentQuestion: () => contentState.currentQuestion,
  getQuestionState: () => contentState.questionState,
  setQuestionState: (state, error) => {
    contentState.questionState = state;
    contentState.questionError = error;
  },
  broadcastToPopup
});
const { updateStatus, removeStatusIndicator, showErrorToast } = statusUi;
const domWaiter = globalThis.UwUKahootAIDomWait.create({ getNonce: () => contentState.submitNonce });
const { waitForDomResult, waitForQuestionEvent } = domWaiter;
const questionDom = globalThis.UwUKahootAIQuestionDom.create({
  domAdapter,
  waitForDomResult,
  getNonce: () => contentState.submitNonce,
  log
});
const { captureAnswerChoiceSnapshot, getExpectedChoiceCount, pollForAnswerChoices, pollForImageLabels, pollForJumbleTiles, probeSliderConfigFast } = questionDom;
const { removeTimerOverlay, showTimerOverlay } = globalThis.UwUKahootAIDelayUi.create();
const answerFeedbackUi = globalThis.UwUKahootAIAnswerFeedbackUi.create({ domAdapter });
const answerActions = globalThis.UwUKahootAIAnswerActions.create({
  domAdapter,
  matching,
  waitForDomResult,
  waitForQuestionEvent,
  questionDom,
  answerFeedbackUi,
  showTimerOverlay,
  updateStatus,
  recordDiagnostic,
  log,
  warn,
  getSubmitNonce: () => contentState.submitNonce,
  getCurrentQuestion: () => contentState.currentQuestion,
  getCurrentAnswer: () => contentState.currentAnswer,
  getLoadingEndsAt: () => contentState.loadingEndsAt
});
let settingsRevision = 0;
let latestSettingsChanges = {};
let initialSettingsLoaded = false;
let initialSettingsPromise;

const CONTENT_SETTING_NORMALIZERS = {
  pluginEnabled: value => value !== false,
  highlightOption: value => value !== false,
  autoClickOption: value => value !== false,
  pinHighlightOption: value => value !== false,
  pinAutoClickOption: value => !!value,
  answerDelay: value => value ?? 0,
  silentMode: value => !!value
};

function normalizeContentSettings(values) {
  return Object.fromEntries(Object.entries(CONTENT_SETTING_NORMALIZERS).map(([key, normalize]) => [key, normalize(values[key])]));
}

function advanceSubmitNonce() {
  contentState.submitNonce++;
  domWaiter.cancelAll();
}

function refreshSettings() {
  const revisionAtRead = settingsRevision;
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['pluginEnabled', 'highlightOption', 'autoClickOption', 'pinHighlightOption', 'pinAutoClickOption', 'answerDelay', 'silentMode'],
      s => {
        if (chrome.runtime.lastError) recordDiagnostic('EXTENSION_STORAGE_ERROR', { stage: 'settings' });
        const values = settingsRevision === revisionAtRead ? (s || {}) : { ...(s || {}), ...latestSettingsChanges };
        cachedSettings = normalizeContentSettings(values);
        resolve(cachedSettings);
      }
    );
  });
}

chrome.storage.onChanged.addListener((changes, ns) => {
  if (ns !== 'sync') return;
  const wasPluginEnabled = cachedSettings.pluginEnabled !== false;
  settingsRevision += 1;
  for (const [key, normalize] of Object.entries(CONTENT_SETTING_NORMALIZERS)) {
    if (!(key in changes)) continue;
    const value = changes[key].newValue;
    latestSettingsChanges[key] = value;
    cachedSettings[key] = normalize(value);
  }
  if (Object.hasOwn(changes, 'pluginEnabled')) {
    window.dispatchEvent(new CustomEvent('kahootPluginStateChanged', {
      detail: { enabled: cachedSettings.pluginEnabled }
    }));
  }
  const isPluginEnabled = cachedSettings.pluginEnabled !== false;
  if (wasPluginEnabled && !isPluginEnabled) {
    clearCurrentQuestion('Extension paused. Detection and answer actions are off.');
    answerFeedbackUi.cleanupOverlays();
    removeStatusIndicator();
  } else if (!wasPluginEnabled && isPluginEnabled) {
    updateStatus('Extension enabled', 'Waiting for the next quiz question.');
    window.dispatchEvent(new CustomEvent('kahootQuestionRescan'));
  }
  if (cachedSettings.silentMode) {
    removeStatusIndicator();
    document.getElementById('uwukahootai-timer')?.remove();
  }
});

initialSettingsPromise = refreshSettings().then(() => {
  initialSettingsLoaded = true;
  window.dispatchEvent(new CustomEvent('kahootPluginStateChanged', {
    detail: { enabled: cachedSettings.pluginEnabled }
  }));
  if (!cachedSettings.pluginEnabled) {
    clearCurrentQuestion('Extension paused. Detection and answer actions are off.');
    answerFeedbackUi.cleanupOverlays();
    removeStatusIndicator();
  }
});

window.addEventListener('error', event => recordDiagnostic('CONTENT_SCRIPT_UNHANDLED_ERROR', { stage: 'content', errorName: event.error?.name }));
window.addEventListener('unhandledrejection', event => recordDiagnostic('CONTENT_SCRIPT_UNHANDLED_ERROR', { stage: 'content', errorName: event.reason?.name }));

function questionHash(q) {
  return JSON.stringify({
    t: q.title,
    c: q.choices || [],
    type: q.type || '',
    index: q.questionIndex ?? null,
    sliderConfig: q.sliderConfig || null
  });
}

function createSolveId() {
  try { return crypto.randomUUID(); }
  catch (_) { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function broadcastToPopup(action, data = {}) {
  try { chrome.runtime.sendMessage({ action, ...data }).catch(() => {}); } catch (_) {}
}

function cancelActiveRequest() {
  const requestId = contentState.activeRequestId;
  if (!requestId) return;
  contentState.activeRequestId = null;
  try { chrome.runtime.sendMessage({ action: 'cancelQuestion', requestId }).catch(() => {}); } catch (_) {}
}

function clearCurrentQuestion(status) {
  cancelActiveRequest();
  contentState.currentQuestion = null;
  contentState.currentSolveId = null;
  contentState.currentAnswer = null;
  contentState.questionState = 'idle';
  contentState.questionError = null;
  contentState.currentQuestionReadiness = null;
  contentState.activeRequestId = null;
  contentState.lastSentHash = null;
  contentState.lastPreparedHash = null;
  contentState.pendingRetryHash = null;
  contentState.hasRetried = false;
  advanceSubmitNonce();
  removeTimerOverlay();
  broadcastToPopup('resetLiveState', { status });
}

function sendQuestionToBackend(question) {
  if (!cachedSettings.pluginEnabled) return false;
  const platformName = location.hostname === 'play.blooket.com' ? 'Blooket' : 'Kahoot';
  const choices = question.choices || [];
  if (CHOICE_QUESTION_TYPES.has(question.type) && (
    choices.length < 2 || choices.some(choice => !String(choice || '').trim()) || contentState.questionState === 'waiting_for_choices'
  )) {
    updateStatus('Waiting for answer choices', `No AI request was sent because ${platformName} has not displayed the complete answer set yet.`);
    return false;
  }
  contentState.currentSolveId ||= createSolveId();
  contentState.lastSentHash = questionHash(question);
  contentState.activeRequestId = contentState.lastSentHash;
  contentState.questionState = 'processing';
  contentState.questionError = null;
  const shortQ = question.title.length > 60 ? question.title.slice(0, 57) + '...' : question.title;
  updateStatus('Sending to AI...', shortQ);
  broadcastToPopup('updateQuestion', {
    question: { title: question.title, type: question.type, choices: question.choices || [] },
    state: 'processing',
    readiness: contentState.currentQuestionReadiness
  });
  chrome.runtime.sendMessage({ action: 'processQuestion', question, requestId: contentState.lastSentHash, solveId: contentState.currentSolveId }, response => {
    if (chrome.runtime.lastError) {
      recordDiagnostic('BACKGROUND_WORKER_UNAVAILABLE', { stage: 'content' });
      updateStatus('Error: extension background did not respond', `Reload the extension, then reload the ${platformName} tab.`);
      contentState.lastSentHash = null; contentState.lastPreparedHash = null;
      return;
    }
    if (response?.error) {
      recordDiagnostic(response.diagnosticCode || 'UNCLASSIFIED_ERROR', { stage: 'background' });
      updateStatus(`Error: ${response.error}`, response.suggestion || 'Open Debug details for recovery guidance.');
    }
  });
  return true;
}

globalThis.UwUKahootAIRuntimeMessageHandler.create({
  state: contentState,
  isPluginEnabled: () => cachedSettings.pluginEnabled,
  questionScopedActions: QUESTION_SCOPED_ACTIONS,
  nonRetryableDiagnostics: NON_RETRYABLE_DIAGNOSTICS,
  questionHash,
  matching,
  updateStatus,
  broadcastToPopup,
  answerFeedbackUi,
  answerActions,
  sendQuestionToBackend,
  recordDiagnostic,
  log,
  warn,
  showErrorToast
}).register();

window.addEventListener('kahootGameReset', event => {
  log('Game reset - clearing state');
  clearCurrentQuestion(event.detail?.status || 'Waiting for the next quiz question.');
  answerFeedbackUi.cleanupOverlays();
  removeStatusIndicator();
});

window.addEventListener('kahootQuestionDataIssue', event => {
  const code = event.detail?.code === 'QUESTION_TITLE_MISSING' ? 'QUESTION_TITLE_MISSING' : 'QUESTION_DATA_UNREADABLE';
  recordDiagnostic(code, { stage: 'detection' });
  const platformName = location.hostname === 'play.blooket.com' ? 'Blooket' : 'Kahoot';
  updateStatus(code === 'QUESTION_TITLE_MISSING' ? 'Question text not detected' : `${platformName} question data unreadable`, 'Wait for the question to finish loading, then reload the game tab if it repeats.');
});

window.addEventListener('kahootAnswerDispatchResult', event => {
  const detail = event.detail || {};
  if (!contentState.currentQuestion || String(detail.questionIndex) !== String(contentState.currentQuestion.questionIndex)) return;
  if (detail.sent) {
    updateStatus('Answer sent over Kahoot connection', 'WebSocket send succeeded; Kahoot acceptance is not confirmed.', { stage: 'sent' });
  } else {
    const diagnosticCode = detail.questionType === 'pin_it'
      ? 'KAHOOT_PIN_WS_NOT_READY'
      : detail.questionType === 'slider'
        ? 'KAHOOT_SLIDER_WS_NOT_READY'
        : 'KAHOOT_WS_NOT_READY';
    const failureDetail = detail.questionType === 'pin_it'
      ? 'The pin is placed on the page. Check the point and submit it manually if needed.'
      : detail.questionType === 'slider'
        ? 'The slider value is set on the page. Check it and submit manually if needed.'
        : 'The answer remains highlighted on the page. Reconnect, then try again.';
    recordDiagnostic(diagnosticCode, { stage: 'kahoot' });
    updateStatus('Kahoot connection is not ready', failureDetail, {
      stage: 'send_failed', questionType: detail.questionType
    });
  }
});

window.addEventListener('kahootNonScoredQuestion', (event) => {
  log(`Non-scored question (${event.detail?.type}) - clearing status`);
  clearCurrentQuestion('Waiting for a scored question.');
  removeStatusIndicator();
  answerFeedbackUi.cleanupOverlays();
});

(function watchNavigation() {
  const GAME_PATHS = ['/gameblock', '/getready', '/start'];
  let lastPath = location.pathname;
  let checkTimer = null;
  const checkPath = () => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      const path = location.pathname;
      if (path === lastPath) return;
      lastPath = path;
      const inGame = location.hostname === 'play.blooket.com'
        ? path.includes('/play')
        : GAME_PATHS.some(p => path.includes(p));
      if (!inGame) {
        log(`Left game screen (${path}) - clearing status`);
        clearCurrentQuestion('Waiting for a live quiz question.');
        removeStatusIndicator();
        answerFeedbackUi.cleanupOverlays();
      }
    }, 0);
  };

  window.addEventListener('popstate', checkPath);
  window.addEventListener('hashchange', checkPath);
  window.addEventListener('pageshow', checkPath);
  if (window.navigation?.addEventListener) {
    window.navigation.addEventListener('currententrychange', checkPath);
  } else {
    setInterval(checkPath, 5000);
  }
})();

globalThis.UwUKahootAIQuestionPreparation.create({
  state: contentState,
  questionHash,
  createSolveId,
  cancelActiveRequest,
  sendQuestionToBackend,
  advanceSubmitNonce,
  removeTimerOverlay,
  broadcastToPopup,
  updateStatus,
  answerFeedbackUi,
  getExpectedChoiceCount,
  captureAnswerChoiceSnapshot,
  pollForAnswerChoices,
  pollForJumbleTiles,
  probeSliderConfigFast,
  pollForImageLabels,
  recordDiagnostic,
  log,
  warn,
  isInitialSettingsLoaded: () => initialSettingsLoaded,
  isPluginEnabled: () => cachedSettings.pluginEnabled,
  getInitialSettingsPromise: () => initialSettingsPromise
});




}
