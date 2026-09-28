(function initAnswerChoiceActions(global) {
  'use strict';

  function createAnswerChoiceActions({
    domAdapter,
    matching,
    waitForDomResult,
    showTimerOverlay,
    updateStatus,
    recordDiagnostic,
    log,
    warn,
    getSubmitNonce,
    getCurrentAnswer,
    getLoadingEndsAt
  }) {
    async function highlightAnswers(answers, isMultiSelect, options) {
      const myNonce = getSubmitNonce();
      const remaining = (getLoadingEndsAt() > 0) ? Math.max(getLoadingEndsAt() - Date.now(), 0) : 0;
      const maxWait = Math.max(remaining + 8000, 12000);

      if (remaining > 0) {
        log(`Loading bar: ${remaining}ms remaining, waiting for answer buttons`);
      }

      const elements = await waitForDomResult(() => {
        const found = domAdapter.findAnswerElements();
        return found.length ? found : null;
      }, { timeout: maxWait, nonce: myNonce });
      if (getSubmitNonce() !== myNonce) return;
      if (elements?.length) {
        applyHighlights(elements, answers, isMultiSelect, options);
        return;
      }
      recordDiagnostic?.('ANSWER_NO_CONTROLS', { stage: 'matching' });
      updateStatus('Error: no answer buttons found', 'The page did not expose answer controls. Try again when they appear.');
    }

    function applyHighlights(elements, answers, isMultiSelect, options) {
      const matchedElements = [];

      for (const answer of answers) {
        let bestEl = null, bestScore = 0, secondBestScore = 0, indexFallback = null;

        const imageMatch = answer.match(/^Image\s*(\d+)$/i);
        if (imageMatch) {
          const idx = parseInt(imageMatch[1]) - 1;
          if (idx >= 0 && idx < elements.length && !matchedElements.some(m => m.el === elements[idx])) {
            matchedElements.push({ el: elements[idx], answer, score: 100, autoClickSafe: true });
            continue;
          }
        }

        const numMatch = answer.match(/^(?:Answer|Option|Choice)?\s*(\d+)$/i);
        if (numMatch) {
          const idx = parseInt(numMatch[1]) - 1;
          if (idx >= 0 && idx < elements.length) indexFallback = elements[idx];
        }

        for (const el of elements) {
          if (matchedElements.some(m => m.el === el)) continue;
          const text = domAdapter.cleanButtonText(el);
          const score = matching.matchScore(text, answer);
          if (score === 100) { bestEl = el; bestScore = 100; secondBestScore = 0; break; }
          if (score > bestScore) { secondBestScore = bestScore; bestScore = score; bestEl = el; }
          else if (score > secondBestScore) { secondBestScore = score; }
        }

        if (bestEl && bestScore >= 55) {
          const autoClickSafe = bestScore >= 85 && (bestScore - secondBestScore >= 8 || bestScore === 100);
          log(`Matched an answer to a page option (score=${bestScore}, safe to auto-click=${autoClickSafe})`);
          matchedElements.push({ el: bestEl, answer, score: bestScore, autoClickSafe });
        } else if (indexFallback && !matchedElements.some(m => m.el === indexFallback)) {
          log('Used the answer index to match a page option.');
          matchedElements.push({ el: indexFallback, answer, score: 50, autoClickSafe: false });
        } else {
          warn(`No answer match found (best score: ${bestScore}).`);
        }
      }

      if (matchedElements.length === 0) {
        recordDiagnostic?.('ANSWER_NO_MATCH', { stage: 'matching' });
        updateStatus('Error: could not match answers', 'Try again or review the current question.');
        return;
      }

      updateStatus(options.autoClick === false ? 'Answer matched to Kahoot choices' : 'Answer matched · preparing submission',
        `${matchedElements.length} choice${matchedElements.length === 1 ? '' : 's'} matched on the page.`,
        { stage: options.autoClick === false ? 'highlighted' : 'matched' });

      if (options.highlight !== false && !options.silentMode) {
        const pulseHighlight = options.autoClick === false &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        for (const { el } of matchedElements) {
          el.style.border = '3px solid #00c853';
          el.style.boxShadow = '0 0 16px 4px rgba(0,200,83,.7)';
          el.style.borderRadius = '10px';
          el.style.transition = 'border-color .12s ease, box-shadow .12s ease';
          if (pulseHighlight) {
            el.animate([
              { transform: 'scale(1)' },
              { transform: 'scale(1.025)' },
              { transform: 'scale(1)' }
            ], { duration: 240, easing: 'ease-out' });
          }

          const hasImage = el.querySelector('img[data-functional-selector="image-answer"]');
          if (hasImage) {
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
            const badge = document.createElement('div');
            badge.className = 'uwukahootai-checkmark';
            badge.textContent = '✅';
            badge.style.cssText = `
              position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
              font-size:3rem; z-index:10000; pointer-events:none;
              filter:drop-shadow(0 2px 8px rgba(0,0,0,0.7));
              animation:uwukahootai-fadein .3s ease-out;
            `;
            el.appendChild(badge);
          } else {
            const check = document.createElement('span');
            check.textContent = ' ✅';
            check.style.cssText = 'font-size:1.2em; margin-left:6px; vertical-align:middle;';
            check.className = 'uwukahootai-checkmark';
            el.appendChild(check);
          }
        }
      }

      if (options.autoClick !== false) {
        const matchedIndices = matchedElements.map(m => elements.indexOf(m.el)).filter(i => i >= 0);
        if (matchedElements.some(m => !m.autoClickSafe)) {
          warn('Auto-clicking despite at least one ambiguous match');
        }
        if (isMultiSelect && matchedIndices.length > 0) {
          waitForClickable(matchedElements[0].el, () => fireMultiClick(matchedIndices, elements), options);
        } else if (matchedIndices.length > 0) {
          waitForClickable(matchedElements[0].el, () => fireClick(matchedIndices[0]), options);
        }
      }
    }

    function waitForClickable(element, callback, options, retries = 50, nonce = getSubmitNonce()) {
      if (!element || nonce !== getSubmitNonce()) return;
      const ready = () => element.isConnected && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && element.offsetParent !== null;
      const run = () => {
        if (nonce !== getSubmitNonce()) return;
        const guardedCallback = () => { if (nonce === getSubmitNonce()) callback(); };
        const delay = options.answerDelay ?? 0;
        if (delay > 0) {
          if (!options.silentMode) showTimerOverlay(delay, guardedCallback);
          else setTimeout(guardedCallback, delay * 1000);
        } else guardedCallback();
      };
      if (ready()) { run(); return; }
      waitForDomResult(() => ready() ? true : null, {
        timeout: Math.max(600, retries * 40),
        nonce,
        root: element.ownerDocument?.documentElement || document.documentElement
      }).then(value => {
        if (nonce !== getSubmitNonce()) return;
        if (value) run();
        else {
          recordDiagnostic?.('ANSWER_NOT_CLICKABLE', { stage: 'dispatch' });
          updateStatus('Error: answer button did not become clickable', 'Wait for Kahoot’s timer or loading state to finish, then retry.');
        }
      });
    }

    function fireClick(index) {
      updateStatus('Sending answer to Kahoot…', 'Waiting for the Kahoot connection to accept the outgoing answer.', { stage: 'sending' });
      window.dispatchEvent(new CustomEvent('autoClickAnswer', { detail: index }));
    }

    function fireMultiClick(indices, allElements) {
      const nonce = getSubmitNonce();

      updateStatus('Sending selected choices to Kahoot…', 'Waiting for the Kahoot connection to accept the outgoing answer.', { stage: 'sending' });
      window.dispatchEvent(new CustomEvent('autoClickMultiSelect', { detail: indices }));

      for (const idx of indices) {
        if (allElements[idx]) {
          try { allElements[idx].click(); } catch (_) {}
        }
      }

      clickSubmitButton('multi-select', 0, nonce);
    }

    function clickSubmitButton(context = 'generic', attempt = 0, nonce = getSubmitNonce()) {
      if (nonce !== getSubmitNonce()) return;
      const find = () => {
        const found = domAdapter.findSubmitButton();
        if (found.element && !found.element.disabled && found.element.getAttribute('aria-disabled') !== 'true') return found;
        for (const btn of document.querySelectorAll('button')) {
          const text = btn.textContent.trim().toLowerCase();
          if (['submit', 'confirm', 'done', 'check'].includes(text) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && btn.offsetParent !== null) {
            return { element: btn, selector: `text:${text}` };
          }
        }
        return null;
      };
      const click = ({ element: btn, selector }) => {
        if (!btn || nonce !== getSubmitNonce()) return false;
        log(`Clicking ${context} submit via: ${selector}`);
        btn.click();
        if (context !== 'multi-select') updateStatus('Answered ✅', getCurrentAnswer()?.length > 60 ? getCurrentAnswer().slice(0, 57) + '...' : getCurrentAnswer());
        return true;
      };

      const immediate = find();
      if (immediate && click(immediate)) return;
      waitForDomResult(find, { timeout: Math.max(0, 1600 - attempt * 80), nonce }).then(found => {
        if (nonce !== getSubmitNonce()) return;
        if (found && click(found)) return;
        log(`No ${context} submit button found before timeout (WS likely already submitted)`);
        if (context !== 'multi-select') updateStatus('Answered ✅', getCurrentAnswer()?.length > 60 ? getCurrentAnswer().slice(0, 57) + '...' : getCurrentAnswer());
      });
    }

    return { highlightAnswers, clickSubmitButton };
  }

  global.UwUKahootAIAnswerChoiceActions = { create: createAnswerChoiceActions };
})(globalThis);
