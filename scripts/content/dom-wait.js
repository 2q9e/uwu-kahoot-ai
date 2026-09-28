(function () {
  'use strict';

  function createDomWaiter({ getNonce }) {
    const activeWaits = new Set();

    function waitForDomResult(check, { timeout = 2000, nonce = getNonce(), root = document.body || document.documentElement, settleMs = 0 } = {}) {
      const read = () => {
        if (nonce !== getNonce()) return null;
        try { return check() ?? null; } catch (_) { return null; }
      };
      const immediate = read();
      const hasValue = value => value !== null && value !== false;
      if (hasValue(immediate) && settleMs <= 0) return Promise.resolve(immediate);
      if (!root || typeof MutationObserver === 'undefined') {
        if (!hasValue(immediate)) return Promise.resolve(null);
        return new Promise(resolve => setTimeout(() => resolve(read()), settleMs));
      }

      return new Promise(resolve => {
        let settled = false;
        let timeoutId;
        let settleTimer;
        let frameId;
        let observer;
        let candidateSignature;
        let candidateSince = 0;
        const signatureOf = value => {
          try { return JSON.stringify(value); } catch (_) { return value; }
        };
        const cleanup = () => {
          clearTimeout(timeoutId);
          clearTimeout(settleTimer);
          if (frameId != null) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId);
            else clearTimeout(frameId);
          }
          observer?.disconnect();
          root.removeEventListener?.('transitionend', checkReady, true);
          root.removeEventListener?.('animationend', checkReady, true);
          activeWaits.delete(cancel);
        };
        const finish = value => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const cancel = () => finish(null);
        const checkReady = () => {
          const value = read();
          if (!hasValue(value)) {
            candidateSignature = undefined;
            candidateSince = 0;
            clearTimeout(settleTimer);
            settleTimer = null;
            return;
          }
          if (settleMs <= 0) return finish(value);
          const signature = signatureOf(value);
          if (signature !== candidateSignature) {
            candidateSignature = signature;
            candidateSince = Date.now();
            clearTimeout(settleTimer);
            settleTimer = setTimeout(checkReady, settleMs);
            return;
          }
          if (Date.now() - candidateSince >= settleMs) finish(value);
        };
        const scheduleCheck = () => {
          if (frameId != null) return;
          if (typeof requestAnimationFrame === 'function') {
            frameId = requestAnimationFrame(() => {
              frameId = null;
              checkReady();
            });
          } else {
            frameId = setTimeout(() => {
              frameId = null;
              checkReady();
            }, 16);
          }
        };

        activeWaits.add(cancel);
        observer = new MutationObserver(scheduleCheck);
        observer.observe(root, {
          childList: true,
          characterData: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'class', 'style', 'data-functional-selector']
        });
        root.addEventListener?.('transitionend', scheduleCheck, true);
        root.addEventListener?.('animationend', scheduleCheck, true);
        timeoutId = setTimeout(() => {
          checkReady();
          if (!settled) finish(null);
        }, Math.max(0, timeout));
        checkReady();
      });
    }

    function waitForQuestionEvent(name, questionIndex, timeout, nonce = getNonce()) {
      return new Promise(resolve => {
        let settled = false;
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          window.removeEventListener(name, onEvent);
          activeWaits.delete(cancel);
        };
        const finish = value => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const cancel = () => finish(null);
        const onEvent = event => {
          if (nonce !== getNonce()) return finish(null);
          const receivedIndex = event.detail?.questionIndex;
          if (questionIndex != null && String(receivedIndex) !== String(questionIndex)) return;
          finish(event.detail?.handled === true);
        };
        activeWaits.add(cancel);
        window.addEventListener(name, onEvent);
        timer = setTimeout(() => finish(false), Math.max(0, timeout));
      });
    }

    function cancelAll() {
      for (const cancel of [...activeWaits]) cancel();
    }

    return { cancelAll, waitForDomResult, waitForQuestionEvent };
  }

  globalThis.UwUKahootAIDomWait = { create: createDomWaiter };
})();
