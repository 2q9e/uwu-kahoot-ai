import { createLiveSessionQuestion } from './live-session-question.js';
import { createLiveSessionTabs } from './live-session-tabs.js';

const liveStatus = document.getElementById('liveStatus');
const liveDetail = document.getElementById('liveDetail');
const questionReadiness = document.getElementById('questionReadiness');
const answerHandoff = document.getElementById('answerHandoff');
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
const diagnosticsPanel = document.getElementById('diagnosticsPanel');
const diagnosticsCount = document.getElementById('diagnosticsCount');
const diagnosticsList = document.getElementById('diagnosticsList');
const diagnosticsEmpty = document.getElementById('diagnosticsEmpty');
const diagnosticReport = document.getElementById('diagnosticReport');
const selectDiagnosticReportBtn = document.getElementById('selectDiagnosticReport');
const clearDiagnosticsBtn = document.getElementById('clearDiagnostics');
const diagnosticsActionStatus = document.getElementById('diagnosticsActionStatus');
const DIAGNOSTICS_STORAGE_KEY = 'uwuKahootDiagnosticsV1';
let diagnosticEvents = [];
let diagnosticsRevision = 0;

function recordDiagnostic(code, metadata = {}) {
  try { chrome.runtime.sendMessage({ action: 'recordDiagnostic', code, metadata }).catch(() => {}); }
  catch (_) {}
}

function renderDiagnostics() {
  if (!diagnosticsList) return;
  const events = diagnosticEvents.filter(event => event && typeof event === 'object').slice(0, 50);
  diagnosticsList.replaceChildren();
  diagnosticsCount.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;
  diagnosticsEmpty.classList.toggle('hidden', events.length > 0);
  selectDiagnosticReportBtn.disabled = events.length === 0;
  clearDiagnosticsBtn.disabled = events.length === 0;
  for (const event of events) {
    const item = document.createElement('li');
    item.className = 'diagnostic-event';
    const head = document.createElement('div');
    head.className = 'diagnostic-event-head';
    const title = document.createElement('span');
    title.textContent = String(event.title || 'Extension diagnostic').slice(0, 120);
    const time = document.createElement('time');
    const date = new Date(event.time);
    time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
    head.append(title, time);
    item.append(head);
    const detail = document.createElement('p');
    detail.textContent = String(event.detail || '').slice(0, 220);
    item.append(detail);
    const recovery = document.createElement('p');
    recovery.className = 'diagnostic-recovery';
    recovery.textContent = `Try: ${String(event.recovery || '').slice(0, 220)}`;
    item.append(recovery);
    const metadata = [
      event.code,
      event.stage && `stage ${event.stage}`,
      event.provider && `provider ${event.provider}`,
      event.model && `model ${event.model}`,
      event.httpStatus && `HTTP ${event.httpStatus}`,
      event.attempt && `attempt ${event.attempt}`,
      event.errorName && `error ${event.errorName}`,
      event.dataChoiceCount != null && `data choices ${event.dataChoiceCount}`,
      event.visibleChoiceCount != null && `page choices ${event.visibleChoiceCount}`,
      event.expectedChoiceCount != null && `expected ${event.expectedChoiceCount}`
    ].filter(Boolean).join(' · ');
    if (metadata) {
      const meta = document.createElement('p');
      meta.className = 'diagnostic-meta';
      meta.textContent = metadata;
      item.append(meta);
    }
    diagnosticsList.append(item);
  }
}

async function loadDiagnostics() {
  const revision = diagnosticsRevision;
  try {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_STORAGE_KEY);
    if (revision !== diagnosticsRevision) return;
    diagnosticEvents = Array.isArray(stored[DIAGNOSTICS_STORAGE_KEY]) ? stored[DIAGNOSTICS_STORAGE_KEY] : [];
    renderDiagnostics();
  } catch (_) {
    if (revision !== diagnosticsRevision) return;
    diagnosticsActionStatus.textContent = 'Debug history could not be loaded. Check extension storage and reload the extension.';
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !(DIAGNOSTICS_STORAGE_KEY in changes)) return;
  diagnosticsRevision += 1;
  diagnosticEvents = Array.isArray(changes[DIAGNOSTICS_STORAGE_KEY].newValue)
    ? changes[DIAGNOSTICS_STORAGE_KEY].newValue
    : [];
  renderDiagnostics();
});

selectDiagnosticReportBtn?.addEventListener('click', () => {
  const report = diagnosticEvents.map(event => {
    const date = new Date(event.time);
    const time = Number.isNaN(date.getTime()) ? '' : date.toISOString();
    const metadata = [event.stage && `stage=${event.stage}`, event.provider && `provider=${event.provider}`, event.model && `model=${event.model}`, event.httpStatus && `http=${event.httpStatus}`, event.attempt && `attempt=${event.attempt}`].filter(Boolean).join(' ');
    return [time, event.code, event.title, event.detail, `Recovery: ${event.recovery}`, metadata, event.errorName && `error=${event.errorName}`].filter(Boolean).join('\n');
  }).join('\n\n');
  diagnosticReport.value = report;
  diagnosticReport.classList.remove('hidden');
  diagnosticReport.focus();
  diagnosticReport.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (_) {}
  diagnosticsActionStatus.textContent = copied
    ? 'Sanitized report copied.'
    : 'Report selected. Press Ctrl+C or Command+C to copy.';
});

clearDiagnosticsBtn?.addEventListener('click', async () => {
  clearDiagnosticsBtn.disabled = true;
  try {
    await chrome.storage.local.set({ [DIAGNOSTICS_STORAGE_KEY]: [] });
    diagnosticReport.classList.add('hidden');
    diagnosticsActionStatus.textContent = 'Debug history cleared.';
  } catch (_) {
    diagnosticsActionStatus.textContent = 'Could not clear debug history. Check extension storage.';
    clearDiagnosticsBtn.disabled = false;
  }
});

if (diagnosticsPanel) void loadDiagnostics();

const question = createLiveSessionQuestion({
  liveStatus,
  liveDetail,
  questionReadiness,
  answerHandoff,
  recordDiagnostic,
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
