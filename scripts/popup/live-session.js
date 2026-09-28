import { createLiveSessionQuestion } from './live-session-question.js';
import { createLiveSessionTabs } from './live-session-tabs.js';

const liveStatus = document.getElementById('liveStatus');
const liveDetail = document.getElementById('liveDetail');
const questionReadiness = document.getElementById('questionReadiness');
const liveEmpty = document.getElementById('liveEmpty');
const liveQuestion = document.getElementById('liveQuestion');
const questionText = document.getElementById('questionText');
const answerText = document.getElementById('answerText');
const retryAnswerBtn = document.getElementById('retryAnswer');
const openDashboardBtn = document.getElementById('openDashboard');
const kahootTabSelect = document.getElementById('kahootTabSelect');
const kahootTabCount = document.getElementById('kahootTabCount');
const kahootAttachStatus = document.getElementById('kahootAttachStatus');
const focusKahootTabBtn = document.getElementById('focusKahootTab');
const reloadKahootTabBtn = document.getElementById('reloadKahootTab');

const question = createLiveSessionQuestion({
  liveStatus,
  liveDetail,
  questionReadiness,
  liveEmpty,
  liveQuestion,
  questionText,
  answerText,
  retryAnswerBtn
});

let sessionTabs;
sessionTabs = createLiveSessionTabs({
  kahootTabSelect,
  kahootTabCount,
  kahootAttachStatus,
  focusKahootTabBtn,
  reloadKahootTabBtn,
  clearSelectedQuestion: question.clearSelectedQuestion,
  setLiveStatus: question.setLiveStatus,
  pollCurrentQuestion: tabId => question.pollCurrentQuestion(sessionTabs, tabId)
});

chrome.runtime.onMessage.addListener((request, sender) => {
  question.handleRuntimeMessage(request, sender, sessionTabs);
});

retryAnswerBtn?.addEventListener('click', () => question.retryAnswer(sessionTabs));

openDashboardBtn?.addEventListener('click', async () => {
  openDashboardBtn.disabled = true;
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
    window.close();
  } catch (_) {
    openDashboardBtn.disabled = false;
    question.setLiveStatus('error', 'Could not open dashboard', 'Try opening the extension popup again.');
  }
});

export function setLiveStatus(state, label, detail = '') {
  question.setLiveStatus(state, label, detail);
}

export async function initializeLiveSession() {
  await sessionTabs.initialize();
}
