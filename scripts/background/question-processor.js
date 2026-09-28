import { AI_REQUEST_BUDGET_MS } from '../ai/provider-client.js';
import {
  answerJumbleQuestion,
  answerMultiSelect,
  answerOpenEndedQuestion,
  answerPinQuestion,
  answerQuestion,
  answerSliderQuestion
} from '../ai/answer-questions.js';
import { classifyAiFailure, diagnosticPresentation } from './diagnostics.js';

export function createQuestionProcessor({
  recordGeneratedAnswer,
  recordDiagnostic,
  sendToTab,
  sendToTabAsync,
  log,
  err
}) {
  async function getQuestionImage(question, tabId, frameId, requestId) {
    if (question.imageUrl) return question.imageUrl;
    const response = await sendToTabAsync(tabId, frameId, 'getQuestionImageUrl', { requestId });
    if (response?.stale) throw new Error('Question changed before the image could be read.');
    return response?.imageUrl || null;
  }

  return async function handleQuestion(question, tabId, frameId, requestId, solveId, signal) {
    if (!question?.title || !tabId) return;
    const startedAt = performance.now();
    const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`;
    let stage = 'settings';
    let activeProvider = null;
    let activeModel = null;
    let activeAttempt = null;
    let activeHttpStatus = null;

    const answerOptions = {
      signal,
      deadline: Date.now() + AI_REQUEST_BUDGET_MS,
      onProgress: progress => {
        stage = 'provider';
        activeProvider = progress.provider || activeProvider;
        activeModel = progress.model || activeModel;
        activeAttempt = progress.attempt || activeAttempt;
        if (progress.event === 'attempt') activeHttpStatus = null;
        if (progress.event === 'failed') activeHttpStatus = progress.httpStatus || null;
        sendToTab(tabId, frameId, 'answerProgress', { ...progress, requestId });
      }
    };

    const publishAnswer = async (statsAnswer, responseMs, action, payload) => {
      const statsWrite = recordGeneratedAnswer(solveId, question, statsAnswer, responseMs, signal);
      stage = 'dispatch';
      sendToTab(tabId, frameId, action, { ...payload, elapsed: elapsed(), requestId });
      await statsWrite;
    };

    log(`Question received | Type: ${question.type || 'unknown'} | Choices: ${(question.choices || []).length}`);

    try {
      const settings = await chrome.storage.sync.get([
        'highlightOption',
        'autoClickOption',
        'pinHighlightOption',
        'pinAutoClickOption',
        'answerDelay',
        'silentMode'
      ]);

      const options = {
        highlight: settings.highlightOption !== false,
        autoClick: settings.autoClickOption !== false,
        answerDelay: settings.answerDelay ?? 0,
        silentMode: !!settings.silentMode
      };

      if (question.type === 'pin_it') {
        options.highlight = settings.pinHighlightOption !== false;
        options.autoClick = !!settings.pinAutoClickOption;
      }

      switch (question.type) {
        case 'pin_it': {
          let imageUrl = question.imageUrl;
          let imageSource = imageUrl ? 'websocket' : null;
          if (!imageUrl) {
            stage = 'image';
            const response = await sendToTabAsync(tabId, frameId, 'getPinImageUrl', { requestId });
            if (response?.stale) throw new Error('Question changed before the image could be read.');
            imageUrl = response?.imageUrl;
            imageSource = imageUrl ? 'dom' : null;
          }
          if (!imageUrl) throw new Error('No image found for pin question');
          log(`Pin image found (${imageSource})`);
          stage = 'provider';
          const aiStartedAt = performance.now();
          const coords = await answerPinQuestion(question.title, imageUrl, answerOptions);
          if (signal?.aborted) return;
          const responseMs = Math.round(performance.now() - aiStartedAt);
          log(`Pin answer ready (${elapsed()})`);
          await publishAnswer(`${coords.x}, ${coords.y}`, responseMs, 'placePin', { coords, options });
          break;
        }

        case 'jumble': {
          stage = 'provider';
          const aiStartedAt = performance.now();
          const answerWord = await answerJumbleQuestion(question.title, question.choices, answerOptions);
          if (signal?.aborted) return;
          const responseMs = Math.round(performance.now() - aiStartedAt);
          log(`Jumble answer ready (${elapsed()})`);
          await publishAnswer(answerWord, responseMs, 'reorderJumble', { answerWord, options });
          break;
        }

        case 'slider': {
          stage = 'image';
          const imageUrl = await getQuestionImage(question, tabId, frameId, requestId);
          stage = 'provider';
          const aiStartedAt = performance.now();
          const value = await answerSliderQuestion(question.title, question.sliderConfig || {}, imageUrl, answerOptions);
          if (signal?.aborted) return;
          const responseMs = Math.round(performance.now() - aiStartedAt);
          log(`Slider answer ready (${elapsed()})`);
          await publishAnswer(value, responseMs, 'setSlider', { value, options });
          break;
        }

        case 'open_ended': {
          stage = 'image';
          const imageUrl = await getQuestionImage(question, tabId, frameId, requestId);
          stage = 'provider';
          const aiStartedAt = performance.now();
          const answer = await answerOpenEndedQuestion(question.title, imageUrl, answerOptions);
          if (signal?.aborted) return;
          const responseMs = Math.round(performance.now() - aiStartedAt);
          log(`Open-ended answer ready (${elapsed()})`);
          await publishAnswer(answer, responseMs, 'typeOpenEnded', { answer, options });
          break;
        }

        default: {
          stage = 'image';
          const imageUrl = await getQuestionImage(question, tabId, frameId, requestId);
          const isMultiSelect = question.type === 'multiple_select_quiz';
          stage = 'provider';
          const aiStartedAt = performance.now();
          const answers = isMultiSelect
            ? await answerMultiSelect(question.title, question.choices, imageUrl, answerOptions)
            : [await answerQuestion(question.title, question.choices, imageUrl, answerOptions)];
          if (signal?.aborted) return;
          const responseMs = Math.round(performance.now() - aiStartedAt);
          log(`Answer ready | Choices: ${answers.length} (${elapsed()})`);
          await publishAnswer(answers.join(' · '), responseMs, 'highlightAnswer', {
            answers,
            isMultiSelect,
            options
          });
        }
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        log(`Question request cancelled (${elapsed()})`);
        return;
      }
      const code = classifyAiFailure(error, stage);
      const diagnostic = diagnosticPresentation(code);
      const metadata = {
        stage,
        provider: activeProvider,
        model: activeModel,
        httpStatus: error?.status || activeHttpStatus,
        errorName: error?.name,
        attempt: activeAttempt
      };
      err(`Question processing failed (${elapsed()})`, code, error?.status ? `HTTP ${error.status}` : '');
      await recordDiagnostic(code, metadata);
      sendToTab(tabId, frameId, 'showError', {
        message: diagnostic.title,
        suggestion: diagnostic.recovery,
        diagnosticCode: diagnostic.code,
        requestId
      });
    }
  };
}
