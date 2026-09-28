window.sendAutoClickMessage = function (choice) {
  const sent = wsSend(makePayload({ type: 'quiz', choice, questionIndex: window.kahootQuestionIndex }));
  window.dispatchEvent(new CustomEvent('kahootAnswerDispatchResult', {
    detail: { sent, questionIndex: window.kahootQuestionIndex }
  }));
};

window.sendMultiSelectMessage = function (choices) {
  const sent = wsSend(makePayload({ type: 'multiple_select_quiz', choice: choices, questionIndex: window.kahootQuestionIndex }));
  window.dispatchEvent(new CustomEvent('kahootAnswerDispatchResult', {
    detail: { sent, questionIndex: window.kahootQuestionIndex }
  }));
};

window.addEventListener('autoClickAnswer', e => window.sendAutoClickMessage(e.detail));

window.addEventListener('autoClickMultiSelect', e => window.sendMultiSelectMessage(e.detail));
