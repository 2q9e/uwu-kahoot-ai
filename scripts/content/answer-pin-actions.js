(function initAnswerPinActions(global) {
  'use strict';

  function createAnswerPinActions({
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
    function extractPinImageUrl() {
      const svgEl = document.querySelector('[data-functional-selector="pin-input-svg"]');
      if (svgEl) {
        const imgEl = svgEl.querySelector('image[href], image[xlink\\:href]');
        if (imgEl) {
          const url = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href');
          if (url) { log('Pin image found in SVG.'); return url; }
        }
      }
      const scaledImg = document.querySelector('[data-functional-selector="media-container__media-image"]');
      if (scaledImg) {
        const url = scaledImg.getAttribute('href') || scaledImg.getAttribute('src');
        if (url) { log('Pin image found in media container.'); return url; }
      }
      log('Pin image: no image found in DOM');
      return null;
    }

    function extractQuestionImageUrl() {
      const img = document.querySelector('img[data-functional-selector="media-container__media-image"]');
      if (img) {
        const url = img.getAttribute('src');
        if (url) { log('Question image found in page.'); return url; }
      }
      return null;
    }

    async function placePinOnSvg(coords, options = {}) {
      const myNonce = getSubmitNonce();
      const questionIndex = getCurrentQuestion()?.questionIndex;
      const svgElReady = () => {
        const svg = document.querySelector('[data-functional-selector="pin-input-svg"]');
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        return rect.width > 50 && rect.height > 50 &&
          !document.querySelector('[data-functional-selector="loading-bar-progress"]') ? svg : null;
      };
      let svgEl = await waitForDomResult(svgElReady, { timeout: 4000, nonce: myNonce });

      if (getSubmitNonce() !== myNonce) return;

      if (!svgEl) {
        svgEl = document.querySelector('[data-functional-selector="pin-input-svg"]');
        if (!svgEl) {
          recordDiagnostic?.('PIN_TARGET_MISSING', { stage: 'dispatch' });
          updateStatus('Pin target not found', 'Wait for the map or image to load, then retry.');
          return;
        }
        warn('Pin: proceeding despite overlay check');
      } else {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (getSubmitNonce() !== myNonce) return;
      }

      log('Pin point placed on page.');

      const doPlace = () => {
        if (getSubmitNonce() !== myNonce) return;
        window.dispatchEvent(new CustomEvent('autoPinAnswer', { detail: { x: coords.x, y: coords.y, questionIndex } }));
      };

      if (options.autoClick !== false) {
        const delay = options.answerDelay ?? 0;
        if (delay > 0) {
          if (!options.silentMode) showTimerOverlay(delay, doPlace);
          else setTimeout(doPlace, delay * 1000);
        } else {
          doPlace();
        }
      } else {
        if (options.highlight !== false && !options.silentMode) answerFeedbackUi.showPinCrosshair(svgEl, coords);
        updateStatus('Pin here 📍', `${coords.x.toFixed(1)}%, ${coords.y.toFixed(1)}%`);
      }
    }

    return { extractPinImageUrl, extractQuestionImageUrl, placePinOnSvg };
  }

  global.UwUKahootAIAnswerPinActions = { create: createAnswerPinActions };
})(globalThis);
