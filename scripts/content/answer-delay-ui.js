(function () {
  'use strict';

  function createAnswerDelayUi() {
    let timerOverlayCancel = null;

    function removeTimerOverlay() {
      timerOverlayCancel?.();
      timerOverlayCancel = null;
      document.getElementById('uwukahootai-timer')?.remove();
    }

    function showTimerOverlay(duration, callback) {
      removeTimerOverlay();
      if (!document.getElementById('uwukahootai-timer-css')) {
        const css = document.createElement('style');
        css.id = 'uwukahootai-timer-css';
        css.textContent = `
          @keyframes uwukahootai-slide-in  { from { transform:translateX(120%); opacity:0 } to { transform:translateX(0); opacity:1 } }
          @keyframes uwukahootai-slide-out { from { transform:translateX(0); opacity:1 } to { transform:translateX(120%); opacity:0 } }
        `;
        document.head?.appendChild(css);
      }

      const overlay = document.createElement('div');
      overlay.id = 'uwukahootai-timer';
      overlay.style.cssText = `
        position:fixed; top:20px; right:20px;
        background:linear-gradient(135deg,rgba(5,150,105,.92),rgba(232,121,249,.92));
        color:#fff; padding:14px 18px; border-radius:12px;
        z-index:10001; font:600 14px/1.3 system-ui,sans-serif;
        box-shadow:0 6px 20px rgba(0,0,0,.35); min-width:180px;
        animation:uwukahootai-slide-in .25s ease-out;
        backdrop-filter:blur(8px);
      `;

      const label = document.createElement('div');
      label.textContent = `Answering in ${duration}s…`;
      label.style.cssText = 'margin-bottom:8px; font-size:13px;';

      const track = document.createElement('div');
      track.style.cssText = 'width:100%; height:6px; border-radius:3px; background:rgba(255,255,255,.2); overflow:hidden;';
      const fill = document.createElement('div');
      fill.style.cssText = `width:100%; height:100%; border-radius:3px; background:#fff; transition:width ${duration}s linear;`;
      track.appendChild(fill);

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Skip wait';
      cancelBtn.style.cssText = 'margin-top:8px; background:rgba(255,255,255,.2); border:none; color:#fff; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:600;';

      overlay.append(label, track, cancelBtn);
      (document.body || document.documentElement).appendChild(overlay);
      requestAnimationFrame(() => { fill.style.width = '0%'; });

      let fired = false;
      let timer = null;
      const cancel = () => {
        if (fired) return;
        fired = true;
        clearTimeout(timer);
        overlay.remove();
      };
      const fire = () => {
        if (fired) return;
        fired = true;
        clearTimeout(timer);
        if (timerOverlayCancel === cancel) timerOverlayCancel = null;
        slideOutAndRemove(overlay, callback);
      };

      timerOverlayCancel = cancel;
      timer = setTimeout(fire, duration * 1000);
      cancelBtn.addEventListener('click', () => { clearTimeout(timer); fire(); });
      fill.addEventListener('transitionend', () => { if (!fired) { clearTimeout(timer); fire(); } }, { once: true });
    }

    function slideOutAndRemove(el, afterRemove) {
      el.style.animation = 'uwukahootai-slide-out .25s ease-in forwards';
      setTimeout(() => { el.remove(); afterRemove?.(); }, 260);
    }

    return { removeTimerOverlay, showTimerOverlay };
  }

  globalThis.UwUKahootAIDelayUi = { create: createAnswerDelayUi };
})();
