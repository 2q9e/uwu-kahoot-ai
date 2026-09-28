window.sendAutoClickMessage = function (choice) {
  wsSend(makePayload({ type: 'quiz', choice, questionIndex: window.kahootQuestionIndex }));
};

window.sendMultiSelectMessage = function (choices) {
  wsSend(makePayload({ type: 'multiple_select_quiz', choice: choices, questionIndex: window.kahootQuestionIndex }));
};

window.addEventListener('autoClickAnswer', e => window.sendAutoClickMessage(e.detail));

window.addEventListener('autoClickMultiSelect', e => window.sendMultiSelectMessage(e.detail));
