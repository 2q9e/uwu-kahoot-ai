window.addEventListener('autoJumbleAnswer', async function (event) {
  const { answerWord, autoClick, questionIndex } = event.detail;
  if (!isCurrentQuestion(questionIndex)) return;
  log('Jumble answer received; auto-click:', autoClick);

  if (!autoClick) {
    log('AutoClick off - skipping WS and React for jumble');
    return;
  }

  const wsTiles = window.kahootWSTiles || [];
  log(`WebSocket tiles available: ${wsTiles.length}`);
  if (wsTiles.length === 0 || !answerWord) {
    announceJumbleHandled(questionIndex, false);
    return;
  }

  const wsOrder = computeTileOrder(answerWord, wsTiles);
  let wsSent = false;
  if (wsOrder) {
    wsSent = wsSend(makePayload({ type: 'jumble', choice: wsOrder, answer: wsOrder, sequence: wsOrder, questionIndex: window.kahootQuestionIndex }));
    if (wsSent) {
      log('Jumble answer sent through WebSocket');
      announceJumbleHandled(questionIndex, true);
    }
  } else {
    announceJumbleHandled(questionIndex, false);
    return;
  }

  const arrangerEl = await waitForDomCondition(
    () => document.querySelector('[class*="arranger__Container"]'), questionIndex, 2000
  );
  if (!isCurrentQuestion(questionIndex)) return;
  if (!arrangerEl) {
    log('No arranger container found - relying on WS submission only');
    if (!wsSent) announceJumbleHandled(questionIndex, false);
    return;
  }

  const domLabels = [];
  let i = 0;
  while (true) {
    const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
    if (!el) break;
    domLabels.push(el.textContent?.trim() || '');
    i++;
  }

  const domOrder = computeTileOrder(answerWord, domLabels);
  if (!isCurrentQuestion(questionIndex)) return;
  if (!domOrder) {
    warn('Could not compute DOM order');
    if (!wsSent) announceJumbleHandled(questionIndex, false);
    return;
  }
  log('Jumble order matched to page labels');

  let reactReordered = false;
  const fk = Object.keys(arrangerEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (fk) {
    let f = arrangerEl[fk], depth = 0;
    while (f && depth < 30) {
      if (f.memoizedProps?.setOrder) {
        try { f.memoizedProps.setOrder(domOrder); reactReordered = true; } catch (_) {}
      }
      let hook = f.memoizedState, hi = 0;
      while (hook) {
        const val = hook.memoizedState;
        if (Array.isArray(val) && val.length === domLabels.length && val.every(v => typeof v === 'number')) {
          if (hook.queue?.dispatch) {
            hook.queue.dispatch(domOrder);
            reactReordered = true;
          }
        }
        hook = hook.next; hi++;
      }
      if (reactReordered) break;
      f = f.return; depth++;
    }
  }

  if (reactReordered) {
    log('React state reordered');
    const submitReorderedAnswer = async () => {
      if (!isCurrentQuestion(questionIndex)) return;
      await afterPaint();
      if (!isCurrentQuestion(questionIndex)) return;
      let btn = await waitForSubmitButton(questionIndex, 1200);
      if (!isCurrentQuestion(questionIndex)) return;
      btn = findSubmitButton() || (btn?.isConnected && !btn.disabled ? btn : null);
      if (btn) {
        btn.click();
        if (!wsSent) announceJumbleHandled(questionIndex, true);
      } else if (!wsSent) {
        announceJumbleHandled(questionIndex, false);
      }
    };
    submitReorderedAnswer();
  } else if (!wsSent) {
    announceJumbleHandled(questionIndex, false);
  }
});
