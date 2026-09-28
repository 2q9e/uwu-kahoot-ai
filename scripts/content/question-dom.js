(function () {
  'use strict';

  const CHOICE_TRANSITION_GRACE_MS = 5000;

  function createQuestionDom({ domAdapter, waitForDomResult, getNonce, log }) {
    function getExpectedChoiceCount(type, choices = []) {
      const parsedCount = Array.isArray(choices) ? choices.length : 0;
      if (parsedCount >= 2) return parsedCount;
      return type === 'true_false' ? 2 : 0;
    }

    async function pollForAnswerChoices(expectedCount = 0, nonce = getNonce(), fallbackChoices = [], previousChoices = [], questionTransition = false) {
      const requiredCount = Math.max(2, Number(expectedCount) || 0);
      const transitionStartedAt = Date.now();
      const fallbacks = Array.isArray(fallbackChoices)
        ? fallbackChoices.map(choice => String(choice ?? '').trim())
        : [];
      const previous = Array.isArray(previousChoices)
        ? previousChoices.map(choice => String(choice ?? '').trim().toLocaleLowerCase())
        : [];
      const fallbackIsComplete = fallbacks.length >= requiredCount && fallbacks.every(Boolean);
      const isPreviousQuestionChoices = choices => {
        const normalized = choices.map(choice => String(choice ?? '').trim().toLocaleLowerCase());
        const previousSet = new Set(previous);
        const onlyOldChoices = previous.length > 1 && normalized.length > 1 &&
          normalized.every(choice => previousSet.has(choice));
        if (!onlyOldChoices) return false;
        // Kahoot can leave the last answer buttons mounted while the new
        // question intro is showing. Allow a repeated set once its choices
        // have had time to appear for the new question.
        return !questionTransition || Date.now() - transitionStartedAt < CHOICE_TRANSITION_GRACE_MS;
      };

      const readChoices = () => {
        const findElements = domAdapter.findVisibleAnswerElements || domAdapter.findAnswerElements;
        const elements = findElements();
        if (elements.length < requiredCount) return null;
        const choices = elements.map(element => domAdapter.cleanButtonText(element));
        if (choices.some(choice => !String(choice ?? '').trim())) {
          const merged = choices.map((choice, index) => String(choice ?? '').trim() || fallbacks[index] || '');
          if (merged.some(choice => !String(choice).trim())) return null;
          return merged;
        }
        return choices;
      };

      if (fallbackIsComplete) {
        // Kahoot's parsed payload is usually authoritative, but a brief check
        // catches choices that appear on screen after a partial payload.
        const readExpandedChoices = () => {
          const choices = readChoices();
          if (!choices || choices.length <= fallbacks.length) return null;
          return isPreviousQuestionChoices(choices) ? null : choices;
        };
        const expandedChoices = await waitForDomResult(readExpandedChoices, {
          timeout: 900,
          nonce,
          settleMs: 180
        });
        if (expandedChoices) {
          log(`Additional answer choices confirmed on page: ${expandedChoices.length}`);
          return expandedChoices;
        }
        log(`Answer choices read from Kahoot data: ${fallbacks.length}`);
        return fallbacks;
      }

      const settleMs = Number(expectedCount) > 0 ? 240 : 500;
      let choices = await waitForDomResult(() => {
        const current = readChoices();
        return current && !isPreviousQuestionChoices(current) ? current : null;
      }, {
        timeout: questionTransition ? CHOICE_TRANSITION_GRACE_MS + settleMs + 1000 : 4500,
        nonce,
        settleMs
      });
      if (!choices && questionTransition) {
        // The DOM waiter is mutation-driven, so re-read after the grace period
        // to accept a new question that legitimately repeats all old choices.
        choices = await waitForDomResult(readChoices, {
          timeout: settleMs + 250,
          nonce,
          settleMs
        });
      }
      if (choices) log(`Answer choices read from page: ${choices.length}`);
      return choices || [];
    }

    async function pollForImageLabels(expectedCount, nonce = getNonce(), fallbackChoices = []) {
      const fallbacks = Array.isArray(fallbackChoices)
        ? fallbackChoices.map(choice => String(choice ?? '').trim())
        : [];
      const readLabels = () => {
        const findElements = domAdapter.findVisibleAnswerElements || domAdapter.findAnswerElements;
        const elements = findElements();
        if (elements.length < expectedCount) return null;
        const labels = elements.slice(0, expectedCount).map(el => domAdapter.cleanButtonText(el));
        return labels.length === expectedCount && labels.every(label =>
          label.trim().length > 0 && !/^image\s*\d+$/i.test(label)
        ) ? labels : null;
      };
      const labels = await waitForDomResult(readLabels, { timeout: 3500, nonce, settleMs: 120 });
      if (labels) return labels;
      const findElements = domAdapter.findVisibleAnswerElements || domAdapter.findAnswerElements;
      const elements = findElements();
      const domLabels = elements.slice(0, expectedCount).map(el => domAdapter.cleanButtonText(el));
      return Array.from({ length: expectedCount }, (_, index) => {
        const label = String(domLabels[index] ?? '').trim();
        if (label && !/^image\s*\d+$/i.test(label)) return label;
        return fallbacks[index] || '';
      });
    }

    function readSliderConfigFromDOM() {
      const input = document.querySelector('input[data-functional-selector="slider-scale"]');
      if (!input) return null;
      const rawMin = parseFloat(input.min);
      const rawMax = parseFloat(input.max);
      const rawStep = parseFloat(input.step);
      return {
        min: Number.isFinite(rawMin) ? rawMin : null,
        max: Number.isFinite(rawMax) ? rawMax : null,
        step: Number.isFinite(rawStep) ? rawStep : null,
        unit: input.getAttribute('aria-label') || ''
      };
    }

    async function probeSliderConfigFast() {
      const immediate = readSliderConfigFromDOM();
      if (immediate) return immediate;
      return waitForDomResult(readSliderConfigFromDOM, { timeout: 100 });
    }

    function readJumbleTiles() {
      const tiles = [];
      let i = 0;
      while (true) {
        const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
        if (!el) break;
        tiles.push(el.textContent?.trim() || '');
        i++;
      }
      if (tiles.length === 0) {
        const cards = document.querySelectorAll('[data-functional-selector^="draggable-jumble-card-"]');
        for (const card of cards) tiles.push(card.getAttribute('aria-label') || card.textContent?.trim() || '');
      }
      return tiles.length > 0 && tiles.some(tile => tile.length > 0) ? tiles : null;
    }

    async function pollForJumbleTiles(nonce = getNonce()) {
      return (await waitForDomResult(readJumbleTiles, { timeout: 2250, nonce })) || [];
    }

    function readJumbleTextEls() {
      const elements = [];
      let i = 0;
      while (true) {
        const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
        if (!el) break;
        elements.push(el);
        i++;
      }
      return elements.length ? elements : null;
    }

    async function pollForJumbleTextEls(nonce = getNonce()) {
      const elements = (await waitForDomResult(readJumbleTextEls, { timeout: 2000, nonce })) || [];
      if (elements.length) log(`Found ${elements.length} jumble text elements`);
      return elements;
    }

    return { getExpectedChoiceCount, pollForAnswerChoices, pollForImageLabels, pollForJumbleTextEls, pollForJumbleTiles, probeSliderConfigFast };
  }

  globalThis.UwUKahootAIQuestionDom = { create: createQuestionDom };
})();
