
export function normalizeText(value) {
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

export function shortText(value, max = 60) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

export function fuzzyScore(a, b) {
  const textA = String(a ?? '');
  const textB = String(b ?? '');
  if (!textA || !textB) return 0;
  if (textA === textB) return 1;

  const wordsA = textA.split(/\s+/).filter(Boolean);
  const wordsB = textB.split(/\s+/).filter(Boolean);
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

  const containsPhrase = containsTokenPhrase(textA, textB) || containsTokenPhrase(textB, textA);
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
