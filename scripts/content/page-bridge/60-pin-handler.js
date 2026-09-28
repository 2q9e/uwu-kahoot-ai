window.addEventListener('autoPinAnswer', function (event) {
  const { x, y, questionIndex } = event.detail;
  if (!isCurrentQuestion(questionIndex)) return;
  log('Pin placement started');

  const svgEl = document.querySelector('[data-functional-selector="pin-input-svg"]');
  if (!svgEl) { warn('Pin SVG not found'); return; }

  const placement = getPinSvgPlacement(svgEl, x, y);
  let pinSet = applyPinViaReact(svgEl, placement);

  if (!pinSet) {
    applyPinViaPointer(svgEl, placement);
    pinSet = true;
    log('Pin fallback: pointer placement used');
  }

  const sent = sendAnswerOverWebSocket({
    type: 'pin_it', pinX: placement.normalizedX, pinY: placement.normalizedY,
    questionIndex: window.kahootQuestionIndex
  });
  if (sent) log('Pin coordinates sent through WebSocket');
  else warn('Pin coordinates were not sent through WebSocket');

  log(`Pin placement complete (React state updated: ${pinSet})`);

  (async () => {
    await afterPaint();
    if (!isCurrentQuestion(questionIndex)) return;
    let btn = await waitForSubmitButton(questionIndex, 1200);
    if (!isCurrentQuestion(questionIndex)) return;
    btn = findSubmitButton() || (btn?.isConnected && !btn.disabled ? btn : null);
    if (btn) {
      btn.click();
      log('Pin submit clicked');
    } else {
      log('Pin submit button not found');
    }
  })();
});
