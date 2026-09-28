import { DEFAULT_MODEL } from '../core/constants.js';
import { callModel } from './provider-client.js';
import { providerLabel } from './provider-config.js';
import { getQuestionSetup, log } from './question-runtime.js';

export async function answerJumbleQuestion(title, tiles, options = {}) {
  const { apiKey, model, provider, requestContext } = await getQuestionSetup(options);
  if (!apiKey) throw new Error(`No ${providerLabel(provider)} API key configured.`);
  if (!tiles || tiles.length === 0) throw new Error('No jumble tiles provided.');

  const tileList = tiles.map(t => `"${t}"`).join(', ');
  const prompt = `Question: ${title}\n\nThe answer is formed by arranging these tiles in the correct order: ${tileList}\n\nYou must use ALL tiles exactly once. What word or phrase do these tiles spell when arranged correctly to answer the question?\nReply with ONLY the answer word/phrase. Nothing else.`;
  const useModel = provider === 'openai' && model.includes('nano') ? DEFAULT_MODEL : model;

  const data = await callModel(provider, apiKey, useModel, prompt, {
    ...requestContext,
    systemPrompt: 'You are a quiz expert. Given shuffled tiles that form a word/phrase, determine the correct answer. Reply with ONLY the answer word or phrase. No explanation, no quotes.',
    maxTokens: 50
  });

  const raw = (data?.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '');
  log('Jumble answer received.');
  return raw;
}
