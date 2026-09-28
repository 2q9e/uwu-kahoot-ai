import { getQuizPlatform, isCurrentQuizTabMessage } from './kahoot-tab-state.js';
import { createLiveSessionQuestionView } from './live-session-question-view.js';

export function createLiveSessionQuestion({
  liveStatus,
  liveDetail,
  questionReadiness,
  answerHandoff,
  recordDiagnostic,
  liveEmpty,
  liveQuestion,
  questionText,
  answerText,
  retryAnswerBtn,
  tabsApi = globalThis.chrome?.tabs
}) {
  let hasCurrentQuestion = false;
  let liveStateRevision = 0;
  let pollSequence = 0;
  const view = createLiveSessionQuestionView({
    liveStatus,
    liveDetail,
    questionReadiness,
    answerHandoff,
    liveEmpty,
    liveQuestion,
    questionText,
    answerText,
    retryAnswerBtn,
    getHasCurrentQuestion: () => hasCurrentQuestion,
    setHasCurrentQuestion: value => { hasCurrentQuestion = value; }
  });
  const {
    clearAnswerHandoff,
    clearSelectedQuestion,
    beginReadinessRetry,
    canRetry,
    getReadinessRetryToken,
    setLiveStatus,
    setThinking,
    setWaitingForChoices,
    showAnswer,
    showHandoff,
    showQuestion
  } = view;

  async function pollCurrentQuestion(tabSession, tabId = tabSession.getSelectedTabId()) {
    const pollId = ++pollSequence;
    const revisionAtStart = liveStateRevision;
    const targetTabId = tabId;
    const tab = tabSession.getTabs().find(candidate => candidate.id === targetTabId);
    if (!tab?.id) {
      if (!tabSession.getTabs().length) await tabSession.refreshTabs();
      if (!tabSession.getTabs().length) {
        clearSelectedQuestion();
        setLiveStatus('idle', 'Open a quiz game', 'Open a Kahoot or Blooket tab in any window to see live question status.');
        return;
      }
      return pollCurrentQuestion(tabSession, tabSession.getSelectedTabId());
    }
    const platformName = getQuizPlatform(tab.url) === 'blooket' ? 'Blooket' : 'Kahoot';
    const isCurrentPoll = () => pollId === pollSequence &&
      revisionAtStart === liveStateRevision &&
      tabSession.getSelectedTabId() === targetTabId &&
      tabSession.getTabs().find(candidate => candidate.id === targetTabId)?.url === tab.url;
    let failureCode = 'KAHOOT_TAB_UNAVAILABLE';
    try {
      let connected = false;
      try {
        await tabsApi.sendMessage(tab.id, { action: 'ping' }, { frameId: 0 });
        connected = true;
      } catch (_) {
        try {
          await tabsApi.sendMessage(tab.id, { action: 'ping' });
          connected = true;
        } catch (_) {}
      }
      if (!isCurrentPoll()) return;
      if (!connected) {
        failureCode = 'CONTENT_SCRIPT_DISCONNECTED';
        tabSession.setConnection(tab.id, { url: tab.url, state: 'reload' });
        tabSession.renderTabs();
        throw new Error(`${platformName} content script is not connected.`);
      }
      tabSession.setConnection(tab.id, { url: tab.url, state: 'connected' });
      tabSession.renderTabs();

      if (!isCurrentPoll()) return;
      let response = null;
      try {
        response = await tabsApi.sendMessage(tab.id, { action: 'getQuestion' });
      } catch (_) {
        failureCode = 'CONTENT_SCRIPT_DISCONNECTED';
        throw new Error('The selected tab stopped responding.');
      }
      if (!isCurrentPoll()) return;
      if (response?.question) {
        showQuestion(response.question.title, response.question.type, response.readiness);
        if (response.answer) showAnswer(response.answer);
        else if (response.state === 'error') setLiveStatus('error', 'Answer failed', response.error || 'Try again or check your provider settings.');
        else if (response.state === 'waiting_for_choices') setWaitingForChoices(response.readiness);
        else if (response.state === 'processing') setThinking();
        else setLiveStatus('ready', 'Question detected', 'Waiting for an answer.');
      } else {
        clearSelectedQuestion();
        setLiveStatus('ready', `Connected to ${platformName}`, 'Waiting for a question to appear on this tab.');
      }
    } catch (_) {
      if (!isCurrentPoll()) return;
      recordDiagnostic?.(failureCode, { stage: 'popup' });
      tabSession.setConnection(tab.id, { url: tab.url, state: 'reload' });
      tabSession.renderTabs();
      clearSelectedQuestion();
      setLiveStatus('error', `Reload the ${platformName} tab`, 'Use Reload above to connect this selected page to the extension.');
    }
  }

  function handleRuntimeMessage(request, sender, tabSession) {
    const selectedTab = tabSession.getSelectedTab();
    if (!isCurrentQuizTabMessage(sender.tab, selectedTab)) return;
    if (['resetLiveState', 'updateQuestion', 'updateAnswer', 'updateStatus'].includes(request.action)) {
      liveStateRevision++;
    }
    tabSession.setConnection(selectedTab.id, { url: selectedTab.url, state: 'connected' });
    tabSession.renderTabs();
    if (request.action === 'resetLiveState') {
      clearSelectedQuestion();
      setLiveStatus('idle', 'Waiting for a question', request.status || '');
    }
    if (request.action === 'updateQuestion' && request.question) {
      clearAnswerHandoff();
      showQuestion(request.question.title, request.question.type, request.readiness);
      if (request.state === 'waiting_for_choices') setWaitingForChoices(request.readiness);
      else setThinking();
    }
    if (request.action === 'updateAnswer' && request.answer) showAnswer(request.answer);
    if (request.action === 'updateStatus' && request.status) {
      const state = ['processing', 'waiting_for_choices', 'answered', 'error', 'ready'].includes(request.state) ? request.state : 'ready';
      setLiveStatus(state, request.status, request.detail || '');
      if (request.handoff) showHandoff(request.handoff);
    }
  }

  async function retryAnswer(tabSession) {
    if (!hasCurrentQuestion || !canRetry()) return;
    const readinessRetryToken = getReadinessRetryToken();
    const revisionAtStart = liveStateRevision;
    if (retryAnswerBtn) retryAnswerBtn.disabled = true;
    if (readinessRetryToken) {
      beginReadinessRetry();
    } else {
      setLiveStatus('processing', 'Trying again…', 'Sending the current question to the configured AI provider.');
    }
    try {
      const tab = tabSession.getSelectedTab();
      if (!tab?.id) throw new Error('Choose an open quiz tab first.');
      const result = await tabsApi.sendMessage(tab.id, {
        action: 'manualAnswer',
        ...(readinessRetryToken ? { readinessRetryToken } : {})
      });
      if (!result?.success) throw new Error(result?.message || 'Could not retry this question.');
    } catch (error) {
      if (revisionAtStart !== liveStateRevision) return;
      recordDiagnostic?.('RETRY_REQUEST_FAILED', { stage: 'retry' });
      setLiveStatus('error', 'Could not retry', error.message || 'Refresh the quiz tab and try again.');
    }
  }

  return {
    clearSelectedQuestion,
    get hasCurrentQuestion() { return hasCurrentQuestion; },
    handleRuntimeMessage,
    pollCurrentQuestion,
    retryAnswer,
    setLiveStatus,
    setThinking,
    showAnswer,
    showQuestion
  };
}
