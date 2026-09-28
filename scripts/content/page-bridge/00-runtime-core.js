const TAG = '[UwU Kahoot AI]';
const STYLE = 'color:#c026d3;font-weight:bold';
const log = (...args) => console.log(`%c${TAG}`, STYLE, ...args);
const warn = (...args) => console.warn(`%c${TAG}`, STYLE, ...args);
const OldWebSocket = window.WebSocket;
window.__uwuKahootAIEnabled = true;
window.addEventListener('kahootPluginStateChanged', event => {
  window.__uwuKahootAIEnabled = event.detail?.enabled !== false;
});
for (const type of ['autoClickAnswer', 'autoClickMultiSelect', 'autoPinAnswer', 'autoJumbleAnswer', 'sliderWSSend', 'autoSliderAnswer', 'autoTypeAnswer']) {
  window.addEventListener(type, event => {
    if (window.__uwuKahootAIEnabled === false) event.stopImmediatePropagation();
  }, true);
}

window.__kahootWS = null;
window.kahootClientId = null;
window.kahootGameId = null;
window.kahootQuestionIndex = 0;
window.kahootMessageId = 0;
window.kahootDataId = 45;
window.kahootWSTiles = [];

const ANSWERABLE_TYPES = new Set(['quiz', 'true_false', 'multiple_select_quiz', 'pin_it', 'jumble', 'slider', 'open_ended']);
const PIN_TYPES = new Set(['pin_it']);
const JUMBLE_TYPES = new Set(['jumble']);
const SLIDER_TYPES = new Set(['slider']);
const OPEN_ENDED_TYPES = new Set(['open_ended']);
const isCurrentQuestion = questionIndex => questionIndex == null ||
  String(questionIndex) === String(window.kahootQuestionIndex);
