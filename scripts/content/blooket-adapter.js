(function initBlooketAdapter(global) {
  'use strict';

  if (location.hostname !== 'play.blooket.com' || !global.UwUKahootAIDomAdapter) return;

  const QUESTION_SELECTORS = [
    '[class*="questionText"]',
    '[data-testid*="question-text" i]'
  ];
  const ANSWER_SELECTOR = '[class*="answerContainer"]';
  const adapter = global.UwUKahootAIDomAdapter;
  let observer;
  let debounceTimer;
  let lastQuestion = null;
  let sawChoiceGap = false;
  let waitingTitle = '';
  let questionIndex = 0;
  let enabled = false;
  let settingRevision = 0;
  let waitingForNextQuestion = false;
  const observedAnswerElements = new WeakSet();
  let markedAnswerElements = new Set();

  function isVisible(element) {
    if (!element?.isConnected) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return element.getClientRects().length > 0;
  }

  function readQuestion() {
    for (const selector of QUESTION_SELECTORS) {
      const elements = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      const element = elements.find(candidate => {
        const text = String(candidate.innerText || candidate.textContent || '').replace(/\s+/g, ' ').trim();
        return text.length > 0 && text.length <= 600;
      });
      if (element) {
        const title = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        if (title) return { element, title };
      }
    }
    return null;
  }

  function readChoices() {
    const candidates = Array.from(document.querySelectorAll(ANSWER_SELECTOR)).filter(isVisible);
    const elements = candidates.filter(element => !element.querySelector(ANSWER_SELECTOR));
    const choices = elements.map(element => adapter.cleanButtonText(element));
    if (choices.length < 2 || choices.some(choice => !choice)) {
      clearAnswerMarkers();
      return null;
    }
    markAnswerElements(elements);
    for (const element of elements) {
      if (!observedAnswerElements.has(element)) {
        element.addEventListener('click', onAnswerSelected, true);
        observedAnswerElements.add(element);
      }
    }
    return { elements, choices };
  }

  function clearAnswerMarkers() {
    for (const element of markedAnswerElements) element.removeAttribute('data-uwu-blooket-answer');
    markedAnswerElements.clear();
  }

  function markAnswerElements(elements) {
    const currentElements = new Set(elements);
    for (const element of markedAnswerElements) {
      if (!currentElements.has(element)) element.removeAttribute('data-uwu-blooket-answer');
    }
    for (const element of currentElements) element.setAttribute('data-uwu-blooket-answer', 'true');
    markedAnswerElements = currentElements;
  }

  function readQuestionPosition() {
    const selectors = [
      '[data-question-index]', '[data-question-number]',
      '[data-testid*="question-number" i]', '[class*="questionNumber" i]',
      '[class*="questionCounter" i]', '[class*="questionProgress" i]'
    ];
    for (const element of document.querySelectorAll(selectors.join(','))) {
      if (!isVisible(element)) continue;
      const index = element.getAttribute('data-question-index') || element.getAttribute('data-question-number');
      if (index && /^\d{1,4}$/.test(index.trim())) return `index:${index.trim()}`;
      const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      const position = text.match(/^(?:question\s*)?(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})$/i);
      if (position) return `position:${position[1]}/${position[2]}`;
    }
    return '';
  }

  function onAnswerSelected() {
    if (!enabled || waitingForNextQuestion) return;
    waitingForNextQuestion = true;
    sawChoiceGap = false;
    global.dispatchEvent(new CustomEvent('kahootGameReset', {
      detail: { status: 'Answer selected. Waiting for the next Blooket question.' }
    }));
  }

  function waitForChoiceRefresh(title) {
    if (waitingTitle === title) return;
    waitingTitle = title;
    global.dispatchEvent(new CustomEvent('kahootGameReset', {
      detail: { status: 'New Blooket question detected. Waiting for its answer choices to update.' }
    }));
  }

  function inspectPage() {
    clearTimeout(debounceTimer);
    const question = readQuestion();
    const answers = readChoices();
    const questionPosition = question ? readQuestionPosition() : '';
    if (!answers) {
      if (lastQuestion) sawChoiceGap = true;
      if (question && question.title !== lastQuestion?.title) waitForChoiceRefresh(question.title);
      return;
    }
    if (!question) return;

    const signature = JSON.stringify({ title: question.title, choices: answers.choices, questionPosition });
    const sameQuestionTitle = question.title === lastQuestion?.title;
    const sameChoiceContent = JSON.stringify(answers.choices) === JSON.stringify(lastQuestion?.choices);
    const answerElementsReplaced = Boolean(lastQuestion && answers.elements.length === lastQuestion.elements.length &&
      lastQuestion.elements.every(element => !element.isConnected));
    const questionPositionChanged = Boolean(questionPosition && lastQuestion?.questionPosition &&
      questionPosition !== lastQuestion.questionPosition);
    const questionChanged = lastQuestion && (!sameQuestionTitle || questionPositionChanged);
    if (lastQuestion && signature === lastQuestion.signature && !sawChoiceGap &&
        !(waitingForNextQuestion && answerElementsReplaced)) return;

    if (questionChanged && sameChoiceContent && !sawChoiceGap && !questionPositionChanged && !answerElementsReplaced) {
      waitForChoiceRefresh(question.title);
      return;
    }

    lastQuestion = {
      title: question.title,
      questionPosition,
      choices: [...answers.choices],
      elements: [...answers.elements],
      signature
    };
    sawChoiceGap = false;
    waitingForNextQuestion = false;
    waitingTitle = '';
    questionIndex += 1;
    global.dispatchEvent(new CustomEvent('kahootQuestionParsed', {
      detail: {
        title: question.title,
        choices: answers.choices,
        type: 'quiz',
        questionIndex
      }
    }));
  }

  function scheduleInspection() {
    if (!enabled) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(inspectPage, 100);
  }

  function start() {
    if (!enabled) return;
    const root = document.documentElement;
    if (!root || observer) return;
    observer = new MutationObserver(scheduleInspection);
    observer.observe(root, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden', 'style'],
      subtree: true
    });
    scheduleInspection();
  }

  function setEnabled(nextValue) {
    const nextEnabled = nextValue !== false;
    if (enabled === nextEnabled) return;
    enabled = nextEnabled;
    if (enabled) {
      lastQuestion = null;
      sawChoiceGap = false;
      waitingTitle = '';
      waitingForNextQuestion = false;
      start();
      return;
    }
    clearTimeout(debounceTimer);
    observer?.disconnect();
    observer = null;
    clearAnswerMarkers();
  }

  global.addEventListener('kahootQuestionRescan', scheduleInspection);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !Object.hasOwn(changes, 'pluginEnabled')) return;
    settingRevision += 1;
    setEnabled(changes.pluginEnabled.newValue);
  });

  const initialRevision = settingRevision;
  chrome.storage.sync.get('pluginEnabled').then(({ pluginEnabled }) => {
    if (settingRevision === initialRevision) setEnabled(pluginEnabled);
  }).catch(() => {
    if (settingRevision === initialRevision) setEnabled(true);
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (enabled) start();
  }, { once: true });
})(globalThis);
