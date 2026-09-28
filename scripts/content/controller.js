
'use strict';

if (window.__UwUKahootAIContentLoaded) {
  console.log('%c[UwU Kahoot AI]', 'color:#c026d3;font-weight:bold', 'Content script already loaded in this frame');
} else {
  window.__UwUKahootAIContentLoaded = true;

const script = document.createElement('script');
script.src = chrome.runtime.getURL('scripts/content/page-bridge.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

const TAG = '[UwU Kahoot AI]';
const STYLE = 'color:#c026d3;font-weight:bold';
const log = (...args) => console.log(`%c${TAG}`, STYLE, ...args);
const warn = (...args) => console.warn(`%c${TAG}`, STYLE, ...args);

function recordDiagnostic(code, metadata = {}) {
  try { chrome.runtime.sendMessage({ action: 'recordDiagnostic', code, metadata }).catch(() => {}); }
  catch (_) {}
}

let currentQuestion = null;
let currentSolveId = null;
let currentAnswer = null;
let questionState = 'idle';
let questionError = null;
let currentQuestionReadiness = null;
let activeRequestId = null;
let lastSentHash = null;
let lastPreparedHash = null;
let loadingEndsAt = 0;
let pendingRetryHash = null;
let hasRetried = false;
let submitNonce = 0;
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
  getCurrentQuestion: () => currentQuestion,
  getQuestionState: () => questionState,
  setQuestionState: (state, error) => {
    questionState = state;
    questionError = error;
  },
  broadcastToPopup
});
const { updateStatus, removeStatusIndicator, showErrorToast } = statusUi;
const domWaiter = globalThis.UwUKahootAIDomWait.create({ getNonce: () => submitNonce });
const { waitForDomResult, waitForQuestionEvent } = domWaiter;
const questionDom = globalThis.UwUKahootAIQuestionDom.create({
  domAdapter,
  waitForDomResult,
  getNonce: () => submitNonce,
  log
});
const { getExpectedChoiceCount, pollForAnswerChoices, pollForImageLabels, pollForJumbleTiles, probeSliderConfigFast } = questionDom;
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
  getSubmitNonce: () => submitNonce,
  getCurrentQuestion: () => currentQuestion,
  getCurrentAnswer: () => currentAnswer,
  getLoadingEndsAt: () => loadingEndsAt
});
const {
  highlightAnswers,
  extractPinImageUrl,
  extractQuestionImageUrl,
  placePinOnSvg,
  solveJumbleFromDOM,
  dispatchOpenEndedAnswer,
  solveSliderFromDOM
} = answerActions;
let settingsRevision = 0;
let latestSettingsChanges = {};
let initialSettingsLoaded = false;
let initialSettingsPromise;

const CONTENT_SETTING_NORMALIZERS = {
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
  submitNonce++;
  domWaiter.cancelAll();
}

function refreshSettings() {
  const revisionAtRead = settingsRevision;
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['highlightOption', 'autoClickOption', 'pinHighlightOption', 'pinAutoClickOption', 'answerDelay', 'silentMode'],
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
  settingsRevision += 1;
  for (const [key, normalize] of Object.entries(CONTENT_SETTING_NORMALIZERS)) {
    if (!(key in changes)) continue;
    const value = changes[key].newValue;
    latestSettingsChanges[key] = value;
    cachedSettings[key] = normalize(value);
  }
  if (cachedSettings.silentMode) {
    removeStatusIndicator();
    document.getElementById('uwukahootai-timer')?.remove();
  }
});

initialSettingsPromise = refreshSettings().then(() => { initialSettingsLoaded = true; });

window.addEventListener('error', event => recordDiagnostic('CONTENT_SCRIPT_UNHANDLED_ERROR', { stage: 'content', errorName: event.error?.name }));
window.addEventListener('unhandledrejection', event => recordDiagnostic('CONTENT_SCRIPT_UNHANDLED_ERROR', { stage: 'content', errorName: event.reason?.name }));

function questionHash(q) {
  return JSON.stringify({
    t: q.title,
    c: q.choices || [],
    type: q.type || '',
    index: q.questionIndex ?? null
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
  const requestId = activeRequestId;
  if (!requestId) return;
  activeRequestId = null;
  try { chrome.runtime.sendMessage({ action: 'cancelQuestion', requestId }).catch(() => {}); } catch (_) {}
}

function clearCurrentQuestion(status) {
  cancelActiveRequest();
  currentQuestion = null;
  currentSolveId = null;
  currentAnswer = null;
  questionState = 'idle';
  questionError = null;
  currentQuestionReadiness = null;
  activeRequestId = null;
  lastSentHash = null;
  lastPreparedHash = null;
  pendingRetryHash = null;
  hasRetried = false;
  advanceSubmitNonce();
  removeTimerOverlay();
  broadcastToPopup('resetLiveState', { status });
}

function sendQuestionToBackend(question) {
  const choices = question.choices || [];
  if (CHOICE_QUESTION_TYPES.has(question.type) && (
    choices.length < 2 || choices.some(choice => !String(choice || '').trim()) || questionState === 'waiting_for_choices'
  )) {
    updateStatus('Waiting for answer choices', 'No AI request was sent because Kahoot has not displayed the complete answer set yet.');
    return false;
  }
  currentSolveId ||= createSolveId();
  lastSentHash = questionHash(question);
  activeRequestId = lastSentHash;
  questionState = 'processing';
  questionError = null;
  const shortQ = question.title.length > 60 ? question.title.slice(0, 57) + '...' : question.title;
  updateStatus('Sending to AI...', shortQ);
  broadcastToPopup('updateQuestion', {
    question: { title: question.title, type: question.type, choices: question.choices || [] },
    state: 'processing',
    readiness: currentQuestionReadiness
  });
  chrome.runtime.sendMessage({ action: 'processQuestion', question, requestId: lastSentHash, solveId: currentSolveId }, response => {
    if (chrome.runtime.lastError) {
      recordDiagnostic('BACKGROUND_WORKER_UNAVAILABLE', { stage: 'content' });
      updateStatus('Error: extension background did not respond', 'Reload the extension, then reload the Kahoot tab.');
      lastSentHash = null; lastPreparedHash = null;
      return;
    }
    if (response?.error) {
      recordDiagnostic(response.diagnosticCode || 'UNCLASSIFIED_ERROR', { stage: 'background' });
      updateStatus(`Error: ${response.error}`, response.suggestion || 'Open Debug details for recovery guidance.');
    }
  });
  return true;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.requestId && QUESTION_SCOPED_ACTIONS.has(request.action) &&
      (!currentQuestion || request.requestId !== questionHash(currentQuestion) || request.requestId !== activeRequestId)) {
    sendResponse({ success: false, stale: true });
    return false;
  }

  switch (request.action) {
    case 'ping':
      sendResponse({ connected: true });
      break;

    case 'answerProgress': {
      const handoff = {
        stage: request.event,
        provider: request.provider,
        model: request.model,
        attempt: request.attempt,
        httpStatus: request.httpStatus,
        nextProvider: request.nextProvider,
        nextModel: request.nextModel
      };
      const providerName = ({ openai: 'OpenAI', gemini: 'Google AI Studio', openrouter: 'OpenRouter' })[request.provider] || 'AI provider';
      const nextName = ({ openai: 'OpenAI', gemini: 'Google AI Studio', openrouter: 'OpenRouter' })[request.nextProvider] || 'AI provider';
      if (request.event === 'attempt') {
        updateStatus(`Contacting ${providerName}…`, request.model || 'Checking configured model', handoff);
      } else if (request.event === 'success') {
        updateStatus(`Answer generated by ${providerName}`, request.model || '', handoff);
      } else if (request.event === 'failed' && request.nextProvider) {
        const reason = request.httpStatus ? `HTTP ${request.httpStatus}` : 'request error';
        updateStatus(`${providerName} failed · trying ${nextName}`, `${reason} · ${request.nextModel || ''}`, handoff);
      } else if (request.event === 'failed') {
        updateStatus(`${providerName} request failed`, request.httpStatus ? `HTTP ${request.httpStatus}` : 'No alternate provider was available.', handoff);
      }
      sendResponse({ success: true });
      break;
    }

    case 'highlightAnswer': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);

      const answersFromAI = request.answers || [];

      const currentChoices = currentQuestion?.choices || [];
      if (currentChoices.length > 0 && answersFromAI.length > 0) {
        const validAnswerSet = matching.validateAnswerSet(currentChoices, answersFromAI, !!request.isMultiSelect);
        if (!validAnswerSet) {
          warn('A stale or ambiguous answer was rejected.');
          recordDiagnostic('ANSWER_NO_MATCH', { stage: 'matching' });
          updateStatus('Error: answer did not match current choices', 'Try again or check the provider response.');
          lastSentHash = null;
          sendResponse({ success: false });
          break;
        }
      }

      currentAnswer = answersFromAI.join(', ');
      const shortA = currentAnswer.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer;
      const timing = request.elapsed ? ` (${request.elapsed})` : '';
      updateStatus(`Answer received ✅${timing}`, shortA, { stage: 'matching' });
      broadcastToPopup('updateAnswer', { answer: currentAnswer });
      answerFeedbackUi.cleanupOverlays();
      log(`Answer received (${answersFromAI.length} choice${answersFromAI.length === 1 ? '' : 's'})`);
      highlightAnswers(answersFromAI, request.isMultiSelect, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'getQuestion':
      if (!currentQuestion) return false;
      sendResponse({ question: currentQuestion, answer: currentAnswer, state: questionState, error: questionError, readiness: currentQuestionReadiness });
      break;

    case 'showError':
      {
        const message = typeof request.message === 'string' ? request.message.slice(0, 160) : 'Question processing failed';
        const suggestion = typeof request.suggestion === 'string' ? request.suggestion.slice(0, 240) : 'Open Debug details for recovery guidance.';
        updateStatus(`Error ❌ · ${message}`, suggestion);
        broadcastToPopup('updateStatus', { status: `Could not answer · ${message}`, detail: suggestion, state: 'error' });
        showErrorToast(`${message}. ${suggestion}`);
        sendResponse({ success: true });
        if (currentQuestion && !hasRetried && !NON_RETRYABLE_DIAGNOSTICS.has(request.diagnosticCode)) {
          hasRetried = true;
          pendingRetryHash = questionHash(currentQuestion);
          lastSentHash = pendingRetryHash;
          updateStatus('Retrying in 2s...');
          setTimeout(() => {
            if (currentQuestion && pendingRetryHash === questionHash(currentQuestion)) sendQuestionToBackend(currentQuestion);
            pendingRetryHash = null;
          }, 2000);
        } else {
          lastSentHash = null; lastPreparedHash = null;
        }
      }
      break;

    case 'manualAnswer':
      if (!currentQuestion) return false;
      if (questionState === 'waiting_for_choices') {
        sendResponse({ success: false, message: 'Waiting for Kahoot to display the answer choices.' });
        break;
      }
      pendingRetryHash = null;
      hasRetried = false;
      lastSentHash = null;
      updateStatus('Manual retry...', currentQuestion.title);
      sendResponse({
        success: sendQuestionToBackend(currentQuestion),
        message: questionState === 'waiting_for_choices' ? 'Waiting for Kahoot to display the answer choices.' : undefined
      });
      break;

    case 'getPinImageUrl':
      sendResponse({ imageUrl: extractPinImageUrl() });
      break;

    case 'getQuestionImageUrl':
      sendResponse({ imageUrl: extractQuestionImageUrl() });
      break;

    case 'placePin': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `📍 ${request.coords.x.toFixed(1)}%, ${request.coords.y.toFixed(1)}%`;
      updateStatus(`Pin answer ✅${request.elapsed ? ` (${request.elapsed})` : ''}`, currentAnswer);
      broadcastToPopup('updateAnswer', { answer: currentAnswer });
      placePinOnSvg(request.coords, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'reorderJumble': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `🧩 ${request.answerWord}`;
      updateStatus(`Jumble answer ✅${request.elapsed ? ` (${request.elapsed})` : ''}`, currentAnswer);
      broadcastToPopup('updateAnswer', { answer: currentAnswer });
      solveJumbleFromDOM(request.answerWord, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'setSlider': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `🎚️ ${request.value}`;
      updateStatus(`Slider answer ✅${request.elapsed ? ` (${request.elapsed})` : ''}`, currentAnswer);
      broadcastToPopup('updateAnswer', { answer: currentAnswer });
      solveSliderFromDOM(request.value, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'typeOpenEnded': {
      hasRetried = false;
      pendingRetryHash = null;
      if (currentQuestion) lastSentHash = questionHash(currentQuestion);
      currentAnswer = `✏️ ${request.answer}`;
      updateStatus(`Open-ended answer ✅${request.elapsed ? ` (${request.elapsed})` : ''}`, currentAnswer);
      broadcastToPopup('updateAnswer', { answer: currentAnswer });
      dispatchOpenEndedAnswer(request.answer, request.options);
      sendResponse({ success: true });
      break;
    }
  }
  return true;
});

window.addEventListener('kahootGameReset', () => {
  log('Game reset - clearing state');
  clearCurrentQuestion('Waiting for the next Kahoot question.');
  answerFeedbackUi.cleanupOverlays();
  removeStatusIndicator();
});

window.addEventListener('kahootQuestionDataIssue', event => {
  const code = event.detail?.code === 'QUESTION_TITLE_MISSING' ? 'QUESTION_TITLE_MISSING' : 'QUESTION_DATA_UNREADABLE';
  recordDiagnostic(code, { stage: 'detection' });
  updateStatus(code === 'QUESTION_TITLE_MISSING' ? 'Question text not detected' : 'Kahoot question data unreadable', 'Wait for the question to finish loading, then reload the Kahoot tab if it repeats.');
});

window.addEventListener('kahootAnswerDispatchResult', event => {
  const detail = event.detail || {};
  if (!currentQuestion || String(detail.questionIndex) !== String(currentQuestion.questionIndex)) return;
  if (detail.sent) {
    updateStatus('Answer sent over Kahoot connection', 'WebSocket send succeeded; Kahoot acceptance is not confirmed.', { stage: 'sent' });
  } else {
    recordDiagnostic('KAHOOT_WS_NOT_READY', { stage: 'kahoot' });
    updateStatus('Kahoot connection is not ready', 'The answer remains highlighted on the page. Reconnect, then try again.', { stage: 'send_failed' });
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
      const inGame = GAME_PATHS.some(p => path.includes(p));
      if (!inGame) {
        log(`Left game screen (${path}) - clearing status`);
        clearCurrentQuestion('Waiting for a live Kahoot question.');
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

const questionPreparationState = {
  get currentQuestion() { return currentQuestion; },
  set currentQuestion(value) { currentQuestion = value; },
  get currentSolveId() { return currentSolveId; },
  set currentSolveId(value) { currentSolveId = value; },
  get currentAnswer() { return currentAnswer; },
  set currentAnswer(value) { currentAnswer = value; },
  get questionState() { return questionState; },
  set questionState(value) { questionState = value; },
  get questionError() { return questionError; },
  set questionError(value) { questionError = value; },
  get currentQuestionReadiness() { return currentQuestionReadiness; },
  set currentQuestionReadiness(value) { currentQuestionReadiness = value; },
  get lastSentHash() { return lastSentHash; },
  set lastSentHash(value) { lastSentHash = value; },
  get lastPreparedHash() { return lastPreparedHash; },
  set lastPreparedHash(value) { lastPreparedHash = value; },
  get pendingRetryHash() { return pendingRetryHash; },
  set pendingRetryHash(value) { pendingRetryHash = value; },
  get hasRetried() { return hasRetried; },
  set hasRetried(value) { hasRetried = value; },
  get submitNonce() { return submitNonce; },
  set submitNonce(value) { submitNonce = value; },
  get loadingEndsAt() { return loadingEndsAt; },
  set loadingEndsAt(value) { loadingEndsAt = value; }
};

globalThis.UwUKahootAIQuestionPreparation.create({
  state: questionPreparationState,
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
  pollForAnswerChoices,
  pollForJumbleTiles,
  probeSliderConfigFast,
  pollForImageLabels,
  recordDiagnostic,
  log,
  warn,
  isInitialSettingsLoaded: () => initialSettingsLoaded,
  getInitialSettingsPromise: () => initialSettingsPromise
});




}
