'use strict';

globalThis.UwUKahootAIStatusUi = {
  create({ getSilentMode, getCurrentQuestion, getQuestionState, setQuestionState, broadcastToPopup }) {
    let statusEl = null;
    let thinkingDot = null;
    let activeToasts = [];

    function createStatusIndicator() {
      if (statusEl || getSilentMode()) return;
      statusEl = document.createElement('div');
      statusEl.id = 'uwukahootai-status';
      statusEl.style.cssText = `
        position:fixed; top:10px; right:10px;
        background:rgba(20,20,20,.88); color:#fff;
        padding:8px 14px; border-radius:10px; z-index:10000;
        font:600 12px/1.4 system-ui,sans-serif;
        max-width:320px; word-wrap:break-word;
        pointer-events:none; transition:opacity .3s;
        backdrop-filter:blur(8px);
        border:1px solid rgba(192,38,211,.3);
        box-shadow:0 4px 12px rgba(0,0,0,.4);
      `;
      statusEl.innerHTML = '<div id="uwukahootai-status-main" style="display:flex;align-items:center;gap:6px">UwU Kahoot AI: Ready</div><div id="uwukahootai-status-detail" style="font-weight:400;font-size:11px;opacity:.7;margin-top:3px;display:none"></div>';
      document.body?.appendChild(statusEl);
    }

    function setThinking(on) {
      if (!statusEl) return;
      if (on && !thinkingDot) {
        thinkingDot = document.createElement('span');
        thinkingDot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#c026d3;display:inline-block;animation:uwukahootai-pulse 1s ease-in-out infinite;flex-shrink:0';
        statusEl.querySelector('#uwukahootai-status-main')?.appendChild(thinkingDot);
      } else if (!on && thinkingDot) {
        thinkingDot.remove();
        thinkingDot = null;
      }
    }

    function updateStatus(msg, detail) {
      if (/error|failed/i.test(msg)) {
        setQuestionState('error', detail || msg);
      } else if (/waiting for (on-screen answers|answer choices)/i.test(msg)) {
        setQuestionState('waiting_for_choices', detail || msg);
      } else if (/preparing question/i.test(msg)) {
        setQuestionState(getQuestionState(), null);
      } else if (/sending|retrying|manual retry/i.test(msg)) {
        setQuestionState('processing', null);
      } else if (/answer received|answered|pin answer|jumble answer|jumble order shown|slider answer|open-ended answer/i.test(msg)) {
        setQuestionState('answered', null);
      } else if (getCurrentQuestion()) {
        setQuestionState('ready', null);
      }

      broadcastToPopup('updateStatus', {
        status: msg.replace(/[✅❌]/g, '').trim(),
        detail: detail || '',
        state: getQuestionState()
      });
      if (getSilentMode()) return;
      if (!statusEl) createStatusIndicator();
      if (!statusEl) return;
      const mainEl = statusEl.querySelector('#uwukahootai-status-main');
      const detailEl = statusEl.querySelector('#uwukahootai-status-detail');
      if (mainEl) mainEl.textContent = `UwU Kahoot AI: ${msg}`;
      if (detailEl) {
        if (detail) { detailEl.textContent = detail; detailEl.style.display = 'block'; }
        else detailEl.style.display = 'none';
      }
      setThinking(msg.includes('Sending') || msg.includes('Retrying'));
    }

    function removeStatusIndicator() {
      statusEl?.remove();
      statusEl = null;
      thinkingDot = null;
    }

    function showErrorToast(message) {
      if (getSilentMode()) return;
      while (activeToasts.length >= 3) {
        const old = activeToasts.shift();
        old?.remove();
      }
      const toast = document.createElement('div');
      toast.style.cssText = `
        position:fixed; top:${20 + activeToasts.length * 55}px; right:20px;
        background:#e74c3c; color:#fff;
        padding:12px 16px; border-radius:8px; z-index:9999;
        font:600 13px/1.3 system-ui,sans-serif;
        max-width:300px; box-shadow:0 4px 12px rgba(0,0,0,.3);
        animation: uwukahootai-fadein .25s ease-out;
      `;
      toast.textContent = message;
      document.body?.appendChild(toast);
      activeToasts.push(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity .3s';
        setTimeout(() => {
          toast.remove();
          activeToasts = activeToasts.filter(item => item !== toast);
        }, 300);
      }, 4500);
    }

    return { updateStatus, removeStatusIndicator, showErrorToast };
  }
};
