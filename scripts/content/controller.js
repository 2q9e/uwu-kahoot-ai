
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

let currentQuestion = null;
let currentSolveId = null;
let currentAnswer = null;
let questionState = 'idle';
let questionError = null;
let activeRequestId = null;
let lastSentHash = null;
let lastPreparedHash = null;
let loadingEndsAt = 0;
let pendingRetryHash = null;
let hasRetried = false;
let submitNonce = 0;
const QUESTION_SCOPED_ACTIONS = new Set([
  'highlightAnswer', 'placePin', 'reorderJumble', 'setSlider', 'typeOpenEnded', 'showError',
  'getPinImageUrl', 'getQuestionImageUrl'
]);
const CHOICE_QUESTION_TYPES = new Set(['quiz', 'true_false', 'multiple_select_quiz']);

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
        const values = settingsRevision === revisionAtRead ? (s || {}) : { ...(s || {}), ...latestSettingsChanges };
        cachedSettings = {
          highlightOption: values.highlightOption !== false,
          autoClickOption: values.autoClickOption !== false,
          pinHighlightOption: values.pinHighlightOption !== false,
          pinAutoClickOption: !!values.pinAutoClickOption,
          answerDelay: values.answerDelay ?? 0,
          silentMode: !!values.silentMode
        };
        resolve(cachedSettings);
      }
    );
  });
}

chrome.storage.onChanged.addListener((changes, ns) => {
  if (ns !== 'sync') return;
  settingsRevision += 1;
  for (const key of ['highlightOption', 'autoClickOption', 'pinHighlightOption', 'pinAutoClickOption', 'answerDelay', 'silentMode']) {
    if (key in changes) latestSettingsChanges[key] = changes[key].newValue;
  }
  if ('highlightOption' in changes) cachedSettings.highlightOption = changes.highlightOption.newValue !== false;
  if ('autoClickOption' in changes) cachedSettings.autoClickOption = changes.autoClickOption.newValue !== false;
  if ('pinHighlightOption' in changes) cachedSettings.pinHighlightOption = changes.pinHighlightOption.newValue !== false;
  if ('pinAutoClickOption' in changes) cachedSettings.pinAutoClickOption = !!changes.pinAutoClickOption.newValue;
  if ('answerDelay' in changes) cachedSettings.answerDelay = changes.answerDelay.newValue ?? 0;
  if ('silentMode' in changes) cachedSettings.silentMode = !!changes.silentMode.newValue;
  if (changes.silentMode?.newValue) {
    removeStatusIndicator();
    document.getElementById('uwukahootai-timer')?.remove();
  }
});

initialSettingsPromise = refreshSettings().then(() => { initialSettingsLoaded = true; });

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
  broadcastToPopup('updateQuestion', { question: { title: question.title, type: question.type, choices: question.choices || [] } });
  chrome.runtime.sendMessage({ action: 'processQuestion', question, requestId: lastSentHash, solveId: currentSolveId }, response => {
    if (chrome.runtime.lastError) {
      updateStatus('Error: ' + chrome.runtime.lastError.message);
      lastSentHash = null; lastPreparedHash = null;
      return;
    }
    if (response?.error) updateStatus('Error', response.error);
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
          updateStatus('Error: answer did not match current choices', 'Try again or check the provider response.');
          lastSentHash = null;
          sendResponse({ success: false });
          break;
        }
      }

      currentAnswer = answersFromAI.join(', ');
      const shortA = currentAnswer.length > 60 ? currentAnswer.slice(0, 57) + '...' : currentAnswer;
      const timing = request.elapsed ? ` (${request.elapsed})` : '';
      updateStatus(`Answer received ✅${timing}`, shortA);
      broadcastToPopup('updateAnswer', { answer: currentAnswer });
      answerFeedbackUi.cleanupOverlays();
      log(`Answer received (${answersFromAI.length} choice${answersFromAI.length === 1 ? '' : 's'})`);
      highlightAnswers(answersFromAI, request.isMultiSelect, request.options);
      sendResponse({ success: true });
      break;
    }

    case 'getQuestion':
      if (!currentQuestion) return false;
      sendResponse({ question: currentQuestion, answer: currentAnswer, state: questionState, error: questionError });
      break;

    case 'showError':
      {
        const message = typeof request.message === 'string' ? request.message.slice(0, 240) : 'Unknown error';
        updateStatus('Error ❌', message);
        broadcastToPopup('updateStatus', { status: 'Could not answer', detail: message, state: 'error' });
        showErrorToast(message);
        sendResponse({ success: true });
        if (currentQuestion && !hasRetried && !message.includes('API key')) {
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

window.addEventListener('kahootQuestionParsed', async (event) => {
  const q = event.detail;
  if (!q?.title) return;

  const isPin = q.type === 'pin_it';
  const isJumble = q.type === 'jumble';
  const isSlider = q.type === 'slider';
  const isOpenEnded = q.type === 'open_ended';
  const isChoiceQuestion = CHOICE_QUESTION_TYPES.has(q.type);

  if (!isPin && !isJumble && !isSlider && !isOpenEnded && !isChoiceQuestion) return;

  const incomingHash = questionHash(q);
  if (lastSentHash === incomingHash) {
    log('Dedup: skipping duplicate question event');
    return;
  }

  if (lastPreparedHash === incomingHash) {
    log('Dedup: question is already being prepared');
    return;
  }
  lastPreparedHash = incomingHash;
  const previousQuestionChoices = Array.isArray(currentQuestion?.choices) ? [...currentQuestion.choices] : [];
  currentSolveId = createSolveId();
  cancelActiveRequest();
  lastSentHash = null;
  pendingRetryHash = null;
  hasRetried = false;
  currentQuestion = {
    title: q.title,
    choices: q.choices || [],
    type: q.type,
    questionIndex: q.questionIndex,
    imageUrl: q.imageUrl,
    ...(q.sliderConfig ? { sliderConfig: q.sliderConfig } : {})
  };
  currentAnswer = null;
  questionState = isChoiceQuestion ? 'waiting_for_choices' : 'processing';
  questionError = null;
  advanceSubmitNonce();
  const preparationNonce = submitNonce;
  removeTimerOverlay();
  broadcastToPopup('updateQuestion', {
    question: { title: q.title, type: q.type, choices: q.choices || [] },
    state: questionState
  });
  updateStatus('Preparing question…');
  const settingsPromise = initialSettingsLoaded ? null : initialSettingsPromise;

  loadingEndsAt = 0;
  const readLoadingDuration = () => {
    const loadBar = document.querySelector('[data-functional-selector="loading-bar-progress"]');
    if (!loadBar) return false;
    const cs = getComputedStyle(loadBar);
    const dur = parseFloat(cs.getPropertyValue('--animation-duration')) || 0;
    const del = parseFloat(cs.getPropertyValue('--animation-delay')) || 0;
    if (dur + del <= 0) return false;
    const introBuffer = 1500;
    loadingEndsAt = Date.now() + dur + del + introBuffer;
    log(`Loading bar found: ${dur}+${del}+${introBuffer}ms buffer = ${dur + del + introBuffer}ms total`);
    return true;
  };
  for (let attempt = 0; attempt < 10; attempt++) {
    if (preparationNonce !== submitNonce || lastPreparedHash !== incomingHash) {
      log('Discarding loading timing from an outdated question.');
      return;
    }
    if (readLoadingDuration()) break;
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 50));
  }

  answerFeedbackUi.cleanupOverlays();

  if (isChoiceQuestion) {
    updateStatus('Waiting for on-screen answers…', 'The AI request starts after Kahoot displays the choices.');
    const choiceWaitNonce = submitNonce;
    const expectedChoices = getExpectedChoiceCount(q.type, q.choices);
    const domChoices = await pollForAnswerChoices(expectedChoices, choiceWaitNonce, q.choices, previousQuestionChoices);
    if (choiceWaitNonce !== submitNonce || lastPreparedHash !== incomingHash) {
      log('Discarding answer choices from an outdated question.');
      return;
    }
    if (domChoices.length >= 2) {
      q.choices = domChoices;
      log(`Visible answer choices confirmed: ${domChoices.length}`);
    } else {
      lastPreparedHash = null;
      currentSolveId = null;
      currentQuestion.choices = q.choices || [];
      questionState = 'waiting_for_choices';
      const requirement = expectedChoices > 0 ? `the ${expectedChoices} answer choices in Kahoot's question data` : 'at least two readable answer choices';
      updateStatus('Waiting for answer choices', `Kahoot has not shown ${requirement} yet. No AI request was sent.`);
      return;
    }
    currentQuestion.choices = q.choices;
  }

  if (isJumble) {
    const domTiles = await pollForJumbleTiles();
    if (domTiles.length > 0) {
      q.choices = domTiles;
      log(`Jumble tiles read from page: ${domTiles.length}`);
    } else if (!q.choices?.length) {
      warn('No jumble tiles found');
      return;
    }
  }

  if (isSlider) {
    const domSliderConfig = await probeSliderConfigFast();
    q.sliderConfig = {
      min: q.sliderConfig?.min ?? domSliderConfig?.min ?? null,
      max: q.sliderConfig?.max ?? domSliderConfig?.max ?? null,
      step: q.sliderConfig?.step ?? domSliderConfig?.step ?? null,
      unit: q.sliderConfig?.unit || domSliderConfig?.unit || ''
    };
    log('Slider config merged:', q.sliderConfig);
  }

  questionState = 'processing';

  if (settingsPromise) await settingsPromise;

  if (!isPin && !isJumble && !isSlider && !isOpenEnded && q.choices.some(c => !c || /^Image \d+$/.test(c))) {
    const labels = await pollForImageLabels(q.choices.length, submitNonce, q.choices);
    if (preparationNonce !== submitNonce || lastPreparedHash !== incomingHash) {
      log('Discarding image labels from an outdated question.');
      return;
    }
    if (labels.length === q.choices.length && labels.some(l => l && !/^Image \d+$/i.test(l))) {
      q.choices = labels;
    log(`Image choices resolved: ${labels.length}`);
    } else {
      log('Image labels unavailable; retaining numbered choices.');
    }
  }

  const postPollHash = questionHash(q);
  if (lastPreparedHash !== incomingHash) {
    log('Dedup: discarding outdated question preparation');
    return;
  }
  if (lastSentHash === postPollHash) {
    log('Dedup: post-poll duplicate, skipping');
    return;
  }

  currentQuestion = {
    title: q.title,
    choices: q.choices || [],
    type: q.type,
    questionIndex: q.questionIndex,
    imageUrl: q.imageUrl,
    ...(q.sliderConfig ? { sliderConfig: q.sliderConfig } : {})
  };
  questionState = 'processing';
  questionError = null;
  advanceSubmitNonce();
  currentAnswer = null;
  hasRetried = false;
  pendingRetryHash = null;

  sendQuestionToBackend(q);
});




}
