import { DEFAULT_MODEL, DEFAULT_VISION_MODEL, DEPRECATED_MODELS } from '../core/constants.js';
import { isSupportedQuizUrl } from '../core/quiz-platform.js';
import { recordProviderUsageInBackground } from '../core/provider-usage.js';
import { classifyAiFailure, createDiagnosticRecord, diagnosticPresentation, DIAGNOSTICS_STORAGE_KEY } from './diagnostics.js';
import { createQuestionProcessor } from './question-processor.js';

const TAG = '[UwU Kahoot AI]';
const STYLE = 'color:#c026d3;font-weight:bold';
const log = (...args) => console.log(`%c${TAG}`, STYLE, ...args);
const err = (...args) => console.error(`%c${TAG}`, STYLE, ...args);
const SOLVE_STATS_KEY = 'uwuKahootSolveStats';
let solveStatsWriteQueue = Promise.resolve();
let diagnosticWriteQueue = Promise.resolve();
const activeQuestionRequests = new Map();
let pluginEnabledState = true;
let pluginSettingRevision = 0;

function isExtensionContextInvalidated(error) {
  return /extension context invalidated/i.test(String(error?.message || error || ''));
}

function respondSafely(sendResponse, response) {
  try {
    sendResponse(response);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidated(error)) err('Could not send a response to the requesting tab.');
    return false;
  }
}

Promise.resolve().then(() => chrome.storage.sync.get('pluginEnabled')).then(({ pluginEnabled }) => {
  if (pluginSettingRevision === 0) pluginEnabledState = pluginEnabled !== false;
}).catch(() => {});

function recordDiagnostic(code, metadata = {}) {
  const record = createDiagnosticRecord(code, metadata);
  diagnosticWriteQueue = diagnosticWriteQueue.catch(() => {}).then(async () => {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_STORAGE_KEY);
    const events = Array.isArray(stored[DIAGNOSTICS_STORAGE_KEY]) ? stored[DIAGNOSTICS_STORAGE_KEY] : [];
    const newest = events[0];
    const elapsed = Date.now() - Date.parse(newest?.time || '');
    if (newest?.code === record.code && newest?.stage === record.stage && newest?.provider === record.provider &&
        newest?.httpStatus === record.httpStatus && elapsed >= 0 && elapsed < 5000) return;
    await chrome.storage.local.set({ [DIAGNOSTICS_STORAGE_KEY]: [record, ...events].slice(0, 50) });
  }).catch(error => {
    if (!isExtensionContextInvalidated(error)) err('Diagnostic history could not be saved.');
  });
  return diagnosticWriteQueue;
}

self.addEventListener('error', event => {
  if (isExtensionContextInvalidated(event.error || event.message)) {
    event.preventDefault();
    return;
  }
  void recordDiagnostic('EXTENSION_UNHANDLED_ERROR', { stage: 'background', errorName: event.error?.name });
});
self.addEventListener('unhandledrejection', event => {
  if (isExtensionContextInvalidated(event.reason)) {
    event.preventDefault();
    return;
  }
  void recordDiagnostic('EXTENSION_UNHANDLED_ERROR', { stage: 'background', errorName: event.reason?.name });
});

function recordGeneratedAnswer(solveId, question, answer, responseMs, signal) {
  if (!solveId || signal?.aborted) return Promise.resolve();
  const cleanText = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const title = cleanText(question?.title);
  const answerText = cleanText(answer);
  if (!title || !answerText) return Promise.resolve();
  solveStatsWriteQueue = solveStatsWriteQueue.catch(() => {}).then(async () => {
    if (signal?.aborted) return;
    const stored = await chrome.storage.local.get(SOLVE_STATS_KEY);
    if (signal?.aborted) return;
    const stats = stored[SOLVE_STATS_KEY] && typeof stored[SOLVE_STATS_KEY] === 'object'
      ? stored[SOLVE_STATS_KEY]
      : { totalSolved: 0, totalResponseMs: 0, recent: [], solveIds: [] };
    const solveIds = Array.isArray(stats.solveIds) ? stats.solveIds : [];
    if (solveIds.includes(solveId)) return;

    const duration = Math.max(0, Math.round(Number(responseMs) || 0));
    const record = {
      solveId: String(solveId).slice(0, 180),
      title,
      type: cleanText(question?.type) || 'unknown',
      answer: answerText,
      responseMs: duration,
      solvedAt: new Date().toISOString()
    };
    const next = {
      totalSolved: Math.max(0, Number(stats.totalSolved) || 0) + 1,
      totalResponseMs: Math.max(0, Number(stats.totalResponseMs) || 0) + duration,
      recent: [record, ...(Array.isArray(stats.recent) ? stats.recent : [])].slice(0, 30),
      solveIds: [solveId, ...solveIds].slice(0, 500)
    };
    await chrome.storage.local.set({ [SOLVE_STATS_KEY]: next });
  }).catch(error => {
    // Ignore storage writes that are interrupted while the extension is reloaded.
    if (isExtensionContextInvalidated(error) || !chrome.runtime?.id) return;
    err('Could not save local solve stats.');
    void recordDiagnostic('EXTENSION_STORAGE_ERROR', { stage: 'statistics' });
  });
  return solveStatsWriteQueue;
}

(async () => {
  try {
    const { openaiModel, openaiVisionModel } = await chrome.storage.sync.get(['openaiModel', 'openaiVisionModel']);
    const current = (openaiModel || '').trim().toLowerCase();
    const currentVision = (openaiVisionModel || '').trim().toLowerCase();
    const next = {};
    if (!current || DEPRECATED_MODELS.has(current)) next.openaiModel = DEFAULT_MODEL;
    if (!currentVision || DEPRECATED_MODELS.has(currentVision)) next.openaiVisionModel = DEFAULT_VISION_MODEL;
    if (Object.keys(next).length) {
      await chrome.storage.sync.set(next);
      log(`Migrated model settings`, next);
    }
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return;
    err('Model migration failed.');
    void recordDiagnostic('EXTENSION_STORAGE_ERROR', { stage: 'settings', errorName: error?.name });
  }
})();

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'manual-answer') return;
  chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
    const tab = tabs
      .filter(candidate => isSupportedQuizUrl(candidate.url))
      .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'manualAnswer' }).catch(() => {});
  });
});

function cancelTabQuestionRequests(tabId) {
  if (!Number.isInteger(tabId)) return;
  for (const [scope, active] of activeQuestionRequests) {
    if (active.tabId !== tabId) continue;
    activeQuestionRequests.delete(scope);
    active.controller.abort();
  }
}

chrome.tabs.onRemoved.addListener(tabId => cancelTabQuestionRequests(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) cancelTabQuestionRequests(tabId);
});

function getRequestScope(tabId, frameId) {
  return `${Number.isInteger(tabId) ? tabId : 'unknown'}:${Number.isInteger(frameId) ? frameId : 0}`;
}

function sendToTab(tabId, frameId, action, data = {}) {
  const options = Number.isInteger(frameId) && frameId >= 0 ? { frameId } : undefined;
  try {
    chrome.tabs.sendMessage(tabId, { action, ...data }, options).catch(error => {
      if (isExtensionContextInvalidated(error)) return;
      void recordDiagnostic('CONTENT_SCRIPT_DISCONNECTED', { stage: action === 'answerProgress' ? 'provider' : 'dispatch' });
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return;
    void recordDiagnostic('CONTENT_SCRIPT_DISCONNECTED', { stage: 'dispatch' });
  }
}

function sendToTabAsync(tabId, frameId, action, data = {}) {
  const options = Number.isInteger(frameId) && frameId >= 0 ? { frameId } : undefined;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action, ...data }, options, response => {
      if (chrome.runtime.lastError) {
        void recordDiagnostic('CONTENT_SCRIPT_DISCONNECTED', { stage: action === 'getQuestionImageUrl' || action === 'getPinImageUrl' ? 'image' : 'dispatch' });
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

const handleQuestion = createQuestionProcessor({
  recordGeneratedAnswer,
  recordDiagnostic,
  sendToTab,
  sendToTabAsync,
  log,
  err
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'recordProviderUsage') {
    recordProviderUsageInBackground(msg.provider, msg.model, msg.status, msg.usage || {})
      .then(() => respondSafely(sendResponse, { success: true }))
      .catch(error => {
        if (!isExtensionContextInvalidated(error)) void recordDiagnostic('EXTENSION_STORAGE_ERROR', { stage: 'statistics', errorName: error?.name });
        respondSafely(sendResponse, { success: false });
      });
    return true;
  }

  if (msg.action === 'recordDiagnostic') {
    recordDiagnostic(msg.code, msg.metadata || {})
      .then(() => respondSafely(sendResponse, { success: true }))
      .catch(error => {
        if (!isExtensionContextInvalidated(error)) err('Could not finish recording a diagnostic.');
        respondSafely(sendResponse, { success: false });
      });
    return true;
  }

  if (msg.action === 'cancelQuestion') {
    const scope = getRequestScope(sender.tab?.id, sender.frameId);
    const active = activeQuestionRequests.get(scope);
    const requestId = String(msg.requestId || '');
    const cancelled = !!active && active.requestId === requestId;
    if (cancelled) {
      activeQuestionRequests.delete(scope);
      active.controller.abort();
      log(`Cancelled stale question request ${requestId.slice(0, 12)}`);
    }
    respondSafely(sendResponse, { ok: true, cancelled });
    return false;
  }

  if (msg.action === 'processQuestion') {
    const scope = getRequestScope(sender.tab?.id, sender.frameId);
    const requestId = String(msg.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    activeQuestionRequests.get(scope)?.controller.abort();
    const controller = new AbortController();
    const active = { requestId, controller, tabId: sender.tab?.id };
    activeQuestionRequests.set(scope, active);

    Promise.resolve().then(() => chrome.storage.sync.get('pluginEnabled')).then(({ pluginEnabled }) => {
      if (controller.signal.aborted || activeQuestionRequests.get(scope) !== active) {
        respondSafely(sendResponse, { ok: false, cancelled: true });
        return;
      }
      if (pluginEnabled === false || pluginEnabledState === false) {
        activeQuestionRequests.delete(scope);
        respondSafely(sendResponse, { ok: false, disabled: true });
        return;
      }

      return handleQuestion(msg.question, sender.tab?.id, sender.frameId, requestId, msg.solveId, controller.signal)
        .then(() => respondSafely(sendResponse, { ok: true }))
        .catch(error => {
          if (controller.signal.aborted || error?.name === 'AbortError') {
            respondSafely(sendResponse, { ok: false, cancelled: true });
            return;
          }
          if (isExtensionContextInvalidated(error)) return;
          const code = classifyAiFailure(error, 'background');
          const diagnostic = diagnosticPresentation(code);
          void recordDiagnostic(code, { stage: 'background', httpStatus: error?.status, errorName: error?.name });
          respondSafely(sendResponse, { error: diagnostic.title, suggestion: diagnostic.recovery, diagnosticCode: diagnostic.code });
        })
        .finally(() => {
          if (activeQuestionRequests.get(scope) === active) activeQuestionRequests.delete(scope);
        })
        .catch(error => {
          if (!isExtensionContextInvalidated(error)) err('Question request cleanup failed.');
        });
    }).catch(error => {
      if (!isExtensionContextInvalidated(error)) {
        void recordDiagnostic('EXTENSION_STORAGE_ERROR', { stage: 'settings', errorName: error?.name });
        if (!controller.signal.aborted && activeQuestionRequests.get(scope) === active) {
          respondSafely(sendResponse, { error: 'Extension settings could not be read.' });
        } else {
          respondSafely(sendResponse, { ok: false, cancelled: true });
        }
      }
    }).finally(() => {
      if (activeQuestionRequests.get(scope) === active) activeQuestionRequests.delete(scope);
    });
    return true;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !Object.hasOwn(changes, 'pluginEnabled')) return;
  pluginSettingRevision += 1;
  pluginEnabledState = changes.pluginEnabled.newValue !== false;
  if (pluginEnabledState) return;
  for (const [scope, active] of activeQuestionRequests) {
    activeQuestionRequests.delete(scope);
    active.controller.abort();
  }
});
