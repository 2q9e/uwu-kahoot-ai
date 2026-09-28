window.addEventListener('autoTypeAnswer', async function (event) {
  const { answer, autoClick, questionIndex } = event.detail;
  if (!isCurrentQuestion(questionIndex)) return;
  log(`Open-ended answer received (${answer.length} characters); auto-click:`, autoClick);

  const input = document.querySelector('input[data-functional-selector="text-answer-input"]');
  if (!input) {
    warn('Open-ended input not found');
    return;
  }

  const rawMaxLen = parseInt(input.getAttribute('maxlength'), 10);
  const maxLen = (rawMaxLen > 0) ? rawMaxLen : 20;
  const trimmed = answer.slice(0, maxLen);

  input.focus();

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  for (let i = 0; i < trimmed.length; i++) {
    if (!isCurrentQuestion(questionIndex)) return;
    const char = trimmed[i];
    const currentVal = trimmed.slice(0, i + 1);

    if (nativeSetter) {
      nativeSetter.call(input, currentVal);
    } else {
      input.value = currentVal;
    }

    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: char
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

  }
  if (!isCurrentQuestion(questionIndex)) return;

  log(`Open-ended answer typed (${trimmed.length} characters)`);

  input.dispatchEvent(new Event('change', { bubbles: true }));

  if (!autoClick) {
    log('AutoClick off - answer typed but not submitting');
    return;
  }

  const btn = await waitForSubmitButton(questionIndex, 3000);
  if (!isCurrentQuestion(questionIndex)) return;
  if (btn) {
    btn.click();
    log('Open-ended submit clicked');
  } else {
    log('Open-ended submit button not found/enabled before timeout');
  }
});
