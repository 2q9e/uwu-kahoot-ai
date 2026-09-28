const SOLVE_STATS_KEY = 'uwuKahootSolveStats';
const popupSolvedCount = document.getElementById('popupSolvedCount');
const popupAverageTime = document.getElementById('popupAverageTime');
const popupStatsTeaser = document.querySelector('.stats-teaser');

function formatResponseTime(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function renderPopupStats(stats) {
  const noStoredHistory = stats === undefined || stats === null;
  const validRecord = stats && typeof stats === 'object' && !Array.isArray(stats);
  const total = noStoredHistory ? 0 : validRecord ? Number(stats.totalSolved) : Number.NaN;
  const totalMs = noStoredHistory ? 0 : validRecord ? Number(stats.totalResponseMs) : Number.NaN;
  if (!Number.isFinite(total) || total < 0) {
    setPopupStatsUnavailable();
    return;
  }
  const count = Math.floor(total);
  animatePopupValue(popupSolvedCount, `${count.toLocaleString()} AI answers`);
  const validTotalTime = Number.isFinite(totalMs) && totalMs >= 0;
  const coherentTime = validTotalTime && (count > 0 || totalMs === 0);
  animatePopupValue(popupAverageTime, count === 0 && coherentTime ? 'Average AI response: No answers yet' : count > 0 && coherentTime ? `Average AI response: ${formatResponseTime(totalMs / count)}` : 'Average AI response: Unavailable');
  popupStatsTeaser?.setAttribute('aria-busy', 'false');
}

function animatePopupValue(element, value) {
  if (!element || element.textContent === value) return;
  element.textContent = value;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof element.animate !== 'function') return;
  const animation = element.animate([
    { opacity: 0.45, transform: 'translateY(4px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration: 230, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  animation.onfinish = () => animation.cancel();
}

function setPopupStatsUnavailable() {
  animatePopupValue(popupSolvedCount, 'Stats unavailable');
  animatePopupValue(popupAverageTime, 'Average AI response: Unavailable');
  popupStatsTeaser?.setAttribute('aria-busy', 'false');
}

async function loadPopupStats() {
  try {
    const stored = await chrome.storage.local.get(SOLVE_STATS_KEY);
    renderPopupStats(stored[SOLVE_STATS_KEY]);
  } catch (_) {
    setPopupStatsUnavailable();
  }
}

export function initializePopupStats() {
  void loadPopupStats();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[SOLVE_STATS_KEY]) renderPopupStats(changes[SOLVE_STATS_KEY].newValue);
  });
}
