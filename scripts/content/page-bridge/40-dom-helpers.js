function waitForDomCondition(check, questionIndex, timeout = 1600) {
  const read = () => {
    if (!isCurrentQuestion(questionIndex)) return null;
    try { return check() ?? null; } catch (_) { return null; }
  };
  const immediate = read();
  if (immediate !== null && immediate !== false) return Promise.resolve(immediate);
  const root = document.documentElement;
  if (!root || typeof MutationObserver === 'undefined') return Promise.resolve(null);

  return new Promise(resolve => {
    let settled = false;
    let timer;
    const observer = new MutationObserver(() => {
      const value = read();
      if (value !== null && value !== false) finish(value);
    });
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      resolve(value);
    };
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'class', 'style', 'data-functional-selector']
    });
    timer = setTimeout(() => finish(read()), Math.max(0, timeout));
    const value = read();
    if (value !== null && value !== false) finish(value);
  });
}

function waitForSubmitButton(questionIndex, timeout = 1600) {
  return waitForDomCondition(() => findSubmitButton(), questionIndex, timeout);
}

const afterPaint = () => new Promise(resolve => requestAnimationFrame(resolve));

function announceJumbleHandled(questionIndex, handled) {
  window.dispatchEvent(new CustomEvent('uwukahootaiJumbleHandled', {
    detail: { questionIndex, handled: !!handled }
  }));
}

function computeTileOrder(answer, tiles) {
  const answerLower = String(answer ?? '').toLowerCase().replace(/[\s\-]/g, '');
  if (!answerLower || !Array.isArray(tiles) || tiles.length === 0) return null;

  const tilesLower = tiles.map(tile => String(tile ?? '').toLowerCase().replace(/[\s\-]/g, ''));
  if (tilesLower.some(text => !text)) return null;
  if (tilesLower.reduce((length, text) => length + text.length, 0) !== answerLower.length) return null;

  const candidates = tilesLower
    .map((text, index) => ({ text, index, length: text.length }))
    .sort((left, right) => (right.length - left.length) || (left.index - right.index));

  const used = new Set();
  const greedyOrder = [];
  let greedyPosition = 0;

  while (greedyPosition < answerLower.length) {
    const next = candidates.find(candidate =>
      !used.has(candidate.index) && answerLower.startsWith(candidate.text, greedyPosition)
    );
    if (!next) break;
    used.add(next.index);
    greedyOrder.push(next.index);
    greedyPosition += next.length;
  }

  if (greedyPosition === answerLower.length && greedyOrder.length === tilesLower.length) return greedyOrder;
  if (tilesLower.length > 8) return null;

  const memo = new Map();

  function search(position, usedMask, usedCount) {
    if (usedCount === tilesLower.length) return position === answerLower.length ? [] : null;

    const key = `${position}:${usedMask}`;
    if (memo.has(key)) return memo.get(key);

    for (const candidate of candidates) {
      const bit = 1 << candidate.index;
      if ((usedMask & bit) !== 0 || !answerLower.startsWith(candidate.text, position)) continue;

      const suffix = search(position + candidate.length, usedMask | bit, usedCount + 1);
      if (suffix !== null) {
        const result = [candidate.index, ...suffix];
        memo.set(key, result);
        return result;
      }
    }

    memo.set(key, null);
    return null;
  }

  return search(0, 0, 0);
}

function findSubmitButton() {
  for (const sel of [
    '[data-functional-selector="submit-button"]',
    '[data-functional-selector="multi-select-submit-button"]',
    '[data-functional-selector="multi-select-submit"]',
    '[data-functional-selector="jumble-submit-button"]',
    '[data-functional-selector="slider-submit"]',
    '[data-functional-selector="text-answer-submit"]',
    '[data-functional-selector="pin-answer-submit"]',
    '[data-functional-selector="confirm"]',
    '[data-functional-selector*="submit"]',
    'button[type="submit"]'
  ]) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled && btn.offsetParent !== null) return btn;
  }
  for (const btn of document.querySelectorAll('button')) {
    const text = btn.textContent.trim().toLowerCase();
    if (['submit', 'confirm', 'done', 'check'].includes(text) && !btn.disabled && btn.offsetParent !== null) return btn;
  }
  return null;
}
