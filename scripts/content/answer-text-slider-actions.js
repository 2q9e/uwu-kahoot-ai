(function initAnswerTextSliderActions(global) {
  'use strict';

  function createAnswerTextSliderActions({
    waitForDomResult,
    answerFeedbackUi,
    showTimerOverlay,
    updateStatus,
    recordDiagnostic,
    log,
    warn,
    getSubmitNonce,
    getCurrentQuestion
  }) {
    async function dispatchOpenEndedAnswer(answer, options = {}) {
      const myNonce = getSubmitNonce();
      const questionIndex = getCurrentQuestion()?.questionIndex;
      const { autoClick = true, answerDelay = 0 } = options;

      const inputReady = await waitForDomResult(() => {
        const input = document.querySelector('input[data-functional-selector="text-answer-input"]');
        const noOverlay = !document.querySelector('[data-functional-selector="loading-bar-progress"]');
        return input && !input.disabled && noOverlay ? input : null;
      }, { timeout: 4000, nonce: myNonce });

      if (!inputReady) {
        const input = document.querySelector('input[data-functional-selector="text-answer-input"]');
        if (!input) {
          recordDiagnostic?.('TEXT_ANSWER_TARGET_MISSING', { stage: 'dispatch' });
          updateStatus('Text answer field not found', 'Wait for the field to appear, then retry.');
          return;
        }
        warn('Open-ended: proceeding despite overlay check');
      } else {
        log('Open-ended: input found, overlay clear');
      }

      if (getSubmitNonce() !== myNonce) return;

      if (answerDelay > 0) {
        log(`Open-ended: waiting ${answerDelay}s delay`);
        await new Promise(r => setTimeout(r, answerDelay * 1000));
        if (getSubmitNonce() !== myNonce) return;
      }

      window.dispatchEvent(new CustomEvent('autoTypeAnswer', {
        detail: { answer, autoClick, questionIndex }
      }));
      log(`Open-ended answer sent to page (${answer.length} characters).`);
      updateStatus('Answered ✅ (open-ended)', `✏️ ${answer}`);
    }

    async function solveSliderFromDOM(value, options) {
      const myNonce = getSubmitNonce();
      const questionIndex = getCurrentQuestion()?.questionIndex;

      const earlyInput = document.querySelector('input[data-functional-selector="slider-scale"]');
      if (earlyInput && options.autoClick !== false) {
        const rawMin = parseFloat(earlyInput.min), rawMax = parseFloat(earlyInput.max), rawStep = parseFloat(earlyInput.step);
        const min = isNaN(rawMin) ? 0 : rawMin, max = isNaN(rawMax) ? 100 : rawMax, step = isNaN(rawStep) ? 1 : rawStep;
        const snapped = Math.max(min, Math.min(max, min + Math.round((value - min) / step) * step));
        window.dispatchEvent(new CustomEvent('sliderWSSend', { detail: { value: snapped, questionIndex } }));
      log('Slider answer sent through WebSocket.');
      }

      const rangeInputReady = await waitForDomResult(() => {
        const input = document.querySelector('input[data-functional-selector="slider-scale"]');
        return input && !document.querySelector('[data-functional-selector="loading-bar-progress"]') ? input : null;
      }, { timeout: 4000, nonce: myNonce });

      if (getSubmitNonce() !== myNonce) return;

      let rangeInput = rangeInputReady;
      if (!rangeInput) {
        rangeInput = document.querySelector('input[data-functional-selector="slider-scale"]');
        if (!rangeInput) {
          recordDiagnostic?.('SLIDER_TARGET_MISSING', { stage: 'dispatch' });
          updateStatus('Slider control not found', 'Wait for the slider to appear, then retry.');
          return;
        }
        warn('Slider: proceeding despite overlay check');
      } else {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (getSubmitNonce() !== myNonce) return;
        log('Slider: range input found, overlay clear');
      }

      const rawMin = parseFloat(rangeInput.min);
      const rawMax = parseFloat(rangeInput.max);
      const rawStep = parseFloat(rangeInput.step);
      const min = isNaN(rawMin) ? 0 : rawMin;
      const max = isNaN(rawMax) ? 100 : rawMax;
      const step = isNaN(rawStep) ? 1 : rawStep;
      const unit = rangeInput.getAttribute('aria-label') || '';
      log('Slider value prepared for the page range.');

      if (options.highlight !== false && !options.silentMode) {
        answerFeedbackUi.highlightSliderMarker(value);
      }

      if (options.autoClick === false) {
        updateStatus('Slider answer shown', `🎚️ ${value} ${unit}`);
        return;
      }

      const doSlider = () => {
        if (getSubmitNonce() !== myNonce) return;

        window.dispatchEvent(new CustomEvent('autoSliderAnswer', {
          detail: { value, autoClick: true, skipWS: true, questionIndex }
        }));
        updateStatus('Answered ✅ (slider)', `🎚️ ${value} ${unit}`);
      };

      const delay = options.answerDelay ?? 0;
      if (delay > 0) {
        if (!options.silentMode) showTimerOverlay(delay, doSlider);
        else setTimeout(doSlider, delay * 1000);
      } else {
        doSlider();
      }
    }

    return { dispatchOpenEndedAnswer, solveSliderFromDOM };
  }

  global.UwUKahootAIAnswerTextSliderActions = { create: createAnswerTextSliderActions };
})(globalThis);
