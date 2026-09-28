(function initMatchingScope(global) {
  function normalizeText(value) {
    let text = String(value ?? '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/\p{M}+/gu, '')
      .replace(/["\u201c\u201d'`]/g, '')
      .replace(/&/g, ' and ')
      .trim();

    text = text.replace(/^[-*•]+\s+/, '');
    text = text.replace(/^(?:\(?[\p{L}]\)|\d{1,2}\))\s+/iu, '');

    return text
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fuzzyScore(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const wordsA = a.split(/\s+/).filter(Boolean);
    const wordsB = b.split(/\s+/).filter(Boolean);
    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    const pairs = [];
    for (let indexA = 0; indexA < wordsA.length; indexA += 1) {
      for (let indexB = 0; indexB < wordsB.length; indexB += 1) {
        const score = tokenScore(wordsA[indexA], wordsB[indexB]);
        if (score > 0) pairs.push({ indexA, indexB, score });
      }
    }
    pairs.sort((left, right) => (right.score - left.score) || (left.indexA - right.indexA) || (left.indexB - right.indexB));

    const usedA = new Set();
    const usedB = new Set();
    let overlap = 0;
    for (const pair of pairs) {
      if (usedA.has(pair.indexA) || usedB.has(pair.indexB)) continue;
      usedA.add(pair.indexA);
      usedB.add(pair.indexB);
      overlap += pair.score;
    }

    const wordScore = overlap / Math.max(wordsA.length, wordsB.length);
    if (wordsA.length === 1 && wordsB.length === 1) return clampScore(wordScore);
    const containsPhrase = containsTokenPhrase(a, b) || containsTokenPhrase(b, a);
    const hasRepeatedTokens = new Set(wordsA).size !== wordsA.length || new Set(wordsB).size !== wordsB.length;
    if (containsPhrase && !hasRepeatedTokens) return clampScore(Math.max(wordScore, 0.88));
    return clampScore(wordScore);
  }

  function containsTokenPhrase(text, phrase) {
    return phrase.length >= 3 && (` ${text} `).includes(` ${phrase} `);
  }

  function tokenScore(a, b) {
    if (a === b) return 1;
    if (Math.min(Array.from(a).length, Array.from(b).length) < 5) return 0;
    return isOneEditApart(a, b) ? 0.86 : 0;
  }

  function isOneEditApart(a, b) {
    const charsA = Array.from(a);
    const charsB = Array.from(b);
    if (Math.abs(charsA.length - charsB.length) > 1) return false;

    let indexA = 0;
    let indexB = 0;
    let edits = 0;

    while (indexA < charsA.length && indexB < charsB.length) {
      if (charsA[indexA] === charsB[indexB]) {
        indexA += 1;
        indexB += 1;
        continue;
      }

      edits += 1;
      if (edits > 1) return false;

      if (charsA.length === charsB.length) {
        if (charsA[indexA + 1] === charsB[indexB] && charsA[indexA] === charsB[indexB + 1]) {
          indexA += 2;
          indexB += 2;
        } else {
          indexA += 1;
          indexB += 1;
        }
      } else if (charsA.length > charsB.length) {
        indexA += 1;
      } else {
        indexB += 1;
      }
    }

    if (indexA < charsA.length || indexB < charsB.length) edits += 1;
    return edits === 1;
  }

  function clampScore(score) {
    return Math.max(0, Math.min(1, score));
  }

  function isImagePlaceholder(value) {
    return /^image\s*\d+$/i.test(normalizeText(value));
  }

  function validateAnswerSet(currentChoices, answers, isMultiSelect) {
    if (!Array.isArray(currentChoices) || currentChoices.length === 0) return true;
    if (!Array.isArray(answers) || answers.length === 0) return false;

    const normalizedChoices = currentChoices.map(normalizeText).filter(Boolean);
    const normalizedAnswers = answers.map(normalizeText).filter(Boolean);
    if (normalizedAnswers.length === 0) return false;

    const usedChoiceIndexes = new Set();
    let matchedCount = 0;

    for (const answer of normalizedAnswers) {
      if (isImagePlaceholder(answer)) {
        const imageIdx = normalizedChoices.findIndex(
          (choice, idx) => !usedChoiceIndexes.has(idx) && /^image\s*\d+$/i.test(choice)
        );
        if (imageIdx >= 0) {
          usedChoiceIndexes.add(imageIdx);
          matchedCount += 1;
        }
        continue;
      }

      const ranked = normalizedChoices
        .map((choice, idx) => ({
          idx,
          score: fuzzyScore(answer, choice),
          exact: choice === answer,
          includes: containsTokenPhrase(choice, answer) || containsTokenPhrase(answer, choice)
        }))
        .filter(candidate => !usedChoiceIndexes.has(candidate.idx))
        .sort((a, b) => (Number(b.exact) - Number(a.exact)) || (b.score - a.score));

      const best = ranked[0];
      if (!best) continue;

      const runnerUp = ranked[1];
      const uniqueExact = best.exact && !runnerUp?.exact;
      const clearFuzzyMatch = best.score >= 0.85 && (!runnerUp || best.score - runnerUp.score >= 0.08);
      const clearPhraseMatch = best.includes && best.score >= 0.7 && (!runnerUp || !runnerUp.includes);
      if (uniqueExact || clearFuzzyMatch || clearPhraseMatch) {
        usedChoiceIndexes.add(best.idx);
        matchedCount += 1;
      }
    }

    if (isMultiSelect) return matchedCount === normalizedAnswers.length;
    return matchedCount >= 1;
  }

  function matchScore(buttonText, answer) {
    const a = normalizeText(buttonText);
    const b = normalizeText(answer);
    if (!a || !b) return 0;
    if (a === b) return 100;
    return Math.round(fuzzyScore(a, b) * 100);
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

  global.UwUKahootAIMatching = {
    validateAnswerSet,
    matchScore,
    computeTileOrder
  };
})(globalThis);
