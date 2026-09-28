(function () {
  'use strict';

  function createQuestionDom({ domAdapter, waitForDomResult, getNonce, log }) {
    function getExpectedChoiceCount(type, choices = []) {
      const parsedCount = Array.isArray(choices)
        ? choices.filter(choice => String(choice ?? '').trim()).length
        : 0;
      if (parsedCount >= 2) return parsedCount;
      return type === 'true_false' ? 2 : 4;
    }

    async function pollForAnswerChoices(expectedCount = 0, nonce = getNonce(), fallbackChoices = []) {
      const requiredCount = Math.max(2, Number(expectedCount) || 0);
      const readChoices = () => {
        const findElements = domAdapter.findVisibleAnswerElements || domAdapter.findAnswerElements;
        const elements = findElements();
        if (elements.length < requiredCount) return null;
        const choices = elements.map(element => domAdapter.cleanButtonText(element));
        const resultCount = Number(expectedCount) > 0 ? Number(expectedCount) : choices.length;
        if (choices.length < requiredCount) return null;
        if (choices.some(choice => !choice)) {
          const fallbacks = Array.isArray(fallbackChoices) ? fallbackChoices.slice(0, resultCount) : [];
          if (fallbacks.length < requiredCount || fallbacks.some(choice => !String(choice || '').trim())) return null;
          return fallbacks;
        }
        return choices.slice(0, resultCount);
      };
      const choices = await waitForDomResult(readChoices, {
        timeout: 4500,
        nonce,
        settleMs: Number(expectedCount) > 0
          ? (Array.isArray(fallbackChoices) && fallbackChoices.length >= requiredCount ? 160 : 180)
          : 360
      });
      if (choices) log(`Answer choices read from page: ${choices.length}`);
      return choices || [];
    }

    async function pollForImageLabels(expectedCount, nonce = getNonce()) {
      const readLabels = () => {
        const elements = domAdapter.findAnswerElements();
        if (elements.length < expectedCount) return null;
        const labels = elements.slice(0, expectedCount).map(el => domAdapter.cleanButtonText(el));
        return labels.some(label => label.length > 0 && !/^image\s*\d+$/i.test(label)) ? labels : null;
      };
      const labels = await waitForDomResult(readLabels, { timeout: 2000, nonce });
      if (labels) return labels;
      const elements = domAdapter.findAnswerElements();
      return elements.length > 0
        ? elements.slice(0, expectedCount).map(el => domAdapter.cleanButtonText(el))
        : Array.from({ length: expectedCount }, (_, i) => `Image ${i + 1}`);
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
