const _decodeEl = document.createElement('textarea');

function decodeEntities(str) {
  if (typeof str !== 'string') return String(str ?? '');
  _decodeEl.innerHTML = str;
  return _decodeEl.value.replace(/<[^>]*>/g, '');
}

function extractChoiceText(value, depth = 0) {
  if (depth > 3 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return decodeEntities(String(value)).trim();
  }
  if (Array.isArray(value)) {
    return value.map(item => extractChoiceText(item, depth + 1)).filter(Boolean).join(' ');
  }
  if (typeof value !== 'object') return '';

  const candidates = [
    value.text,
    value.label,
    value.choiceText,
    value.answerText,
    value.content,
    value.value,
    value.answer,
    value.choice,
    value.imageMetadata?.altText,
    value.media?.altText,
    value.alt,
    value.description
  ];
  for (const candidate of candidates) {
    const text = extractChoiceText(candidate, depth + 1);
    if (text) return text;
  }
  return '';
}

function getRawChoices(content) {
  let emptyArray = null;
  const sources = [content];
  if (content.question && typeof content.question === 'object' && !Array.isArray(content.question)) {
    sources.push(content.question);
  }
  for (const source of sources) {
    for (const key of ['choices', 'answers', 'answerOptions', 'answerChoices', 'options']) {
      if (!Array.isArray(source[key])) continue;
      if (source[key].length > 0) return source[key];
      emptyArray ||= source[key];
    }
  }
  return emptyArray || [];
}

const NON_SCORED_TYPES = new Set(['survey', 'word_cloud', 'poll']);

function parseQuestionContent(raw) {
  try {
    const content = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!content.title && !content.question) {
      if (ANSWERABLE_TYPES.has(content.type)) {
        window.dispatchEvent(new CustomEvent('kahootQuestionDataIssue', { detail: { code: 'QUESTION_TITLE_MISSING' } }));
      }
      return;
    }

    if (NON_SCORED_TYPES.has(content.type)) {
      window.dispatchEvent(new CustomEvent('kahootNonScoredQuestion', { detail: { type: content.type } }));
      return;
    }

    if (!ANSWERABLE_TYPES.has(content.type)) return;

    const isPin = PIN_TYPES.has(content.type);
    const isJumble = JUMBLE_TYPES.has(content.type);
    const isSlider = SLIDER_TYPES.has(content.type);
    const isOpenEnded = OPEN_ENDED_TYPES.has(content.type);

    let choices = [];
    let sliderConfig = null;

    if (isSlider) {
      const range = content.range || content.slider || {};
      sliderConfig = {
        min: range.min ?? content.min ?? null,
        max: range.max ?? content.max ?? null,
        step: range.step ?? content.step ?? null,
        unit: range.unit ?? content.unit ?? ''
      };
      log('Slider config from WS:', JSON.stringify(sliderConfig));
    } else if (isJumble) {
      const rawChoices = content.choices || [];
      choices = rawChoices.map(c => {
        if (typeof c === 'string') return decodeEntities(c);
        return decodeEntities(c.answer || c.text || c.label || String(c));
      });

      if (choices.length === 0 || choices.every(c => !c)) {
        let i = 0;
        while (true) {
          const el = document.querySelector(`[data-functional-selector="question-choice-text-${i}"]`);
          if (!el) break;
          choices.push(el.textContent?.trim() || '');
          i++;
        }
      }
      log(`Jumble tiles received: ${choices.length}`);
      window.kahootWSTiles = [...choices];
      if (choices.length === 0) return;
    } else if (!isPin && !isSlider && !isOpenEnded) {
      const rawChoices = getRawChoices(content);
      choices = rawChoices.map(choice => extractChoiceText(choice));

      const hasImages = choices.some(c => c === '') &&
        rawChoices.some(c => typeof c === 'object' && (c.image || c.imageUrl || c.media?.image || c.media?.url));
      if (hasImages) {
        choices = choices.map((c, i) => c || `Image ${i + 1}`);
      }
    }

    const imageUrl = content.image || content.media?.image || content.media?.url || null;
    if (isPin) log(`Pin image ${imageUrl ? 'found' : 'not in WebSocket data'}`);
    const title = content.title || (typeof content.question === 'string' ? content.question : content.question?.text || content.question?.title);
    if (!title) {
      window.dispatchEvent(new CustomEvent('kahootQuestionDataIssue', { detail: { code: 'QUESTION_TITLE_MISSING' } }));
      return;
    }

    const question = {
      title: decodeEntities(title),
      choices: (isPin || isSlider || isOpenEnded) ? [] : choices,
      type: content.type,
      questionIndex: content.questionIndex ?? window.kahootQuestionIndex,
      imageUrl,
      ...(isSlider && sliderConfig ? { sliderConfig } : {})
    };

    window.kahootQuestionIndex = question.questionIndex;
    window.dispatchEvent(new CustomEvent('kahootQuestionParsed', { detail: question }));
  } catch (_) {
    const expectedQuestion = (raw && typeof raw === 'object' && ANSWERABLE_TYPES.has(raw.type)) ||
      (typeof raw === 'string' && /"type"\s*:\s*"(?:quiz|true_false|multiple_select_quiz|pin_it|jumble|slider|open_ended)"/.test(raw));
    if (expectedQuestion) {
      window.dispatchEvent(new CustomEvent('kahootQuestionDataIssue', { detail: { code: 'QUESTION_DATA_UNREADABLE' } }));
    }
    console.debug(TAG, 'Question parse error.');
  }
}
