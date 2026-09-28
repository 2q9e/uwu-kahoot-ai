import { parseMultiSelectResponse, selectBestChoice } from '../core/matching.js';
import { callModel, callVision, makeAbortError } from './provider-client.js';
import { providerLabel } from './provider-config.js';
import { NEED_IMAGE, getQuestionSetup, log, warn } from './question-runtime.js';
import {
  FAST_BINARY_ENABLED_KEY,
  getTrueFalseChoiceIndices,
  parseStrictTrueFalse,
  resolveFastBinaryModel
} from './fast-binary-routing.js';

function normalizeAnswerChoices(choices) {
  if (!Array.isArray(choices) || choices.length < 2) {
    throw new Error('No answer choices provided.');
  }
  const normalized = choices.map(choice => String(choice ?? '').trim());
  if (normalized.some(choice => !choice)) {
    throw new Error('Answer choices were missing or unreadable; refusing to send a question-only request.');
  }
  return normalized;
}

function resolveBestChoice(raw, choices) {
  const choice = selectBestChoice(raw, choices);
  if (!choice) throw new Error('The model output did not identify one answer choice clearly enough.');
  return choice;
}

export async function answerQuestion(title, choices, imageUrl, options = {}) {
  choices = normalizeAnswerChoices(choices);
  const { apiKey, model, visionModel, provider, requestContext } = await getQuestionSetup(options);
  if (!apiKey) throw new Error(`No ${providerLabel(provider)} API key configured.`);

  const settings = requestContext.settingsSnapshot || {};
  const trueFalseIndices = !imageUrl && settings[FAST_BINARY_ENABLED_KEY] !== false
    ? getTrueFalseChoiceIndices(choices)
    : null;
  if (trueFalseIndices) {
    const fastModel = await resolveFastBinaryModel(provider, settings, model);
    if (fastModel) {
      try {
        log(`Fast True/False route using ${providerLabel(provider)} model ${fastModel}`);
        const fastData = await callModel(provider, apiKey, fastModel,
          `Question: ${title}\n\nAvailable answers:\n1) ${choices[trueFalseIndices.trueIndex]}\n2) ${choices[trueFalseIndices.falseIndex]}\n\nAnswer with exactly TRUE or FALSE.`, {
            ...requestContext,
            attemptCounter: { value: 0 },
            systemPrompt: 'Decide whether the quiz statement is true or false. Output exactly one word: TRUE or FALSE. Do not explain, add punctuation, or output any other text.',
            maxTokens: 4,
            stop: ['\n'],
            reasoningEffort: 'none',
            reasoningEffortOverride: true
          });
        const fastAnswer = parseStrictTrueFalse(fastData?.choices?.[0]?.message?.content);
        if (fastAnswer !== null) return choices[fastAnswer ? trueFalseIndices.trueIndex : trueFalseIndices.falseIndex];
        warn('Fast model did not return exactly TRUE or FALSE; using the primary model.');
      } catch (error) {
        if (requestContext.signal?.aborted || error?.name === 'AbortError') throw makeAbortError();
        warn(`Fast model failed; using the primary model: ${error.message}`);
      }
    }
  }

  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nThink about what the question is really asking, then reply with ONLY the number (1-${choices.length}) of the correct answer.`;

  const needImageHint = imageUrl
    ? '\nIMPORTANT: You are NOT seeing any image. If the question refers to visual content (code, diagram, graph, photo, equation, table) that you cannot see and that is essential to determine the answer, respond with ONLY: NEED_IMAGE. Do NOT guess when the answer depends on unseen visual content.'
    : '';

  const data = await callModel(provider, apiKey, model, prompt, {
    ...requestContext,
    systemPrompt: 'You are a quiz-answering engine with strong general knowledge. Read the question carefully. Watch out for trick wording, negatives, and "best" qualifiers. Respond with ONLY a single number. No words, no punctuation.' + needImageHint,
    maxTokens: 16,
    stop: ['\n'],
    reasoningEffort: 'minimal'
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();

  if (imageUrl && raw.toUpperCase().includes(NEED_IMAGE)) {
    log('Model requested image context — retrying with vision model');
    try {
      return await answerQuestionWithVision(title, choices, imageUrl, apiKey, visionModel, provider, requestContext);
    } catch (visionErr) {
      if (requestContext.signal?.aborted || visionErr?.name === 'AbortError') throw makeAbortError();
      warn(`Required vision fallback failed: ${visionErr.message}`);
      throw visionErr;
    }
  }

  const match = raw.match(/\d+/);
  const idx = match ? parseInt(match[0], 10) : NaN;

  if (Number.isFinite(idx) && idx >= 1 && idx <= choices.length) {
    log(`Parsed choice #${idx}`);
    return choices[idx - 1];
  }

  warn('Number parse failed; trying text fallback.');
  return await answerTextFallback(title, choices, apiKey, model, provider, requestContext);
}


export async function answerMultiSelect(title, choices, imageUrl, options = {}) {
  choices = normalizeAnswerChoices(choices);
  const { apiKey, model, visionModel, provider, requestContext } = await getQuestionSetup(options);
  if (!apiKey) throw new Error(`No ${providerLabel(provider)} API key configured.`);

  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nThis is a multi-select quiz - there are MULTIPLE correct answers.\nFor EACH option, evaluate whether it DIRECTLY and CORRECTLY answers the question.\nMark YES only if the option is a correct answer. Mark NO if it is wrong, only partly true, or not what the question asks for.\nRespond with one line per option: NUMBER:YES or NUMBER:NO`;

  const needImageHint = imageUrl
    ? '\nIMPORTANT: You are NOT seeing any image. If the question refers to visual content (code, diagram, graph, photo, equation, table) that you cannot see and that is essential to evaluate the answers, respond with ONLY: NEED_IMAGE. Do NOT guess when the answers depend on unseen visual content.'
    : '';

  const data = await callModel(provider, apiKey, model, prompt, {
    ...requestContext,
    systemPrompt: 'You are a quiz-answering engine with strong general knowledge. For multi-select questions, evaluate EACH option independently. Mark YES only for options that directly and correctly answer the question. An option that is real but not relevant to what the question asks should be marked NO. Format: NUMBER:YES or NUMBER:NO, one per line.' + needImageHint,
    maxTokens: 120,
    reasoningEffort: 'low'
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();

  if (imageUrl && raw.toUpperCase().includes(NEED_IMAGE)) {
    log('Model requested image context for multi-select — retrying with vision');
    try {
      return await answerMultiSelectWithVision(title, choices, imageUrl, apiKey, visionModel, provider, requestContext);
    } catch (visionErr) {
      if (requestContext.signal?.aborted || visionErr?.name === 'AbortError') throw makeAbortError();
      warn(`Required multi-select vision fallback failed: ${visionErr.message}`);
      throw visionErr;
    }
  }

  try {
    const result = parseMultiSelectResponse(raw, choices);
    log(`Multi-select parsed ${result.length} answer(s).`);
    return result;
  } catch (parseErr) {
    warn(`Multi-select parse failed: ${parseErr.message} - single answer fallback`);
    const single = await answerTextFallback(title, choices, apiKey, model, provider, requestContext);
    return [single];
  }
}

async function answerTextFallback(title, choices, apiKey, model, provider, requestContext = {}) {
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nReply with the EXACT text of the correct option. Nothing else.`;

  const data = await callModel(provider, apiKey, model, prompt, {
    ...requestContext,
    systemPrompt: 'You solve multiple-choice questions. Reply with ONLY the exact text of the correct option. No explanation, no numbering.',
    maxTokens: 80
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  return resolveBestChoice(raw, choices);
}


async function answerQuestionWithVision(title, choices, imageUrl, apiKey, visionModel, provider, requestContext = {}) {
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nThe image contains information needed to answer this question. Look at it carefully.\nReply with ONLY the number (1-${choices.length}) of the correct answer.`;

  const raw = await callVision(provider, apiKey, visionModel,
    'You are a quiz-answering engine with vision. The image contains critical information (code, diagram, equation, table, etc). Analyze the image carefully, then respond with ONLY a single number for the correct answer.',
    prompt, imageUrl, requestContext);

  const numbers = [...raw.matchAll(/\b(\d+)\b/g)]
    .map(m => parseInt(m[1], 10))
    .filter(n => n >= 1 && n <= choices.length);

  if (numbers.length > 0) {
    const idx = numbers[numbers.length - 1];
    log(`Vision parsed choice #${idx}`);
    return choices[idx - 1];
  }

  warn('Vision number parse failed, trying text match');
  return resolveBestChoice(raw, choices);
}

async function answerMultiSelectWithVision(title, choices, imageUrl, apiKey, visionModel, provider, requestContext = {}) {
  const numbered = choices.map((c, i) => `${i + 1}) ${c}`).join('\n');
  const prompt = `Question: ${title}\n\n${numbered}\n\nThe image contains information needed to answer this question. Look at it carefully.\nThis is a multi-select quiz — there are MULTIPLE correct answers.\nFor EACH option, evaluate whether it is correct based on the question AND the image.\nRespond with one line per option: NUMBER:YES or NUMBER:NO`;

  const raw = await callVision(provider, apiKey, visionModel,
    'You are a quiz-answering engine with vision. The image contains critical information. For multi-select questions, evaluate EACH option against the image content. Format: NUMBER:YES or NUMBER:NO, one per line.',
    prompt, imageUrl, requestContext);

  try {
    const result = parseMultiSelectResponse(raw, choices);
    log(`Vision multi-select parsed ${result.length} answer(s).`);
    return result;
  } catch (parseErr) {
    warn(`Vision multi-select parse failed: ${parseErr.message}`);
    throw parseErr;
  }
}
