(function initAnswerJumbleActions(global) {
  'use strict';

  function createAnswerJumbleActions({
    waitForQuestionEvent,
    questionDom,
    matching,
    answerFeedbackUi,
    showTimerOverlay,
    updateStatus,
    recordDiagnostic,
    log,
    warn,
    getSubmitNonce,
    getCurrentQuestion,
    clickSubmitButton
  }) {
    async function solveJumbleFromDOM(answerWord, options) {
      const myNonce = getSubmitNonce();
      const questionIndex = getCurrentQuestion()?.questionIndex;
      const handledPromise = options.autoClick !== false
        ? waitForQuestionEvent('uwukahootaiJumbleHandled', questionIndex, 3400, myNonce)
        : null;
      window.dispatchEvent(new CustomEvent('autoJumbleAnswer', {
        detail: { answerWord, autoClick: options.autoClick !== false, questionIndex }
      }));
      if (getSubmitNonce() !== myNonce) return;

      if (handledPromise && await handledPromise) {
        if (getSubmitNonce() !== myNonce) return;
        log('Jumble handled by page-bridge.js (React state)');
        updateStatus('Answered ✅ (jumble)', answerWord);
        return;
      }

      log('Injected.js did not handle jumble, trying DOM clicks');

      const textEls = await questionDom.pollForJumbleTextEls(myNonce);
      if (getSubmitNonce() !== myNonce) return;
      if (textEls.length === 0) {
        recordDiagnostic?.('JUMBLE_TILES_MISSING', { stage: 'matching' });
        updateStatus('Jumble tiles not found', 'Wait for the tiles to load or reload the Kahoot tab.');
        return;
      }

      const labels = textEls.map(el => el.textContent?.trim() || '');
      log(`Jumble tile labels read: ${labels.length}`);

      const order = matching.computeTileOrder(answerWord, labels);
      if (!order) {
        recordDiagnostic?.('JUMBLE_ORDER_UNCLEAR', { stage: 'matching' });
        updateStatus(`Can't map answer to tiles`, 'Check the visible tiles and retry.');
        return;
      }
      log('Jumble tile order calculated.');

      if (options.highlight !== false && !options.silentMode) answerFeedbackUi.showJumbleBadges(textEls, order);

      if (options.autoClick === false) {
        updateStatus('Jumble order shown', answerWord);
        return;
      }

      const doClick = () => {
        if (getSubmitNonce() !== myNonce) return;
        clickJumbleTilesSequence(textEls, order, () => clickSubmitButton('jumble', 0, myNonce), 0, myNonce);
      };

      const delay = options.answerDelay ?? 0;
      if (delay > 0) {
        if (!options.silentMode) showTimerOverlay(delay, doClick);
        else setTimeout(doClick, delay * 1000);
      } else {
        doClick();
      }
    }

    function clickJumbleTilesSequence(textEls, order, onComplete, idx = 0, nonce = getSubmitNonce()) {
      if (nonce !== getSubmitNonce()) return;
      if (idx >= order.length) {
        log('All jumble tiles clicked');
        if (onComplete) onComplete();
        return;
      }

      const originalLabels = textEls.map(el => el.textContent?.trim() || '');
      const targetLabel = originalLabels[order[idx]];

      let currentTextEl = null;
      for (let i = 0; ; i++) {
        const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
        if (!el) break;
        if (el.textContent?.trim() === targetLabel) { currentTextEl = el; break; }
      }

      if (!currentTextEl) {
        currentTextEl = textEls[order[idx]];
        if (!currentTextEl?.isConnected) {
          warn('A jumble tile disappeared before it could be clicked.');
          clickJumbleTilesSequence(textEls, order, onComplete, idx + 1, nonce);
          return;
        }
      }

      const interactive = currentTextEl.closest('[draggable="true"]')
        || currentTextEl.closest('button')
        || currentTextEl.closest('[role="button"]')
        || currentTextEl.closest('[data-functional-selector*="card"]');
      const target = interactive || currentTextEl;

      target.click();

      requestAnimationFrame(() => {
        if (nonce !== getSubmitNonce()) return;
        clickJumbleTilesSequence(textEls, order, onComplete, idx + 1, nonce);
      });
    }

    return { solveJumbleFromDOM };
  }

  global.UwUKahootAIAnswerJumbleActions = { create: createAnswerJumbleActions };
})(globalThis);
