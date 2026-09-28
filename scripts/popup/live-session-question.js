import { isCurrentKahootTabMessage } from './kahoot-tab-state.js';

const TYPE_LABELS = {
  quiz: 'MCQ', true_false: 'T/F', multiple_select_quiz: 'Multi',
  pin_it: 'Pin', jumble: 'Jumble', slider: 'Slider', open_ended: 'Open'
};

export function createLiveSessionQuestion({
  liveStatus,
  liveDetail,
  questionReadiness,
  liveEmpty,
  liveQuestion,
  questionText,
  answerText,
  retryAnswerBtn,
  tabsApi = globalThis.chrome?.tabs
}) {
  let hasCurrentQuestion = false;

  function showReadiness(readiness) {
    if (!questionReadiness) return;
    if (!readiness?.choicesRequired) {
      questionReadiness.textContent = '';
      questionReadiness.classList.add('hidden');
      questionReadiness.removeAttribute('data-ready');
      return;
    }
    const expected = Math.max(2, Number(readiness.expectedChoiceCount) || 2);
    const received = Math.max(0, Number(readiness.dataChoiceCount) || 0);
    const visible = Math.max(0, Number(readiness.visibleChoiceCount) || 0);
    if (readiness.choicesReady) {
      questionReadiness.textContent = `Choice set ready · ${visible || received} answer choices`;
      questionReadiness.dataset.ready = 'true';
    } else if (visible > 0) {
      questionReadiness.textContent = `Page choices · ${visible} of ${expected} required · waiting before AI request`;
      questionReadiness.dataset.ready = 'false';
    } else if (received > 0) {
      questionReadiness.textContent = `${received} choice${received === 1 ? '' : 's'} received · checking the page for at least ${expected}`;
      questionReadiness.dataset.ready = 'false';
    } else {
      questionReadiness.textContent = `No answer choices received · checking the page for at least ${expected}`;
      questionReadiness.dataset.ready = 'false';
    }
    questionReadiness.classList.remove('hidden');
  }

  function setLiveStatus(state, label, detail = '') {
    if (liveStatus) {
      liveStatus.textContent = label;
      liveStatus.className = `live-status state-${state}`;
    }
    if (liveDetail) liveDetail.textContent = detail;
    if (retryAnswerBtn) retryAnswerBtn.disabled = !hasCurrentQuestion || state === 'processing' || state === 'waiting_for_choices';
  }

  function showQuestion(title, type, readiness) {
    if (!title) return;
    hasCurrentQuestion = true;
    liveEmpty?.classList.add('hidden');
    liveQuestion?.classList.remove('hidden');
    if (retryAnswerBtn) retryAnswerBtn.disabled = false;
    const badge = type && TYPE_LABELS[type] ? `${TYPE_LABELS[type]} · ` : '';
    if (questionText) {
      questionText.textContent = badge + title;
      questionText.classList.add('active');
    }
    showReadiness(readiness);
  }

  function showAnswer(answer) {
    if (!answer) return;
    hasCurrentQuestion = true;
    liveEmpty?.classList.add('hidden');
    liveQuestion?.classList.remove('hidden');
    if (answerText) {
      answerText.textContent = answer;
      answerText.classList.remove('thinking');
      answerText.classList.add('active');
    }
    setLiveStatus('answered', 'Answer ready', 'Review the suggestion before submitting.');
  }

  function setThinking() {
    if (answerText) {
      answerText.textContent = 'Working on it…';
      answerText.classList.add('thinking');
      answerText.classList.remove('active');
    }
    setLiveStatus('processing', 'Finding an answer…', 'The selected provider and any enabled fallback providers may receive this question.');
  }

  function setWaitingForChoices(readiness) {
    if (answerText) {
      answerText.textContent = 'Waiting for Kahoot to show the answer options…';
      answerText.classList.remove('thinking', 'active');
    }
    const expected = Math.max(2, Number(readiness?.expectedChoiceCount) || 2);
    const received = Math.max(0, Number(readiness?.dataChoiceCount) || 0);
    const visible = Math.max(0, Number(readiness?.visibleChoiceCount) || 0);
    const detail = visible
      ? `The page shows ${visible} of at least ${expected} readable choices. No AI request has been sent.`
      : received
        ? `${received} choice${received === 1 ? '' : 's'} arrived in Kahoot data. Checking the page for at least ${expected}; no AI request has been sent.`
        : `No choices arrived yet. Checking the page for at least ${expected}; no AI request has been sent.`;
    setLiveStatus('waiting_for_choices', 'Waiting for answer options', detail);
    showReadiness(readiness);
  }

  function clearSelectedQuestion() {
    hasCurrentQuestion = false;
    if (retryAnswerBtn) retryAnswerBtn.disabled = true;
    liveEmpty?.classList.remove('hidden');
    liveQuestion?.classList.add('hidden');
    questionReadiness?.classList.add('hidden');
    if (questionText) questionText.textContent = '';
    if (answerText) {
      answerText.textContent = 'Waiting for a response';
      answerText.classList.remove('thinking', 'active');
    }
  }

  async function pollCurrentQuestion(tabSession, tabId = tabSession.getSelectedTabId()) {
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
      if (tabSession.getSelectedTabId() !== targetTabId) return;
      if (tabSession.getTabs().find(candidate => candidate.id === targetTabId)?.url !== tab.url) return;
      if (!connected) {
        tabSession.setConnection(tab.id, { url: tab.url, state: 'reload' });
        tabSession.renderTabs();
        throw new Error('Kahoot content script is not connected.');
      }
      tabSession.setConnection(tab.id, { url: tab.url, state: 'connected' });
      tabSession.renderTabs();

      let response = null;
      try {
        response = await tabsApi.sendMessage(tab.id, { action: 'getQuestion' });
      } catch (_) {}
      if (tabSession.getSelectedTabId() !== targetTabId) return;
      if (tabSession.getTabs().find(candidate => candidate.id === targetTabId)?.url !== tab.url) return;
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
      if (tabSession.getSelectedTabId() !== targetTabId) return;
      clearSelectedQuestion();
      setLiveStatus('error', 'Reload the Kahoot tab', 'Use Reload above to connect this selected page to the extension.');
    }
  }

  function handleRuntimeMessage(request, sender, tabSession) {
    const selectedTab = tabSession.getSelectedTab();
    if (!isCurrentKahootTabMessage(sender.tab, selectedTab)) return;
    tabSession.setConnection(selectedTab.id, { url: selectedTab.url, state: 'connected' });
    tabSession.renderTabs();
    if (request.action === 'resetLiveState') {
      hasCurrentQuestion = false;
      liveQuestion?.classList.add('hidden');
      liveEmpty?.classList.remove('hidden');
      if (questionText) questionText.textContent = '';
      if (answerText) {
        answerText.textContent = 'Waiting for a response';
        answerText.classList.remove('thinking', 'active');
      }
      setLiveStatus('idle', 'Waiting for a question', request.status || '');
    }
    if (request.action === 'updateQuestion' && request.question) {
      showQuestion(request.question.title, request.question.type, request.readiness);
      if (request.state === 'waiting_for_choices') setWaitingForChoices(request.readiness);
      else setThinking();
    }
    if (request.action === 'updateAnswer' && request.answer) showAnswer(request.answer);
    if (request.action === 'updateStatus' && request.status) {
      const state = ['processing', 'waiting_for_choices', 'answered', 'error', 'ready'].includes(request.state) ? request.state : 'ready';
      setLiveStatus(state, request.status, request.detail || '');
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
