const finiteNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function supportsNativeScrollTimeline(css) {
  if (typeof css?.supports !== 'function') return false;
  return css.supports('animation-timeline: scroll(root block)') &&
    css.supports('animation-range: 0px 1px');
}


export function computeSceneScrollRange({ sectionTop, stickyTop, sectionHeight, stickyHeight }) {
  const start = finiteNumber(sectionTop) - finiteNumber(stickyTop);
  const travel = Math.max(1, finiteNumber(sectionHeight) - finiteNumber(stickyHeight));
  return { start, travel, end: start + travel };
}


export function computeSceneProgress(scrollY, start, travel) {
  const position = finiteNumber(scrollY);
  const rangeStart = finiteNumber(start);
  const rangeTravel = Math.max(1, finiteNumber(travel));
  return Math.max(0, Math.min(1, (position - rangeStart) / rangeTravel));
}
