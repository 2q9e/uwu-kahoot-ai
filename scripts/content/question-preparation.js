(function () {
  'use strict';

  const CHOICE_QUESTION_TYPES = new Set(['quiz', 'true_false', 'multiple_select_quiz']);
  const MAX_CHOICE_READINESS_ATTEMPTS = 3;

  function createQuestionPreparation(dependencies) {
    const {
      state,
      questionHash,
      createSolveId,
      cancelActiveRequest,
      sendQuestionToBackend,
      advanceSubmitNonce,
      removeTimerOverlay,
      broadcastToPopup,
      updateStatus,
      answerFeedbackUi,
      getExpectedChoiceCount,
      captureAnswerChoiceSnapshot,
      pollForAnswerChoices,
      pollForJumbleTiles,
      probeSliderConfigFast,
      pollForImageLabels,
      recordDiagnostic,
      log,
      warn,
      isInitialSettingsLoaded,
      getInitialSettingsPromise
    } = dependencies;

    async function waitForQuestionIntro(preparationNonce, incomingHash) {
      state.loadingEndsAt = 0;
      const readLoadingDuration = () => {
        const loadBar = document.querySelector('[data-functional-selector="loading-bar-progress"]');
        if (!loadBar) return false;
        const computedStyle = getComputedStyle(loadBar);
        const duration = parseFloat(computedStyle.getPropertyValue('--animation-duration')) || 0;
        const delay = parseFloat(computedStyle.getPropertyValue('--animation-delay')) || 0;
        if (duration + delay <= 0) return false;
        const introBuffer = 1500;
        state.loadingEndsAt = Date.now() + duration + delay + introBuffer;
        log(`Loading bar found: ${duration}+${delay}+${introBuffer}ms buffer = ${duration + delay + introBuffer}ms total`);
        return true;
      };

      for (let attempt = 0; attempt < 10; attempt++) {
        if (preparationNonce !== state.submitNonce || state.lastPreparedHash !== incomingHash) {
          log('Discarding loading timing from an outdated question.');
          return false;
        }
        if (readLoadingDuration()) break;
        if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 50));
      }
      return true;
    }

    async function waitForCompleteAnswerChoices(q, {
      incomingHash,
      expectedChoiceCount,
      dataChoiceCount,
      questionTransition,
      previousDomSnapshot
    }) {
      const requiredChoices = Math.max(2, expectedChoiceCount);
      const retryToken = state.currentQuestionReadiness?.retryToken || createSolveId();
      updateStatus('Waiting for on-screen answers…', dataChoiceCount
        ? `Kahoot data includes ${dataChoiceCount} choice${dataChoiceCount === 1 ? '' : 's'}. Checking the page for the complete set before sending anything to AI.`
        : 'No answer choices have arrived yet. Checking the page before sending anything to AI.');
      const choiceWaitNonce = state.submitNonce;
      state.currentQuestionReadiness = {
        choicesRequired: true,
        dataChoiceCount,
        expectedChoiceCount: requiredChoices,
        visibleChoiceCount: 0,
        choicesReady: false,
        recoveryExpired: false,
        retryToken
      };
      broadcastToPopup('updateQuestion', {
        question: { title: q.title, type: q.type, choices: q.choices || [] },
        state: 'waiting_for_choices',
        readiness: state.currentQuestionReadiness
      });

      let domChoices = [];
      let readinessAttempt = 0;
      while (readinessAttempt < MAX_CHOICE_READINESS_ATTEMPTS) {
        readinessAttempt += 1;
        domChoices = await pollForAnswerChoices(expectedChoiceCount, choiceWaitNonce, q.choices, questionTransition, previousDomSnapshot);
        if (choiceWaitNonce !== state.submitNonce || state.lastPreparedHash !== incomingHash) {
          log('Discarding answer choices from an outdated question.');
          return false;
        }
        if (domChoices.length >= 2) break;
        if (readinessAttempt < MAX_CHOICE_READINESS_ATTEMPTS) {
          log(`Answer choices are still incomplete; retrying readiness check (${readinessAttempt}/${MAX_CHOICE_READINESS_ATTEMPTS}).`);
          updateStatus('Still waiting for answer choices…', `The page has not shown a complete set yet. Checking again (${readinessAttempt + 1}/${MAX_CHOICE_READINESS_ATTEMPTS}); no AI request has been sent.`);
        }
      }
      if (domChoices.length < 2) {
        state.lastPreparedHash = null;
        state.currentSolveId = null;
        state.currentQuestion.choices = q.choices || [];
        state.questionState = 'waiting_for_choices';
        state.currentQuestionReadiness = {
          choicesRequired: true,
          dataChoiceCount,
          expectedChoiceCount: requiredChoices,
          visibleChoiceCount: domChoices.length,
          choicesReady: false,
          recoveryExpired: true,
          retryToken
        };
        recordDiagnostic('QUESTION_CHOICES_INCOMPLETE', {
          stage: 'detection',
          dataChoiceCount,
          visibleChoiceCount: domChoices.length,
          expectedChoiceCount: requiredChoices
        });
        broadcastToPopup('updateQuestion', {
          question: { title: q.title, type: q.type, choices: state.currentQuestion.choices },
          state: 'waiting_for_choices',
          readiness: state.currentQuestionReadiness
        });
        updateStatus('Waiting for answer choices (recovery expired)', `After ${readinessAttempt} checks, Kahoot data had ${dataChoiceCount} choice${dataChoiceCount === 1 ? '' : 's'} and the page showed ${domChoices.length}. At least ${requiredChoices} readable choices are needed. No AI request was sent.`);
        return false;
      }

      q.choices = domChoices;
      log(`Visible answer choices confirmed: ${domChoices.length}`);
      state.currentQuestion.choices = q.choices;
      state.currentQuestionReadiness = {
        choicesRequired: true,
        dataChoiceCount,
        expectedChoiceCount: requiredChoices,
        visibleChoiceCount: q.choices.length,
        choicesReady: true,
        recoveryExpired: false,
        retryToken
      };
      broadcastToPopup('updateQuestion', {
        question: { title: q.title, type: q.type, choices: q.choices },
        state: 'processing',
        readiness: state.currentQuestionReadiness
      });
      updateStatus('Answer choices ready', `${q.choices.length} choices are ready. Sending the question and choices to the selected provider.`);
      return true;
    }

    async function resolveImageChoiceLabels(q, preparationNonce, incomingHash) {
      const labels = await pollForImageLabels(q.choices.length, state.submitNonce, q.choices);
      if (preparationNonce !== state.submitNonce || state.lastPreparedHash !== incomingHash) {
        log('Discarding image labels from an outdated question.');
        return false;
      }
      if (labels.length === q.choices.length && labels.some(label => label && !/^Image \d+$/i.test(label))) {
        q.choices = labels;
        log(`Image choices resolved: ${labels.length}`);
      } else {
        log('Image labels unavailable; retaining numbered choices.');
      }
      return true;
    }

    window.addEventListener('kahootQuestionParsed', async (event) => {
      const q = event.detail;
      if (!q?.title) return;

      const isPin = q.type === 'pin_it';
      const isJumble = q.type === 'jumble';
      const isSlider = q.type === 'slider';
      const isOpenEnded = q.type === 'open_ended';
      const isChoiceQuestion = CHOICE_QUESTION_TYPES.has(q.type);
      const expectedChoiceCount = isChoiceQuestion ? getExpectedChoiceCount(q.type, q.choices) : 0;
      const dataChoiceCount = Array.isArray(q.choices) ? q.choices.filter(choice => String(choice ?? '').trim()).length : 0;

      if (!isPin && !isJumble && !isSlider && !isOpenEnded && !isChoiceQuestion) return;

      const incomingHash = questionHash(q);
      if (state.lastSentHash === incomingHash) {
        log('Dedup: skipping duplicate question event');
        return;
      }

      if (state.lastPreparedHash === incomingHash) {
        log('Dedup: question is already being prepared');
        return;
      }
      state.lastPreparedHash = incomingHash;
      const previousQuestion = state.currentQuestion;
      const questionTransition = !!previousQuestion && (
        q.title !== previousQuestion.title ||
        q.type !== previousQuestion.type ||
        String(q.questionIndex ?? '') !== String(previousQuestion.questionIndex ?? '')
      );
      const previousDomSnapshot = isChoiceQuestion ? captureAnswerChoiceSnapshot() : [];
      state.currentSolveId = createSolveId();
      cancelActiveRequest();
      state.lastSentHash = null;
      state.pendingRetryHash = null;
      state.hasRetried = false;
      state.currentQuestion = {
        title: q.title,
        choices: q.choices || [],
        type: q.type,
        questionIndex: q.questionIndex,
        imageUrl: q.imageUrl,
        ...(q.sliderConfig ? { sliderConfig: q.sliderConfig } : {})
      };
      state.currentAnswer = null;
      state.questionState = isChoiceQuestion ? 'waiting_for_choices' : 'processing';
      state.questionError = null;
      state.currentQuestionReadiness = {
        choicesRequired: isChoiceQuestion,
        dataChoiceCount,
        expectedChoiceCount: isChoiceQuestion ? Math.max(2, expectedChoiceCount) : 0,
        visibleChoiceCount: 0,
        choicesReady: !isChoiceQuestion,
        ...(isChoiceQuestion ? { recoveryExpired: false, retryToken: createSolveId() } : {})
      };
      advanceSubmitNonce();
      const preparationNonce = state.submitNonce;
      removeTimerOverlay();
      broadcastToPopup('updateQuestion', {
        question: { title: q.title, type: q.type, choices: q.choices || [] },
        state: state.questionState,
        readiness: state.currentQuestionReadiness
      });
      updateStatus('Preparing question…');
      const settingsPromise = isInitialSettingsLoaded() ? null : getInitialSettingsPromise();

      if (!await waitForQuestionIntro(preparationNonce, incomingHash)) return;

      answerFeedbackUi.cleanupOverlays();

      if (isChoiceQuestion) {
        const choicesReady = await waitForCompleteAnswerChoices(q, {
          incomingHash,
          expectedChoiceCount,
          dataChoiceCount,
          questionTransition,
          previousDomSnapshot
        });
        if (!choicesReady) return;
      }

      if (isJumble) {
        const domTiles = await pollForJumbleTiles();
        if (domTiles.length > 0) {
          q.choices = domTiles;
          log(`Jumble tiles read from page: ${domTiles.length}`);
        } else if (!q.choices?.length) {
          warn('No jumble tiles found');
          return;
        }
      }

      if (isSlider) {
        const domSliderConfig = await probeSliderConfigFast();
        q.sliderConfig = {
          min: q.sliderConfig?.min ?? domSliderConfig?.min ?? null,
          max: q.sliderConfig?.max ?? domSliderConfig?.max ?? null,
          step: q.sliderConfig?.step ?? domSliderConfig?.step ?? null,
          unit: q.sliderConfig?.unit || domSliderConfig?.unit || ''
        };
        log('Slider config merged:', q.sliderConfig);
      }

      state.questionState = 'processing';

      if (settingsPromise) await settingsPromise;

      if (!isPin && !isJumble && !isSlider && !isOpenEnded && q.choices.some(c => !c || /^Image \d+$/.test(c))) {
        const labelsResolved = await resolveImageChoiceLabels(q, preparationNonce, incomingHash);
        if (!labelsResolved) return;
      }

      const postPollHash = questionHash(q);
      if (state.lastPreparedHash !== incomingHash) {
        log('Dedup: discarding outdated question preparation');
        return;
      }
      if (state.lastSentHash === postPollHash) {
        log('Dedup: post-poll duplicate, skipping');
        return;
      }

      state.currentQuestion = {
        title: q.title,
        choices: q.choices || [],
        type: q.type,
        questionIndex: q.questionIndex,
        imageUrl: q.imageUrl,
        ...(q.sliderConfig ? { sliderConfig: q.sliderConfig } : {})
      };
      state.questionState = 'processing';
      state.questionError = null;
      advanceSubmitNonce();
      state.currentAnswer = null;
      state.hasRetried = false;
      state.pendingRetryHash = null;

      sendQuestionToBackend(q);
    });
  }

  globalThis.UwUKahootAIQuestionPreparation = { create: createQuestionPreparation };
})();
