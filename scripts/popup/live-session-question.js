import { isCurrentKahootTabMessage } from './kahoot-tab-state.js';
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
        setLiveStatus('idle', 'Open a Kahoot game', 'Open a Kahoot tab in any window to see live question status.');
        return;
      }
      return pollCurrentQuestion(tabSession, tabSession.getSelectedTabId());
    }
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
        throw new Error('Kahoot content script is not connected.');
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
        setLiveStatus('ready', 'Connected to Kahoot', 'Waiting for a question. If one is already on screen, the host must enable “Show questions & answers on players’ devices.”');
      }
    } catch (_) {
      if (!isCurrentPoll()) return;
      recordDiagnostic?.(failureCode, { stage: 'popup' });
      tabSession.setConnection(tab.id, { url: tab.url, state: 'reload' });
      tabSession.renderTabs();
      clearSelectedQuestion();
      setLiveStatus('error', 'Reload the Kahoot tab', 'Use Reload above to connect this selected page to the extension.');
    }
  }

  function handleRuntimeMessage(request, sender, tabSession) {
    const selectedTab = tabSession.getSelectedTab();
    if (!isCurrentKahootTabMessage(sender.tab, selectedTab)) return;
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
    if (!hasCurrentQuestion) return;
    if (retryAnswerBtn) retryAnswerBtn.disabled = true;
    setLiveStatus('processing', 'Trying again…', 'Sending the current question to the configured AI provider.');
    try {
      const tab = tabSession.getSelectedTab();
      if (!tab?.id) throw new Error('Choose an open Kahoot tab first.');
      const result = await tabsApi.sendMessage(tab.id, { action: 'manualAnswer' });
      if (!result?.success) throw new Error(result?.message || 'Could not retry this question.');
    } catch (error) {
      recordDiagnostic?.('RETRY_REQUEST_FAILED', { stage: 'retry' });
      setLiveStatus('error', 'Could not retry', error.message || 'Refresh the Kahoot tab and try again.');
      if (retryAnswerBtn) retryAnswerBtn.disabled = !hasCurrentQuestion;
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
