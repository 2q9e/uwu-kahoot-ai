(function initAnswerFeedbackUi(global) {
  'use strict';

  function createAnswerFeedbackUi({ domAdapter }) {
  const PIN_SVG_SELECTOR = '[data-functional-selector="pin-input-svg"]';
  const highlightedSliderMarkers = new Map();

  function nodeContains(node, target) {
    return node === target || !!node?.contains?.(target);
  }

  function sharedAncestor(elements) {
    let candidate = elements[0] || null;
    while (candidate && !elements.every(element => nodeContains(candidate, element))) {
      candidate = candidate.parentElement;
    }
    return candidate || document.body || document.documentElement;
  }

  function mutationTouchesTree(records, treeRoot, includeAncestors = false) {
    return records.some(record => {
      const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
      if (target && (treeRoot === target || treeRoot.contains?.(target))) return true;
      if (includeAncestors && target && target.contains?.(treeRoot)) return true;
      for (const node of record.addedNodes || []) if (nodeContains(node, treeRoot)) return true;
      for (const node of record.removedNodes || []) if (nodeContains(node, treeRoot)) return true;
      return false;
    });
  }

  function cleanupOverlays() {
    document.querySelectorAll('.uwukahootai-pin-crosshair, .uwukahootai-jumble-badge, .uwukahootai-checkmark').forEach(el => el.remove());
    for (const el of domAdapter.findAnswerElements()) {
      el.style.border = '';
      el.style.boxShadow = '';
      el.style.borderRadius = '';
      el.style.transition = '';
    }
    for (const [element, styles] of highlightedSliderMarkers) {
      if (!element.isConnected) continue;
      element.style.border = styles.border;
      element.style.boxShadow = styles.boxShadow;
      element.style.borderRadius = styles.borderRadius;
      element.style.transition = styles.transition;
    }
    highlightedSliderMarkers.clear();
  }

  function showPinCrosshair(svgEl, coords) {
    document.querySelectorAll('.uwukahootai-pin-crosshair').forEach(el => el.remove());

    const imgEl = svgEl.querySelector('[data-functional-selector="media-container__media-image"]')
      || svgEl.querySelector('image[href], image[xlink\\:href]')
      || svgEl.querySelector('image');
    const viewBox = String(svgEl.getAttribute('viewBox') || '').trim();
    const vb = viewBox ? viewBox.split(/[\s,]+/).map(Number) : [0, 0, 0, 0];
    const hasViewBox = vb.length === 4 && vb.every(Number.isFinite);
    const imgX = parseFloat(imgEl?.getAttribute('x') || String((hasViewBox ? vb[0] : 0) || 0));
    const imgY = parseFloat(imgEl?.getAttribute('y') || String((hasViewBox ? vb[1] : 0) || 0));
    const imgWidth = parseFloat(imgEl?.getAttribute('width') || String((hasViewBox ? vb[2] : 0) || 0));
    const imgHeight = parseFloat(imgEl?.getAttribute('height') || String((hasViewBox ? vb[3] : 0) || 0));
    const vbX = hasViewBox ? vb[0] : imgX;
    const vbY = hasViewBox ? vb[1] : imgY;
    const vbWidth = (hasViewBox ? vb[2] : imgWidth) || 1;
    const vbHeight = (hasViewBox ? vb[3] : imgHeight) || 1;

    const svgTargetX = imgX + (coords.x / 100) * (imgWidth || vbWidth);
    const svgTargetY = imgY + (coords.y / 100) * (imgHeight || vbHeight);

    let screenX, screenY;
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = svgTargetX; pt.y = svgTargetY;
      const sp = pt.matrixTransform(ctm);
      screenX = sp.x; screenY = sp.y;
    } else {
      const rect = svgEl.getBoundingClientRect();
      screenX = rect.left + ((svgTargetX - vbX) / vbWidth) * rect.width;
      screenY = rect.top + ((svgTargetY - vbY) / vbHeight) * rect.height;
    }

    const crosshair = document.createElement('div');
    crosshair.className = 'uwukahootai-pin-crosshair';
    crosshair.style.cssText = `position:fixed; left:${screenX}px; top:${screenY}px; transform:translate(-50%,-50%); z-index:9999; pointer-events:none; width:0; height:0;`;

    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:40px; height:40px; border:3px solid #ff3333; border-radius:50%; animation:uwukahootai-pulse 1.2s ease-in-out infinite;';
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:12px; height:12px; background:#ff3333; border-radius:50%; box-shadow:0 0 6px rgba(255,51,51,0.6);';
    const hLine = document.createElement('div');
    hLine.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:60px; height:2px; background:rgba(255,51,51,0.7);';
    const vLine = document.createElement('div');
    vLine.style.cssText = 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:2px; height:60px; background:rgba(255,51,51,0.7);';
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'position:absolute; left:calc(50% + 16px); top:calc(50% + 16px); background:rgba(0,0,0,0.85); color:#fff; padding:3px 8px; border-radius:4px; font:600 11px/1.3 monospace; white-space:nowrap;';
    labelEl.textContent = `📍 ${coords.x.toFixed(0)}%, ${coords.y.toFixed(0)}%`;

    crosshair.append(ring, dot, hLine, vLine, labelEl);
    (document.body || document.documentElement).appendChild(crosshair);

    let positionFrame = 0;
    function updatePosition() {
      positionFrame = 0;
      if (!crosshair.isConnected) return;
      const newCtm = svgEl.getScreenCTM();
      if (newCtm) {
        const pt2 = svgEl.createSVGPoint();
        pt2.x = svgTargetX; pt2.y = svgTargetY;
        const sp2 = pt2.matrixTransform(newCtm);
        crosshair.style.left = sp2.x + 'px';
        crosshair.style.top = sp2.y + 'px';
      }
    }
    const schedulePosition = () => {
      if (!positionFrame && crosshair.isConnected) positionFrame = requestAnimationFrame(updatePosition);
    };
    const cleanupCrosshair = () => {
      crosshair.remove();
      if (positionFrame) cancelAnimationFrame(positionFrame);
      positionFrame = 0;
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('scroll', schedulePosition, true);
      window.removeEventListener('resize', schedulePosition);
      window.visualViewport?.removeEventListener('scroll', schedulePosition);
      window.visualViewport?.removeEventListener('resize', schedulePosition);
    };

    window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
    window.addEventListener('resize', schedulePosition, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedulePosition, { passive: true });
    window.visualViewport?.addEventListener('resize', schedulePosition, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePosition) : null;
    resizeObserver?.observe(svgEl);
    schedulePosition();

    const observer = new MutationObserver(records => {
      if (!crosshair.isConnected || !svgEl.isConnected) {
        cleanupCrosshair();
        return;
      }
      if (!mutationTouchesTree(records, svgEl, true)) return;
      if (document.querySelector(PIN_SVG_SELECTOR) !== svgEl) {
        cleanupCrosshair();
        return;
      }
      schedulePosition();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(cleanupCrosshair, 60000);
  }

  function highlightSliderMarker(targetValue) {

    const markers = document.querySelectorAll('.spectrum__MarkerContainer-sc-1q4py3v-1, [data-functional-selector*="marker-container"]');
    let bestMarker = null, bestDiff = Infinity;

    for (const m of markers) {
      const label = m.querySelector('[class*="NumberIndicator"]');
      if (!label) continue;
      const numText = label.textContent.replace(/\s/g, '').replace(/\u00a0/g, '');
      const num = parseFloat(numText);
      if (isNaN(num)) continue;
      const diff = Math.abs(num - targetValue);
      if (diff < bestDiff) { bestDiff = diff; bestMarker = m; }
    }

    if (bestMarker) {
      const dot = bestMarker.querySelector('[class*="Marker-sc"], [data-functional-selector*="marker"]');
      if (dot) {
        if (!highlightedSliderMarkers.has(dot)) {
          highlightedSliderMarkers.set(dot, {
            border: dot.style.border,
            boxShadow: dot.style.boxShadow,
            borderRadius: dot.style.borderRadius,
            transition: dot.style.transition
          });
        }
        dot.style.border = '3px solid #00ff00';
        dot.style.boxShadow = '0 0 12px #00ff00';
        dot.style.borderRadius = '50%';
        dot.style.transition = 'all 0.3s ease';
      }
    }
  }

  function showJumbleBadges(textEls, order) {
    document.querySelectorAll('.uwukahootai-jumble-badge').forEach(el => el.remove());

    for (let pos = 0; pos < order.length; pos++) {
      const textEl = textEls[order[pos]];
      if (!textEl) continue;

      const container = textEl.closest('[draggable="true"]')
        || textEl.closest('[data-functional-selector*="card"]')
        || textEl.closest('[data-functional-selector*="choice"]')
        || textEl.parentElement?.parentElement
        || textEl.parentElement;
      if (!container) continue;

      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      const badge = document.createElement('div');
      badge.className = 'uwukahootai-jumble-badge';
      badge.textContent = String(pos + 1);
      badge.style.cssText = `
        position:absolute; top:-8px; right:-8px;
        width:24px; height:24px; background:#ff3333; color:#fff; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        font:bold 14px sans-serif; z-index:10000;
        box-shadow:0 2px 8px rgba(0,0,0,0.5); pointer-events:none;
        animation:uwukahootai-fadein .3s ease ${pos * 0.1}s both;
      `;
      container.appendChild(badge);
    }

    const tileRoot = sharedAncestor(textEls);
    const cleanup = () => { document.querySelectorAll('.uwukahootai-jumble-badge').forEach(el => el.remove()); observer.disconnect(); };
    setTimeout(cleanup, 15000);
    const observer = new MutationObserver(records => {
      if (!tileRoot?.isConnected || mutationTouchesTree(records, tileRoot)) {
        if (!tileRoot?.isConnected || !document.querySelector('[data-functional-selector="question-choice-text-0"]')) cleanup();
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

    return { cleanupOverlays, showPinCrosshair, highlightSliderMarker, showJumbleBadges };
  }

  global.UwUKahootAIAnswerFeedbackUi = { create: createAnswerFeedbackUi };
})(globalThis);
