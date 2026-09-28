import { callModel, callVision } from './provider-client.js';
import { providerLabel } from './provider-config.js';
import { NEED_IMAGE, getQuestionSetup, log } from './question-runtime.js';

export async function answerOpenEndedQuestion(title, imageUrl, options = {}) {
  const { apiKey, model, visionModel, provider, requestContext } = await getQuestionSetup(options);
  if (!apiKey) throw new Error(`No ${providerLabel(provider)} API key configured.`);

  const prompt = `Quiz question: "${title}"\n\nThis is a fill-in-the-blank or short answer quiz question. Give the most likely intended answer.\nIf it's a fill-in-the-blank (contains ___ or a gap), give the word or short phrase that best completes the sentence.\nThink about what a teacher or quiz creator would expect as the correct answer.\nRespond with ONLY the answer - max 20 characters, no explanation.`;

  const needImageHint = imageUrl
    ? '\nIMPORTANT: You are NOT seeing any image. If the question refers to visual content (code, diagram, graph, photo, equation, table) that you cannot see and that is essential to determine the answer, respond with ONLY: NEED_IMAGE. Do NOT guess when the answer depends on unseen visual content.'
    : '';

  const data = await callModel(provider, apiKey, model, prompt, {
    ...requestContext,
    systemPrompt: 'You answer quiz questions with short, precise answers. Your answer must be 20 characters or fewer. For fill-in-the-blank questions, give the single most expected word or phrase that completes the sentence. Think like a student answering a classroom quiz. Give only the answer - no explanation.' + needImageHint,
    maxTokens: 24,
    reasoningEffort: 'medium'
  });

  let answer = (data?.choices?.[0]?.message?.content || '').trim();

  if (imageUrl && answer.toUpperCase().includes(NEED_IMAGE)) {
    log('Model requested image context for open-ended — retrying with vision');
    return await answerOpenEndedWithVision(title, imageUrl, apiKey, visionModel, provider, requestContext);
  }

  answer = answer.replace(/^["'`*_]+|["'`*_]+$/g, '');
  answer = answer.replace(/^(?:the answer is|answer:|it'?s)\s*/i, '');
  answer = answer.replace(/[.!]$/, '');
  answer = answer.trim();
  if (answer.length > 20) answer = answer.substring(0, 20);
  if (!answer) throw new Error('Empty answer from AI');
  log(`Open-ended answer received (${answer.length} chars).`);
  return answer;
}

async function answerOpenEndedWithVision(title, imageUrl, apiKey, visionModel, provider, requestContext = {}) {
  const prompt = `Quiz question: "${title}"\n\nThe image contains information needed to answer this question. Look at it carefully.\nThis is a short-answer quiz question. Give the most likely intended answer.\nRespond with ONLY the answer — max 20 characters, no explanation.`;

  const raw = await callVision(provider, apiKey, visionModel,
    'You answer quiz questions with short, precise answers based on image content. Your answer must be 20 characters or fewer. Give only the answer — no explanation.',
    prompt, imageUrl, { ...requestContext, maxTokens: 300 });

  let answer = raw.replace(/^["'`*_]+|["'`*_]+$/g, '');
  answer = answer.replace(/^(?:the answer is|answer:|it'?s)\s*/i, '');
  answer = answer.replace(/[.!]$/, '');
  answer = answer.trim();
  if (answer.length > 20) {
    const lines = answer.split('\n').map(l => l.trim()).filter(Boolean);
    const lastShort = lines.reverse().find(l => l.length <= 20);
    if (lastShort) answer = lastShort;
    else answer = answer.substring(0, 20);
  }
  if (!answer) throw new Error('Empty answer from vision AI');
  log(`Vision open-ended answer received (${answer.length} chars).`);
  return answer;
}
