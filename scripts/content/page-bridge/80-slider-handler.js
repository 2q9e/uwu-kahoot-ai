window.addEventListener('sliderWSSend', function (event) {
  const { value, questionIndex } = event.detail;
  if (!isCurrentQuestion(questionIndex)) return;
  log('Slider answer sent through WebSocket');
  wsSend(makePayload({
    type: 'slider',
    choice: value,
    questionIndex: window.kahootQuestionIndex
  }));
});

window.addEventListener('autoSliderAnswer', function (event) {
  const { value, autoClick, skipWS, questionIndex } = event.detail;
  if (!isCurrentQuestion(questionIndex)) return;
  log('Slider answer received; auto-click:', autoClick, 'skip WebSocket:', !!skipWS);

  const rangeInput = document.querySelector('input[data-functional-selector="slider-scale"]');
  if (!rangeInput) {
    warn('Slider range input not found');
    return;
  }

  const rawMin = parseFloat(rangeInput.min);
  const rawMax = parseFloat(rangeInput.max);
  const rawStep = parseFloat(rangeInput.step);
  const min = isNaN(rawMin) ? 0 : rawMin;
  const max = isNaN(rawMax) ? 100 : rawMax;
  const step = isNaN(rawStep) ? 1 : rawStep;
  const snapped = min + Math.round((value - min) / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  log('Slider value snapped to the page range');

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(rangeInput, clamped);
  } else {
    rangeInput.value = clamped;
  }

  rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  rangeInput.dispatchEvent(new Event('change', { bubbles: true }));

  if (!autoClick) {
    log('AutoClick off - slider value set but not submitting');
    return;
  }

  if (!skipWS) {
    wsSend(makePayload({
      type: 'slider',
      choice: clamped,
      questionIndex: window.kahootQuestionIndex
    }));
    log('Slider answer sent through WebSocket');
  }

  (async () => {
    await afterPaint();
    if (!isCurrentQuestion(questionIndex)) return;
    let btn = await waitForSubmitButton(questionIndex, 1200);
    if (!isCurrentQuestion(questionIndex)) return;
    btn = findSubmitButton() || (btn?.isConnected && !btn.disabled ? btn : null);
    if (btn) {
      btn.click();
      log('Slider submit clicked');
    } else {
      log('Slider submit button not found');
    }
  })();
});
