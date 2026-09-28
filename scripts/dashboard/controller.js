import { computeSceneProgress, computeSceneScrollRange, supportsNativeScrollTimeline } from './scroll-scene.js';

const modeButtons = [...document.querySelectorAll('[data-mode]')];
const dashboardFrame = document.getElementById('dashboardApp');
const modeSaveStatus = document.getElementById('modeSaveStatus');
const dashboardTopbar = document.querySelector('.dashboard-topbar');
const heroStage = document.querySelector('.hero-stage');
const stageOrb = document.querySelector('.stage-orb');
const stageOrbit = document.querySelector('.stage-orbit');
const particleField = document.querySelector('.stage-particles');
const dashboardHero = document.querySelector('.dashboard-hero');
const stickyHero = document.querySelector('.hero-sticky');
const heroCopy = document.querySelector('.hero-copy');
const frontCard = document.querySelector('.card-front');
const backCard = document.querySelector('.card-back');
const stageGrid = document.querySelector('.stage-grid');
const scrollProgress = document.querySelector('.scroll-progress span');
let userSelectedMode = false;
let modePreferenceRevision = 0;
let modePreferenceWriteQueue = Promise.resolve();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const hasScrollTimeline = supportsNativeScrollTimeline(globalThis.CSS);
let heroBounds = null;
let heroBoundsScrollY = window.scrollY;
let heroNearViewport = false;
let pointerTargetX = 0;
let pointerTargetY = 0;
let pointerCurrentX = 0;
let pointerCurrentY = 0;
let pointerTargetSpotX = 50;
let pointerTargetSpotY = 42;
let pointerCurrentSpotX = 50;
let pointerCurrentSpotY = 42;
let pointerTargetCardX = 50;
let pointerTargetCardY = 50;
let pointerCurrentCardX = 50;
let pointerCurrentCardY = 50;
let lastPointerFrameTime = 0;
let pointerFrame = 0;
let scrollFrame = 0;
let lastRenderedProgress = Number.NaN;
let sceneScrollStart = 0;
let sceneScrollTravel = 1;

document.body.classList.toggle('js-scroll-fallback', !hasScrollTimeline);

function refreshHeroBounds() {
  heroBounds = heroStage?.getBoundingClientRect() || null;
  heroBoundsScrollY = window.scrollY;
}

function refreshSceneGeometry() {
  if (!dashboardHero || !stickyHero) return;
  const headerHeight = dashboardTopbar?.getBoundingClientRect().height;
  if (Number.isFinite(headerHeight) && headerHeight > 0) {
    document.documentElement.style.setProperty('--dashboard-header-height', `${headerHeight}px`);
  }
  const heroTop = dashboardHero.getBoundingClientRect().top + window.scrollY;
  const stickyTop = Number.parseFloat(getComputedStyle(stickyHero).top) || 0;
  const range = computeSceneScrollRange({
    sectionTop: heroTop,
    stickyTop,
    sectionHeight: dashboardHero.offsetHeight,
    stickyHeight: stickyHero.offsetHeight
  });
  sceneScrollStart = range.start;
  sceneScrollTravel = range.travel;
  document.documentElement.style.setProperty('--hero-scroll-start', `${range.start}px`);
  document.documentElement.style.setProperty('--hero-scroll-end', `${range.end}px`);
}

function updateMotionState() {
  const active = document.body.dataset.mode === '3d' && heroNearViewport &&
    !reduceMotion.matches && document.visibilityState === 'visible';
  document.body.classList.toggle('motion-active', active);
}

function paintScrollScene() {
  scrollFrame = 0;
  if (hasScrollTimeline) return;

  const active = document.body.dataset.mode === '3d' && !reduceMotion.matches && dashboardHero && stickyHero;
  let progress = 0;
  if (active) {
    progress = computeSceneProgress(window.scrollY, sceneScrollStart, sceneScrollTravel);
  }

  const p = Number(progress.toFixed(4));
  if (p === lastRenderedProgress) return;
  lastRenderedProgress = p;
  document.body.style.setProperty('--hero-progress', p.toFixed(4));
  heroCopy?.style.setProperty('--scroll-copy-y', `${(-46 * p).toFixed(1)}px`);
  heroCopy?.style.setProperty('--scroll-copy-opacity', (1 - .78 * p).toFixed(3));
  heroStage?.style.setProperty('--scroll-stage-y', `${(-15 * p).toFixed(1)}px`);
  heroStage?.style.setProperty('--scroll-stage-z', `${(-28 * p).toFixed(1)}px`);
  stageOrb?.style.setProperty('--scroll-orb-y', `${(-18 * p).toFixed(1)}px`);
  stageOrbit?.style.setProperty('--scroll-orbit-y', `${(-10 * p).toFixed(1)}px`);
  stageOrbit?.style.setProperty('--scroll-orbit-z', `${(-32 * p).toFixed(1)}px`);
  stageOrbit?.style.setProperty('--scroll-orbit-opacity', (.55 - .23 * p).toFixed(3));
  particleField?.style.setProperty('--scroll-particles-y', `${(-22 * p).toFixed(1)}px`);
  particleField?.style.setProperty('--scroll-particles-z', `${(-55 * p).toFixed(1)}px`);
  particleField?.style.setProperty('--scroll-particles-opacity', (1 - .58 * p).toFixed(3));
  frontCard?.style.setProperty('--scroll-front-x', `${(10 * p).toFixed(1)}px`);
  frontCard?.style.setProperty('--scroll-front-y', `${(-30 * p).toFixed(1)}px`);
  frontCard?.style.setProperty('--scroll-front-z', `${(100 * p).toFixed(1)}px`);
  frontCard?.style.setProperty('--scroll-front-scale', (.96 + .11 * p).toFixed(3));
  backCard?.style.setProperty('--scroll-back-x', `${(-18 * p).toFixed(1)}px`);
  backCard?.style.setProperty('--scroll-back-y', `${(76 * p).toFixed(1)}px`);
  backCard?.style.setProperty('--scroll-back-z', `${(-115 * p).toFixed(1)}px`);
  backCard?.style.setProperty('--scroll-back-scale', (1 - .1 * p).toFixed(3));
  backCard?.style.setProperty('--scroll-back-opacity', (.36 - .26 * p).toFixed(3));
  stageGrid?.style.setProperty('--scroll-grid-y', `${(82 * p).toFixed(1)}px`);
  stageGrid?.style.setProperty('--scroll-grid-opacity', (.25 - .225 * p).toFixed(3));
  scrollProgress?.style.setProperty('transform', `scaleX(${p.toFixed(4)})`);
}

function scheduleScrollScene() {
  if (!hasScrollTimeline && !scrollFrame) scrollFrame = requestAnimationFrame(paintScrollScene);
}

refreshHeroBounds();
refreshSceneGeometry();
if (typeof ResizeObserver !== 'undefined') {
  const sceneObserver = new ResizeObserver(() => {
    refreshSceneGeometry();
    refreshHeroBounds();
    scheduleScrollScene();
  });
  for (const element of [dashboardTopbar, dashboardHero, stickyHero, heroStage]) {
    if (element) sceneObserver.observe(element);
  }
}
if (!hasScrollTimeline) window.addEventListener('scroll', scheduleScrollScene, { passive: true });
window.addEventListener('resize', () => {
  refreshSceneGeometry();
  refreshHeroBounds();
  scheduleScrollScene();
}, { passive: true });
document.addEventListener('visibilitychange', updateMotionState);

if (heroStage && typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    heroNearViewport = entry.isIntersecting;
    updateMotionState();
  }, { threshold: 0.01, rootMargin: '100px 0px' }).observe(heroStage);
} else {
  heroNearViewport = true;
  updateMotionState();
}

if (!hasScrollTimeline && typeof IntersectionObserver !== 'undefined') {
  const workspaceTargets = document.querySelectorAll('.dashboard-content .content-heading, .dashboard-content .app-window');
  if (workspaceTargets.length) {
    document.body.classList.add('workspace-reveal-ready');
    const workspaceObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-entered');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -7% 0px' });
    workspaceTargets.forEach(element => workspaceObserver.observe(element));
  }
}

function setPointerGlow(x, y, cardX, cardY) {
  heroStage?.style.setProperty('--pointer-spot-x', `${x.toFixed(1)}%`);
  heroStage?.style.setProperty('--pointer-spot-y', `${y.toFixed(1)}%`);
  frontCard?.style.setProperty('--card-glow-x', `${((cardX - 50) * 1.28).toFixed(1)}%`);
  frontCard?.style.setProperty('--card-glow-y', `${((cardY - 50) * 1.02).toFixed(1)}%`);
}

function animateHeroTilt(timestamp) {
  pointerFrame = 0;
  const elapsed = lastPointerFrameTime ? Math.min(64, Math.max(1, timestamp - lastPointerFrameTime)) : 16.7;
  lastPointerFrameTime = timestamp;
  const blend = 1 - Math.exp(-elapsed / 78);
  pointerCurrentX += (pointerTargetX - pointerCurrentX) * blend;
  pointerCurrentY += (pointerTargetY - pointerCurrentY) * blend;
  pointerCurrentSpotX += (pointerTargetSpotX - pointerCurrentSpotX) * blend;
  pointerCurrentSpotY += (pointerTargetSpotY - pointerCurrentSpotY) * blend;
  pointerCurrentCardX += (pointerTargetCardX - pointerCurrentCardX) * blend;
  pointerCurrentCardY += (pointerTargetCardY - pointerCurrentCardY) * blend;
  heroStage?.style.setProperty('--pointer-x', `${pointerCurrentX.toFixed(2)}deg`);
  heroStage?.style.setProperty('--pointer-y', `${pointerCurrentY.toFixed(2)}deg`);
  setPointerGlow(pointerCurrentSpotX, pointerCurrentSpotY, pointerCurrentCardX, pointerCurrentCardY);
  if (Math.abs(pointerTargetX - pointerCurrentX) > 0.05 || Math.abs(pointerTargetY - pointerCurrentY) > 0.05 ||
      Math.abs(pointerTargetSpotX - pointerCurrentSpotX) > 0.1 || Math.abs(pointerTargetSpotY - pointerCurrentSpotY) > 0.1 ||
      Math.abs(pointerTargetCardX - pointerCurrentCardX) > 0.1 || Math.abs(pointerTargetCardY - pointerCurrentCardY) > 0.1) {
    pointerFrame = requestAnimationFrame(animateHeroTilt);
  } else {
    lastPointerFrameTime = 0;
  }
}

function scheduleHeroTilt() {
  if (!pointerFrame && !reduceMotion.matches) pointerFrame = requestAnimationFrame(animateHeroTilt);
}

heroStage?.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || reduceMotion.matches || document.body.dataset.mode !== '3d') return;
  if (heroBoundsScrollY !== window.scrollY) refreshHeroBounds();
  if (!heroBounds) return;
  const bounds = heroBounds;
  if (!bounds.width || !bounds.height) return;
  const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
  const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
  pointerTargetX = -y * 4.6;
  pointerTargetY = x * 6;
  pointerTargetSpotX = (x + 1) * 50;
  pointerTargetSpotY = (y + 1) * 50;
  const cardBounds = event.target.closest?.('.card-front') ? frontCard?.getBoundingClientRect() : null;
  pointerTargetCardX = cardBounds?.width ? Math.max(0, Math.min(100, (event.clientX - cardBounds.left) / cardBounds.width * 100)) : 50;
  pointerTargetCardY = cardBounds?.height ? Math.max(0, Math.min(100, (event.clientY - cardBounds.top) / cardBounds.height * 100)) : 50;
  scheduleHeroTilt();
}, { passive: true });
heroStage?.addEventListener('pointerleave', () => {
  pointerTargetX = 0;
  pointerTargetY = 0;
  pointerTargetSpotX = 50;
  pointerTargetSpotY = 42;
  pointerTargetCardX = pointerTargetCardY = 50;
  scheduleHeroTilt();
}, { passive: true });
reduceMotion.addEventListener?.('change', () => {
  if (reduceMotion.matches) {
    pointerTargetX = pointerTargetY = 0;
    pointerCurrentX = pointerCurrentY = 0;
    pointerTargetSpotX = pointerCurrentSpotX = 50;
    pointerTargetSpotY = pointerCurrentSpotY = 42;
    pointerTargetCardX = pointerCurrentCardX = 50;
    pointerTargetCardY = pointerCurrentCardY = 50;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    lastPointerFrameTime = 0;
    heroStage?.style.setProperty('--pointer-x', '0deg');
    heroStage?.style.setProperty('--pointer-y', '0deg');
    setPointerGlow(pointerCurrentSpotX, pointerCurrentSpotY, pointerCurrentCardX, pointerCurrentCardY);
  }
  updateMotionState();
  scheduleScrollScene();
});

function applyMode(mode) {
  const nextMode = mode === 'classic' ? 'classic' : '3d';
  document.body.dataset.mode = nextMode;
  refreshHeroBounds();
  refreshSceneGeometry();
  if (nextMode === 'classic') {
    pointerTargetX = pointerTargetY = 0;
    pointerCurrentX = pointerCurrentY = 0;
    pointerTargetSpotX = pointerCurrentSpotX = 50;
    pointerTargetSpotY = pointerCurrentSpotY = 42;
    pointerTargetCardX = pointerCurrentCardX = 50;
    pointerTargetCardY = pointerCurrentCardY = 50;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    lastPointerFrameTime = 0;
    heroStage?.style.setProperty('--pointer-x', '0deg');
    heroStage?.style.setProperty('--pointer-y', '0deg');
    setPointerGlow(pointerCurrentSpotX, pointerCurrentSpotY, pointerCurrentCardX, pointerCurrentCardY);
  }
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === nextMode));
  }
  updateMotionState();
  scheduleScrollScene();
  dashboardFrame?.contentWindow?.postMessage({ source: 'uwukahootai-dashboard-mode', mode: nextMode }, location.origin);
}

async function loadMode() {
  try {
    const { dashboardMode } = await chrome.storage.local.get('dashboardMode');
    if (!userSelectedMode) applyMode(dashboardMode || '3d');
  } catch (_) {
    if (!userSelectedMode) applyMode('3d');
  }
}

function persistMode(mode, revision) {
  const write = modePreferenceWriteQueue.catch(() => {}).then(async () => {
    if (revision !== modePreferenceRevision) return;
    await chrome.storage.local.set({ dashboardMode: mode });
  });
  modePreferenceWriteQueue = write;
  return write;
}

for (const button of modeButtons) {
  button.addEventListener('click', async () => {
    userSelectedMode = true;
    const revision = ++modePreferenceRevision;
    const mode = button.dataset.mode;
    applyMode(mode);
    if (modeSaveStatus) modeSaveStatus.textContent = '';
    try {
      await persistMode(mode, revision);
      if (revision === modePreferenceRevision && modeSaveStatus) modeSaveStatus.textContent = '';
    } catch (_) {
      if (revision === modePreferenceRevision && modeSaveStatus) {
        modeSaveStatus.textContent = 'View changed for this session; could not save your preference.';
      }
    }
  });
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== dashboardFrame?.contentWindow) return;
  if (event.data?.source !== 'uwukahootai-dashboard-frame') return;
  const height = Number(event.data.height);
  if (Number.isFinite(height)) dashboardFrame.style.height = `${Math.max(620, Math.min(height, 5000))}px`;
});
dashboardFrame?.addEventListener('load', () => {
  applyMode(document.body.dataset.mode || '3d');
});

loadMode();
scheduleScrollScene();
