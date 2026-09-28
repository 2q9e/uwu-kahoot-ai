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
