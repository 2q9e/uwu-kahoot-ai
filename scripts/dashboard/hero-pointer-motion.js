const heroStage = document.querySelector('.hero-stage');
const frontCard = document.querySelector('.card-front');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let heroBounds = null;
let heroBoundsScrollY = window.scrollY;
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

function setPointerGlow(x, y, cardX, cardY) {
  heroStage?.style.setProperty('--pointer-spot-x', `${x.toFixed(1)}%`);
  heroStage?.style.setProperty('--pointer-spot-y', `${y.toFixed(1)}%`);
  frontCard?.style.setProperty('--card-glow-x', `${((cardX - 50) * 1.28).toFixed(1)}%`);
  frontCard?.style.setProperty('--card-glow-y', `${((cardY - 50) * 1.02).toFixed(1)}%`);
}

export function refreshHeroPointerBounds() {
  heroBounds = heroStage?.getBoundingClientRect() || null;
  heroBoundsScrollY = window.scrollY;
}

export function resetHeroPointerTilt() {
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
  if (heroBoundsScrollY !== window.scrollY) refreshHeroPointerBounds();
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
