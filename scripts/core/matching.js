import { MIN_TEXT_MATCH_SCORE } from './constants.js';
import { fuzzyScore, normalizeText } from './text.js';

function isImagePlaceholder(value) {
  return /^image\s*\d+$/i.test(normalizeText(value));
}

export function validateAnswerSet(currentChoices, answers, isMultiSelect = false) {
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
    const clearFuzzyMatch = best.score >= MIN_TEXT_MATCH_SCORE && (!runnerUp || best.score - runnerUp.score >= 0.08);
    const clearPhraseMatch = best.includes && best.score >= 0.7 && (!runnerUp || !runnerUp.includes);
    if (uniqueExact || clearFuzzyMatch || clearPhraseMatch) {
      usedChoiceIndexes.add(best.idx);
      matchedCount += 1;
    }
  }

  if (isMultiSelect) return matchedCount === normalizedAnswers.length;
  return matchedCount >= 1;
}

export function selectBestChoice(rawAnswer, choices) {
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`No choices to match against for answer: "${rawAnswer}"`);
  }

  const cleaned = normalizeText(rawAnswer);
  if (!cleaned) return null;

  const exactMatches = choices.filter(choice => normalizeText(choice) === cleaned);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const phraseMatches = choices.filter(choice => {
    const normalizedChoice = normalizeText(choice);
    return containsTokenPhrase(normalizedChoice, cleaned) || containsTokenPhrase(cleaned, normalizedChoice);
  });
  if (phraseMatches.length === 1) return phraseMatches[0];
  if (phraseMatches.length > 1) return null;

  const scored = choices
    .map(choice => ({ choice, score: fuzzyScore(cleaned, normalizeText(choice)) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < MIN_TEXT_MATCH_SCORE) return null;
  if (runnerUp && best.score - runnerUp.score < 0.08) return null;
  return best.choice;
}

function containsTokenPhrase(text, phrase) {
  return phrase.length >= 3 && (` ${text} `).includes(` ${phrase} `);
}

export function parseMultiSelectResponse(raw, choices) {
  const text = String(raw || '');
  const lines = text.split('\n');

  const yesNums = [];
  let hasExplicitMarks = false;
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:option\s*)?(\d+)\s*[:.)-]\s*(YES|Y|NO|N)\b\s*$/i);
    if (!match) continue;
    hasExplicitMarks = true;
    const number = parseInt(match[1], 10);
    if ((match[2].toUpperCase() === 'YES' || match[2].toUpperCase() === 'Y') &&
        number >= 1 && number <= choices.length) yesNums.push(number);
  }

  if (hasExplicitMarks) {
    const unique = [...new Set(yesNums)].sort((a, b) => a - b);
    if (unique.length) return unique.map(number => choices[number - 1]);
    throw new Error('No affirmative options were identified in the multi-select response.');
  }

  const isNumberList = /^\s*(?:[-*]\s*)?\d+(?:\s*[,;]\s*(?:[-*]\s*)?\d+)*(?:\s+and\s+\d+)?\s*$/i.test(text);
  if (isNumberList) {
    const nums = [...text.matchAll(/\b\d+\b/g)].map(match => parseInt(match[0], 10));
    const validNums = [...new Set(nums.filter(number => number >= 1 && number <= choices.length))].sort((a, b) => a - b);
    if (validNums.length) return validNums.map(number => choices[number - 1]);
  }

  throw new Error(`Could not parse multi-select answer: "${raw}"`);
}

export function parsePinCoordinates(raw) {
  const lines = String(raw || '').trim().split(/\n+/).map(line => line.trim()).filter(Boolean);
  const finalLine = lines.at(-1) || '';
  let match = finalLine.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);

  if (!match) {
    const coordinateLines = lines.filter(line => /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(line.trim()));
    if (coordinateLines.length === 1) {
      match = coordinateLines[0].match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    }
  }

  if (!match) {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i -= 1) {
      match = lines[i].match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      if (match) break;
    }
  }

  if (!match) {
    throw new Error(`Could not parse coordinates from model output: "${raw}"`);
  }

  const x = parseFloat(match[1]);
  const y = parseFloat(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Could not parse coordinates from model output: "${raw}"`);
  }

  if (x < -50 || x > 150 || y < -50 || y > 150) {
    throw new Error(`Pin coordinates out of range: ${x},${y}`);
  }

  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y))
  };
}

export function snapSliderValue(value, sliderConfig = {}) {
  const { min, max, step } = sliderConfig;
  let next = Number(value);
  if (!Number.isFinite(next)) throw new Error(`Invalid slider value: ${value}`);
  if (Number.isFinite(min) && Number.isFinite(step) && step > 0) {
    next = min + Math.round((next - min) / step) * step;
  }
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);
  return Number.isInteger(next) ? next : Number(next.toFixed(6));
}

export function computeTileOrder(answer, tiles) {
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
