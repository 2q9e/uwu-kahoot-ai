(function initDomAdapter(global) {
  const ANSWER_SELECTORS = [
    'button[data-functional-selector^="answer-"]',
    '[data-functional-selector^="answer-" i]',
    '[data-functional-selector*="question-choice" i]',
    '[data-functional-selector*="answer-card" i]',
    '[data-functional-selector="answer-option"]',
    '[data-functional-selector="answer"]',
    '[data-functional-selector="answer-button"]',
    'button[data-functional-selector*="answer"]',
    'button[class*="answer"]',
    'button[class*="choice__Choice"]',
  ];

  const SUBMIT_SELECTORS = [
    'button[data-functional-selector="submit-button"]',
    'button[data-functional-selector="multi-select-submit-button"]',
    'button[data-functional-selector="multi-select-submit"]',
    'button[data-functional-selector="pin-answer-submit"]',
    'button[data-functional-selector="jumble-submit-button"]',
    'button[data-functional-selector="slider-submit"]',
    'button[data-functional-selector="text-answer-submit"]',
    'button[data-functional-selector*="submit"]',
    'button[data-functional-selector="confirm"]',
    'button[type="submit"]',
  ];

  function getStyle(element) {
    const view = element.ownerDocument?.defaultView;
    const getComputedStyle = view?.getComputedStyle || global.getComputedStyle;
    return typeof getComputedStyle === 'function' ? getComputedStyle.call(view || global, element) : null;
  }

  function isVisible(element) {
    if (!element) return false;

    for (let current = element; current; current = current.parentElement) {
      const hiddenAttribute = current.getAttribute?.('hidden');
      if (current.hidden || (hiddenAttribute !== null && hiddenAttribute !== undefined) || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = getStyle(current);
      if (style && (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      )) return false;
    }

    if (typeof element.getClientRects === 'function') return element.getClientRects().length > 0;
    const style = getStyle(element);
    return element.offsetParent !== null || style?.position === 'fixed';
  }

  function isUsable(element) {
    if (!element) return false;
    const disabledAttribute = element.getAttribute?.('disabled');
    if (element.disabled || (disabledAttribute !== null && disabledAttribute !== undefined) || element.getAttribute?.('aria-disabled') === 'true') return false;
    return isVisible(element);
  }

  function findFirstVisible(selectors, root = document) {
    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (isUsable(element)) return { element, selector };
      }
    }
    return { element: null, selector: null };
  }

  function findAnswerElements(root = document) {
    for (const selector of ANSWER_SELECTORS) {
      const elements = Array.from(root.querySelectorAll(selector)).filter(isUsable);
      if (elements.length > 0) return [...new Set(elements)];
    }
    return [];
  }

  function findVisibleAnswerElements(root = document) {
    for (const selector of ANSWER_SELECTORS) {
      const elements = Array.from(root.querySelectorAll(selector)).filter(isVisible);
      if (elements.length > 0) return [...new Set(elements)];
    }
    return [];
  }

  function findSubmitButton(root = document) {
    return findFirstVisible(SUBMIT_SELECTORS, root);
  }

  function cleanButtonText(element) {
    if (!element) return '';

    const image = element.querySelector('img[aria-label], img[alt]');
    if (image) {
      const label = image.getAttribute('aria-label') || image.getAttribute('alt');
      if (label?.trim()) return normalizeLabel(label);
    }

    const clone = element.cloneNode(true);
    clone.querySelectorAll('.uwukahootai-checkmark, [aria-hidden="true"], svg').forEach(icon => icon.remove());
    let text = normalizeLabel(clone.textContent).replace(/\bicon\b/g, ' ').replace(/\s+/g, ' ').trim();

    if (!text) return normalizeLabel(element.getAttribute('aria-label'));

    for (const divisor of [3, 2]) {
      const words = text.split(' ');
      if (words.length >= divisor && words.length % divisor === 0) {
        const groupSize = words.length / divisor;
        const part = words.slice(0, groupSize).join(' ');
        const repeatedWords = Array.from({ length: divisor }, (_, index) =>
          words.slice(index * groupSize, (index + 1) * groupSize).join(' ')
        ).every(group => group === part);
        if (repeatedWords) {
          text = part;
          break;
        }
      }
      if (text.length >= divisor * 2) {
        const chunk = text.length / divisor;
        if (Number.isInteger(chunk)) {
          const part = text.substring(0, chunk);
          if (part.repeat(divisor) === text) {
            text = part;
            break;
          }
        }
      }
    }

    return text;
  }

  function normalizeLabel(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  global.UwUKahootAIDomAdapter = {
    findAnswerElements,
    findVisibleAnswerElements,
    findSubmitButton,
    cleanButtonText
  };
})(globalThis);
