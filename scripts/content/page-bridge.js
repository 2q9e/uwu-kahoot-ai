
(function () {
  'use strict';

  const TAG = '[UwU Kahoot AI]';
  const STYLE = 'color:#c026d3;font-weight:bold';
  const log = (...args) => console.log(`%c${TAG}`, STYLE, ...args);
  const warn = (...args) => console.warn(`%c${TAG}`, STYLE, ...args);
  const OldWebSocket = window.WebSocket;

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

  const _decodeTemplate = document.createElement('template');

  function decodeEntities(str) {
    if (typeof str !== 'string') return String(str ?? '');
    _decodeTemplate.innerHTML = str;
    return _decodeTemplate.content.textContent;
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

  window.WebSocket = function (url, protocols) {
    const ws = protocols ? new OldWebSocket(url, protocols) : new OldWebSocket(url);
    window.__kahootWS = ws;

    ws.addEventListener('message', function (event) {
      try {
        if (typeof event.data !== 'string') return;
        const data = JSON.parse(event.data);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item.clientId && !window.kahootClientId) window.kahootClientId = item.clientId;
          if (item.data?.gameid && window.kahootGameId !== item.data.gameid) {
            window.kahootGameId = item.data.gameid;
            window.kahootQuestionIndex = 0;
            log('Joined game session');
          }
          if (item.id) {
            const msgId = parseInt(item.id, 10);
            if (!isNaN(msgId) && msgId > window.kahootMessageId) window.kahootMessageId = msgId;
          }
          if (item.data?.content) parseQuestionContent(item.data.content);
        }
      } catch (e) { console.debug(TAG, 'WS parse error:', e.message); }
    });

    ws.addEventListener('open', () => log('WS connected'));

    const origSend = ws.send.bind(ws);
    ws.send = function (data) {
      try {
        const parsed = JSON.parse(data);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item.data?.content) {
            const content = typeof item.data.content === 'string' ? JSON.parse(item.data.content) : item.data.content;
            if (content.type) log('WS OUT:', content.type);
          }
        }
      } catch (e) { console.debug(TAG, 'WS send parse error:', e.message); }
      return origSend(data);
    };

    ws.addEventListener('close', () => {
      log('WS closed');
      if (window.__kahootWS !== ws) return;
      window.__kahootWS = null;
      window.kahootClientId = null;
      window.kahootGameId = null;
      window.kahootQuestionIndex = 0;
      window.kahootMessageId = 0;
      window.dispatchEvent(new CustomEvent('kahootGameReset'));
    });

    return ws;
  };

  window.WebSocket.prototype = OldWebSocket.prototype;
  Object.defineProperties(window.WebSocket, {
    CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 }
  });

  function makePayload(contentObj) {
    const { kahootGameId: gameid, kahootClientId: clientId } = window;
    window.kahootMessageId++;
    return [{
      id: String(window.kahootMessageId),
      channel: '/service/controller',
      data: {
        gameid, type: 'message', host: 'kahoot.it',
        id: window.kahootDataId,
        content: JSON.stringify(contentObj)
      },
      clientId, ext: {}
    }];
  }

  function wsSend(payload) {
    const ws = window.__kahootWS;
    if (!ws || ws.readyState !== OldWebSocket.OPEN || !window.kahootGameId || !window.kahootClientId) {
      warn('Cannot send - WS not ready');
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }

  function sendAnswerOverWebSocket(content) {
    const questionType = content.type;
    let sent = false;
    try {
      sent = wsSend(makePayload(content));
    } catch (error) {
      warn(`${questionType} answer send failed`, error?.name || 'Error');
    }
    window.dispatchEvent(new CustomEvent('kahootAnswerDispatchResult', {
      detail: {
        sent,
        questionType,
        questionIndex: content.questionIndex ?? window.kahootQuestionIndex
      }
    }));
    return sent;
  }

  function waitForDomCondition(check, questionIndex, timeout = 1600) {
    const read = () => {
      if (!isCurrentQuestion(questionIndex)) return null;
      try { return check() ?? null; } catch (_) { return null; }
    };
    const immediate = read();
    if (immediate !== null && immediate !== false) return Promise.resolve(immediate);
    const root = document.documentElement;
    if (!root || typeof MutationObserver === 'undefined') return Promise.resolve(null);

    return new Promise(resolve => {
      let settled = false;
      let timer;
      const observer = new MutationObserver(() => {
        const value = read();
        if (value !== null && value !== false) finish(value);
      });
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(value);
      };
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'class', 'style', 'data-functional-selector']
      });
      timer = setTimeout(() => finish(read()), Math.max(0, timeout));
      const value = read();
      if (value !== null && value !== false) finish(value);
    });
  }

  function waitForSubmitButton(questionIndex, timeout = 1600) {
    return waitForDomCondition(() => findSubmitButton(), questionIndex, timeout);
  }

  const afterPaint = () => new Promise(resolve => requestAnimationFrame(resolve));

  function announceJumbleHandled(questionIndex, handled) {
    window.dispatchEvent(new CustomEvent('uwukahootaiJumbleHandled', {
      detail: { questionIndex, handled: !!handled }
    }));
  }

  function computeTileOrder(answer, tiles) {
    const answerLower = String(answer ?? '').toLowerCase().replace(/[\s\-]/g, '');
    if (!answerLower || !Array.isArray(tiles) || tiles.length === 0) return null;

    const tilesLower = tiles.map(tile => String(tile ?? '').toLowerCase().replace(/[\s\-]/g, ''));
    if (tilesLower.some(text => !text)) return null;
    if (tilesLower.reduce((length, text) => length + text.length, 0) !== answerLower.length) return null;

    const candidates = tilesLower
      .map((text, index) => ({ text, index, length: text.length }))
      .sort((left, right) => (right.length - left.length) || (left.index - right.index));

    const used = new Set();
    const greedyOrder = [];
    let greedyPosition = 0;

    while (greedyPosition < answerLower.length) {
      const next = candidates.find(candidate =>
        !used.has(candidate.index) && answerLower.startsWith(candidate.text, greedyPosition)
      );
      if (!next) break;
      used.add(next.index);
      greedyOrder.push(next.index);
      greedyPosition += next.length;
    }

    if (greedyPosition === answerLower.length && greedyOrder.length === tilesLower.length) return greedyOrder;
    if (tilesLower.length > 8) return null;

    const memo = new Map();

    function search(position, usedMask, usedCount) {
      if (usedCount === tilesLower.length) return position === answerLower.length ? [] : null;

      const key = `${position}:${usedMask}`;
      if (memo.has(key)) return memo.get(key);

      for (const candidate of candidates) {
        const bit = 1 << candidate.index;
        if ((usedMask & bit) !== 0 || !answerLower.startsWith(candidate.text, position)) continue;

        const suffix = search(position + candidate.length, usedMask | bit, usedCount + 1);
        if (suffix !== null) {
          const result = [candidate.index, ...suffix];
          memo.set(key, result);
          return result;
        }
      }

      memo.set(key, null);
      return null;
    }

    return search(0, 0, 0);
  }

  function findSubmitButton() {
    for (const sel of [
      '[data-functional-selector="submit-button"]',
      '[data-functional-selector="multi-select-submit-button"]',
      '[data-functional-selector="multi-select-submit"]',
      '[data-functional-selector="jumble-submit-button"]',
      '[data-functional-selector="slider-submit"]',
      '[data-functional-selector="text-answer-submit"]',
      '[data-functional-selector="pin-answer-submit"]',
      '[data-functional-selector="confirm"]',
      '[data-functional-selector*="submit"]',
      'button[type="submit"]'
    ]) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && btn.offsetParent !== null) return btn;
    }
    for (const btn of document.querySelectorAll('button')) {
      const text = btn.textContent.trim().toLowerCase();
      if (['submit', 'confirm', 'done', 'check'].includes(text) && !btn.disabled && btn.offsetParent !== null) return btn;
    }
    return null;
  }

  window.sendAutoClickMessage = function (choice) {
    sendAnswerOverWebSocket({ type: 'quiz', choice, questionIndex: window.kahootQuestionIndex });
  };

  window.sendMultiSelectMessage = function (choices) {
    sendAnswerOverWebSocket({
      type: 'multiple_select_quiz', choice: choices, questionIndex: window.kahootQuestionIndex
    });
  };

  window.addEventListener('autoClickAnswer', e => window.sendAutoClickMessage(e.detail));

  window.addEventListener('autoClickMultiSelect', e => window.sendMultiSelectMessage(e.detail));

  function getPinSvgPlacement(svgEl, x, y) {
    const imgEl = svgEl.querySelector('[data-functional-selector="media-container__media-image"]') || svgEl.querySelector('image');
    const viewBoxValues = String(svgEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const hasViewBox = viewBoxValues.length === 4 && viewBoxValues.every(Number.isFinite);
    const [minX, minY, vbWidth, vbHeight] = hasViewBox ? viewBoxValues : [0, 0, svgEl.viewBox?.baseVal?.width || 0, svgEl.viewBox?.baseVal?.height || 0];
    const imgX = parseFloat(imgEl?.getAttribute('x') || String(minX || 0));
    const imgY = parseFloat(imgEl?.getAttribute('y') || String(minY || 0));
    const imgWidth = parseFloat(imgEl?.getAttribute('width') || String(vbWidth || 0));
    const imgHeight = parseFloat(imgEl?.getAttribute('height') || String(vbHeight || 0));

    const svgX = imgX + (Math.max(0, Math.min(100, x)) / 100) * (imgWidth || vbWidth || 1);
    const svgY = imgY + (Math.max(0, Math.min(100, y)) / 100) * (imgHeight || vbHeight || 1);

    let clientX, clientY;
    const ctm = svgEl.getScreenCTM();
    if (ctm && typeof svgEl.createSVGPoint === 'function') {
      const pt = svgEl.createSVGPoint();
      pt.x = svgX;
      pt.y = svgY;
      const sp = pt.matrixTransform(ctm);
      clientX = sp.x;
      clientY = sp.y;
    } else {
      const rect = svgEl.getBoundingClientRect();
      const screenBaseX = hasViewBox ? minX : imgX;
      const screenBaseY = hasViewBox ? minY : imgY;
      const screenW = (hasViewBox ? vbWidth : imgWidth) || rect.width || 1;
      const screenH = (hasViewBox ? vbHeight : imgHeight) || rect.height || 1;
      clientX = rect.left + ((svgX - screenBaseX) / screenW) * rect.width;
      clientY = rect.top + ((svgY - screenBaseY) / screenH) * rect.height;
    }

    return {
      normalizedX: Math.max(0, Math.min(1, x / 100)),
      normalizedY: Math.max(0, Math.min(1, y / 100)),
      svgX,
      svgY,
      clientX,
      clientY,
    };
  }

  function applyPinViaReact(svgEl, placement) {
    const fiberKey = Object.keys(svgEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!fiberKey) return false;

    let fiber = svgEl[fiberKey];
    let depth = 0;
    while (fiber && depth < 40) {
      if (fiber.memoizedProps?.setPinValue) {
        fiber.memoizedProps.setPinValue({ x: placement.normalizedX, y: placement.normalizedY });
        log('setPinValue called at depth', depth);
        return true;
      }
      if (fiber.stateNode?.setPinValue) {
        fiber.stateNode.setPinValue({ x: placement.normalizedX, y: placement.normalizedY });
        return true;
      }
      fiber = fiber.return;
      depth++;
    }

    fiber = svgEl[fiberKey];
    depth = 0;
    while (fiber && depth < 40) {
      let hook = fiber.memoizedState;
      while (hook) {
        const val = hook.memoizedState;
        if (val && typeof val === 'object' && ('x' in val || 'pinX' in val) && hook.queue?.dispatch) {
          if ('pinX' in val) hook.queue.dispatch({ pinX: placement.normalizedX, pinY: placement.normalizedY });
          else hook.queue.dispatch({ x: placement.normalizedX, y: placement.normalizedY });
          return true;
        }
        hook = hook.next;
      }
      fiber = fiber.return;
      depth++;
    }

    return false;
  }

  function applyPinViaPointer(svgEl, placement) {
    const { clientX, clientY } = placement;
    const propsKey = Object.keys(svgEl).find(k => k.startsWith('__reactProps$'));
    if (propsKey) {
      const props = svgEl[propsKey];
      const fakeEvt = {
        clientX, clientY, pageX: clientX + window.scrollX, pageY: clientY + window.scrollY,
        button: 0, buttons: 1, preventDefault() {}, stopPropagation() {}, persist() {},
        target: svgEl, currentTarget: svgEl,
        nativeEvent: new MouseEvent('mousedown', { clientX, clientY, bubbles: true }),
        type: 'mousedown'
      };
      if (props.onMouseDown) props.onMouseDown(fakeEvt);
      if (props.onMouseUp) { fakeEvt.type = 'mouseup'; props.onMouseUp(fakeEvt); }
    }

    const evtInit = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
    svgEl.dispatchEvent(new MouseEvent('mousedown', evtInit));
    svgEl.dispatchEvent(new MouseEvent('mouseup', evtInit));
    svgEl.dispatchEvent(new MouseEvent('click', evtInit));
  }

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

  window.addEventListener('sliderWSSend', function (event) {
    const { value, questionIndex } = event.detail;
    if (!isCurrentQuestion(questionIndex)) return;
    const sent = sendAnswerOverWebSocket({
      type: 'slider',
      choice: value,
      questionIndex: window.kahootQuestionIndex
    });
    if (sent) log('Slider answer sent through WebSocket');
    else warn('Slider answer was not sent through WebSocket');
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
      const sent = sendAnswerOverWebSocket({
        type: 'slider',
        choice: clamped,
        questionIndex: window.kahootQuestionIndex
      });
      if (sent) log('Slider answer sent through WebSocket');
      else warn('Slider answer was not sent through WebSocket');
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

  log('Injected - listening');
})();
