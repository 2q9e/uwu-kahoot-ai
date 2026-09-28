
import { DEFAULT_MODEL, DEFAULT_VISION_MODEL, DEPRECATED_MODELS } from '../core/constants.js';
import { AI_REQUEST_BUDGET_MS } from '../ai/provider-client.js';
import { answerJumbleQuestion, answerMultiSelect, answerOpenEndedQuestion, answerPinQuestion, answerQuestion, answerSliderQuestion } from '../ai/answer-questions.js';

const TAG = '[UwU Kahoot AI]';
const STYLE = 'color:#c026d3;font-weight:bold';
const log = (...args) => console.log(`%c${TAG}`, STYLE, ...args);
const err = (...args) => console.error(`%c${TAG}`, STYLE, ...args);
const SOLVE_STATS_KEY = 'uwuKahootSolveStats';
let solveStatsWriteQueue = Promise.resolve();
const activeQuestionRequests = new Map();

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
  }).catch(error => err('Could not save local solve stats:', error?.message || error));
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
    err('Model migration failed:', error);
  }
})();

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'manual-answer') return;
  chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
    const tab = tabs
      .filter(candidate => isKahootTab(candidate.url))
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

function isKahootTab(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'kahoot.it' || hostname.endsWith('.kahoot.it');
  } catch (_) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
    sendResponse({ ok: true, cancelled });
    return false;
  }

  if (msg.action === 'processQuestion') {
    const scope = getRequestScope(sender.tab?.id, sender.frameId);
    const requestId = String(msg.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    activeQuestionRequests.get(scope)?.controller.abort();
    const controller = new AbortController();
    const active = { requestId, controller, tabId: sender.tab?.id };
    activeQuestionRequests.set(scope, active);

    handleQuestion(msg.question, sender.tab?.id, sender.frameId, requestId, msg.solveId, controller.signal)
      .then(() => sendResponse({ ok: true }))
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          sendResponse({ ok: false, cancelled: true });
          return;
        }
        sendResponse({ error: error.message });
      })
      .finally(() => {
        if (activeQuestionRequests.get(scope) === active) activeQuestionRequests.delete(scope);
      });
    return true;
  }
});

function getRequestScope(tabId, frameId) {
  return `${Number.isInteger(tabId) ? tabId : 'unknown'}:${Number.isInteger(frameId) ? frameId : 0}`;
}

async function getQuestionImage(question, tabId, frameId, requestId) {
  if (question.imageUrl) return question.imageUrl;
  const response = await sendToTabAsync(tabId, frameId, 'getQuestionImageUrl', { requestId });
  if (response?.stale) throw new Error('Question changed before the image could be read.');
  return response?.imageUrl || null;
}

async function handleQuestion(question, tabId, frameId, requestId, solveId, signal) {
  if (!question?.title || !tabId) return;
  const t0 = performance.now();
  const ms = () => `${Math.round(performance.now() - t0)}ms`;
  const answerOptions = { signal, deadline: Date.now() + AI_REQUEST_BUDGET_MS };

  log(`Question received | Type: ${question.type || 'unknown'} | Choices: ${(question.choices || []).length}`);

  try {
    const settings = await chrome.storage.sync.get([
      'highlightOption',
      'autoClickOption',
      'pinHighlightOption',
      'pinAutoClickOption',
      'answerDelay',
      'silentMode'
    ]);

    const opts = {
      highlight: settings.highlightOption !== false,
      autoClick: settings.autoClickOption !== false,
      answerDelay: settings.answerDelay ?? 0,
      silentMode: !!settings.silentMode
    };

    if (question.type === 'pin_it') {
      opts.highlight = settings.pinHighlightOption !== false;
      opts.autoClick = !!settings.pinAutoClickOption;
    }

    switch (question.type) {
      case 'pin_it': {
        let imageUrl = question.imageUrl;
        let imageSource = imageUrl ? 'websocket' : null;
        if (!imageUrl) {
          const response = await sendToTabAsync(tabId, frameId, 'getPinImageUrl', { requestId });
          if (response?.stale) throw new Error('Question changed before the image could be read.');
          imageUrl = response?.imageUrl;
          imageSource = imageUrl ? 'dom' : null;
        }
        if (!imageUrl) throw new Error('No image found for pin question');
        log(`Pin image found (${imageSource})`);
        const aiStartedAt = performance.now();
        const coords = await answerPinQuestion(question.title, imageUrl, answerOptions);
        if (signal?.aborted) return;
        const responseMs = Math.round(performance.now() - aiStartedAt);
        log(`Pin answer ready (${ms()})`);
        const statsWrite = recordGeneratedAnswer(solveId, question, `${coords.x}, ${coords.y}`, responseMs, signal);
        sendToTab(tabId, frameId, 'placePin', { coords, options: opts, elapsed: ms(), requestId });
        await statsWrite;
        break;
      }

      case 'jumble': {
        const aiStartedAt = performance.now();
        const answerWord = await answerJumbleQuestion(question.title, question.choices, answerOptions);
        if (signal?.aborted) return;
        const responseMs = Math.round(performance.now() - aiStartedAt);
        log(`Jumble answer ready (${ms()})`);
        const statsWrite = recordGeneratedAnswer(solveId, question, answerWord, responseMs, signal);
        sendToTab(tabId, frameId, 'reorderJumble', { answerWord, options: opts, elapsed: ms(), requestId });
        await statsWrite;
        break;
      }

      case 'slider': {
        const imageUrl = await getQuestionImage(question, tabId, frameId, requestId);
        const aiStartedAt = performance.now();
        const value = await answerSliderQuestion(question.title, question.sliderConfig || {}, imageUrl, answerOptions);
        if (signal?.aborted) return;
        const responseMs = Math.round(performance.now() - aiStartedAt);
        log(`Slider answer ready (${ms()})`);
        const statsWrite = recordGeneratedAnswer(solveId, question, value, responseMs, signal);
        sendToTab(tabId, frameId, 'setSlider', { value, options: opts, elapsed: ms(), requestId });
        await statsWrite;
        break;
      }

      case 'open_ended': {
        const imageUrl = await getQuestionImage(question, tabId, frameId, requestId);
        const aiStartedAt = performance.now();
        const answer = await answerOpenEndedQuestion(question.title, imageUrl, answerOptions);
        if (signal?.aborted) return;
        const responseMs = Math.round(performance.now() - aiStartedAt);
        log(`Open-ended answer ready (${ms()})`);
        const statsWrite = recordGeneratedAnswer(solveId, question, answer, responseMs, signal);
        sendToTab(tabId, frameId, 'typeOpenEnded', { answer, options: opts, elapsed: ms(), requestId });
        await statsWrite;
        break;
      }

      default: {
        const imageUrl = await getQuestionImage(question, tabId, frameId, requestId);
        const isMultiSelect = question.type === 'multiple_select_quiz';
        let answers;
        const aiStartedAt = performance.now();
        if (isMultiSelect) {
          answers = await answerMultiSelect(question.title, question.choices, imageUrl, answerOptions);
        } else {
          const answer = await answerQuestion(question.title, question.choices, imageUrl, answerOptions);
          answers = [answer];
        }
        if (signal?.aborted) return;
        const responseMs = Math.round(performance.now() - aiStartedAt);
        log(`Answer ready | Choices: ${answers.length} (${ms()})`);
        const statsWrite = recordGeneratedAnswer(solveId, question, answers.join(' · '), responseMs, signal);
        sendToTab(tabId, frameId, 'highlightAnswer', { answers, isMultiSelect, options: opts, elapsed: ms(), requestId });
        await statsWrite;
      }
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      log(`Question request cancelled (${ms()})`);
      return;
    }
    err(`AI request failed (${ms()})`, error?.name || 'Error', error?.status ? `HTTP ${error.status}` : '');
    sendToTab(tabId, frameId, 'showError', { message: error.message || 'Unknown error', requestId });
  }
}

function sendToTab(tabId, frameId, action, data = {}) {
  const options = Number.isInteger(frameId) && frameId >= 0 ? { frameId } : undefined;
  chrome.tabs.sendMessage(tabId, { action, ...data }, options).catch(() => {});
}

function sendToTabAsync(tabId, frameId, action, data = {}) {
  const options = Number.isInteger(frameId) && frameId >= 0 ? { frameId } : undefined;
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { action, ...data }, options, response => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}
