import { snapSliderValue } from '../core/matching.js';
import { callModel, callVision } from './provider-client.js';
import { providerLabel } from './provider-config.js';
import { NEED_IMAGE, getQuestionSetup, log } from './question-runtime.js';

export async function answerSliderQuestion(title, sliderConfig, imageUrl, options = {}) {
  const { apiKey, model, visionModel, provider, requestContext } = await getQuestionSetup(options);
  if (!apiKey) throw new Error(`No ${providerLabel(provider)} API key configured.`);

  const { min, max, step, unit } = sliderConfig;
  const hasRange = min != null && max != null;

  let rangeInfo = '';
  let snapHint = '';
  if (hasRange) {
    rangeInfo = `\nRange: ${min} to ${max} (step: ${step || 'unknown'})${unit ? ` (unit: ${unit})` : ''}`;
    if (step) {
      const numSteps = Math.round((max - min) / step);
      if (numSteps <= 30) {
        const points = [];
        for (let i = 0; i <= numSteps; i++) points.push(min + i * step);
        snapHint = `\nValid values: ${points.join(', ')}`;
      } else {
        snapHint = `\nThe answer MUST be exactly: ${min} + (N x ${step}) for some integer N.`;
      }
    }
  } else {
    if (unit) rangeInfo = `\nUnit: ${unit}`;
    if (step) rangeInfo += `${rangeInfo ? ', ' : '\n'}Step size: ${step}`;
  }

  const prompt = `Question: ${title}\n\nThis is a slider question on a quiz. You need to pick the correct numeric value.${rangeInfo}${snapHint}\n\nIMPORTANT: Think carefully about the factual answer to this question first. This is a knowledge/trivia question - use your real-world knowledge to determine the correct answer${hasRange ? ', then pick the closest valid value in the range' : ''}.\n\nReply with ONLY a single number. No words, no units, no punctuation - just the number.`;

  const needImageHint = imageUrl
    ? '\nIMPORTANT: You are NOT seeing any image. If the question refers to visual content (code, diagram, graph, photo, equation, table) that you cannot see and that is essential to determine the answer, respond with ONLY: NEED_IMAGE.'
    : '';

  const data = await callModel(provider, apiKey, model, prompt, {
    ...requestContext,
    systemPrompt: 'You are a quiz-answering engine with strong general knowledge. For slider questions, think about the real-world factual answer first, then pick the closest valid value on the slider. Respond with ONLY a single number. No explanation, no units - just the number.' + needImageHint,
    maxTokens: 32,
    reasoningEffort: 'low'
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim();

  if (imageUrl && raw.toUpperCase().includes(NEED_IMAGE)) {
    log('Model requested image context for slider — retrying with vision');
    return await answerSliderWithVision(title, sliderConfig, imageUrl, apiKey, visionModel, provider, requestContext);
  }

  const cleaned = raw.replace(/[\s,]/g, '');
  const numMatch = cleaned.match(/-?[\d.]+/);
  if (!numMatch) throw new Error(`Could not parse slider answer: "${raw}"`);

  const value = parseFloat(numMatch[0]);
  if (isNaN(value)) throw new Error(`Could not parse slider answer: "${raw}"`);
  const snapped = snapSliderValue(value, sliderConfig);
  log('Slider answer parsed and snapped to the configured range.');
  return snapped;
}

async function answerSliderWithVision(title, sliderConfig, imageUrl, apiKey, visionModel, provider, requestContext = {}) {
  const { min, max, step, unit } = sliderConfig;
  const hasRange = min != null && max != null;
  let rangeInfo = '';
  if (hasRange) {
    rangeInfo = `\nRange: ${min} to ${max}${step ? ` (step: ${step})` : ''}${unit ? ` (unit: ${unit})` : ''}`;
  }

  const prompt = `Question: ${title}\n\nThe image contains information needed to answer this question. Look at it carefully.\nThis is a slider question — pick the correct numeric value.${rangeInfo}\nReply with ONLY a single number.`;

  const raw = await callVision(provider, apiKey, visionModel,
    'You are a quiz-answering engine with vision. Analyze the image to determine the correct numeric answer. Respond with ONLY a single number.',
    prompt, imageUrl, { ...requestContext, maxTokens: 300 });

  const allNumbers = [...raw.matchAll(/-?[\d.]+/g)];
  if (allNumbers.length === 0) throw new Error(`Could not parse vision slider answer: "${raw}"`);
  const value = parseFloat(allNumbers[allNumbers.length - 1][0]);
  if (isNaN(value)) throw new Error(`Could not parse vision slider answer: "${raw}"`);
  const snapped = snapSliderValue(value, sliderConfig);
  log('Vision slider answer parsed and snapped to the configured range.');
  return snapped;
}
