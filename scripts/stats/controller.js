const STORAGE_KEY = 'uwuKahootSolveStats';
const totalSolved = document.getElementById('totalSolved');
const averageResponse = document.getElementById('averageResponse');
const totalResponseTime = document.getElementById('totalResponseTime');
const recentCount = document.getElementById('recentCount');
const recentList = document.getElementById('recentList');
const recentUpdateStatus = document.getElementById('recentUpdateStatus');
const emptyState = document.getElementById('emptyState');
const metricGrid = document.querySelector('.metric-grid');
const recentCard = document.querySelector('.recent-card');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const scrollLinkedAnimations = typeof CSS !== 'undefined' &&
  CSS.supports?.('animation-timeline: scroll(root block)');
let scrollProgressFrame = 0;
let statsRevision = 0;

const TYPE_LABELS = {
  quiz: 'Multiple choice', true_false: 'True / false', multiple_select_quiz: 'Multi-select',
  pin_it: 'Pin question', jumble: 'Jumble', slider: 'Slider', open_ended: 'Open response'
};

function formatResponseTime(milliseconds) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  return `${minutes}m ${roundedSeconds % 60}s`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function setMetricValue(element, value) {
  if (!element || element.textContent === value) return;
  element.textContent = value;
  if (motionPreference.matches || typeof element.animate !== 'function') return;
  const animation = element.animate([
    { opacity: 0.45, transform: 'translateY(5px) scale(.985)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' }
  ], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  animation.onfinish = () => animation.cancel();
}

function makeRecentItem(item) {
  const article = document.createElement('article');
  article.className = 'recent-item';

  const question = document.createElement('div');
  question.className = 'recent-question';
  const title = String(item.title || '').trim();
  question.textContent = title && title !== 'Untitled question' ? title : 'Question title unavailable';

  const answer = document.createElement('div');
  answer.className = 'recent-answer';
  const answerText = String(item.answer || '').trim();
  answer.textContent = `Answer: ${answerText && answerText !== 'Answer received' ? answerText : 'Answer unavailable'}`;

  const meta = document.createElement('div');
  meta.className = 'recent-meta';
  const type = document.createElement('span');
  type.textContent = TYPE_LABELS[item.type] || 'Unknown question type';
  const elapsed = document.createElement('span');
  const elapsedMs = nonnegativeNumber(item.responseMs);
  elapsed.textContent = elapsedMs === null ? 'Time unavailable' : formatResponseTime(elapsedMs);
  const date = document.createElement('span');
  date.textContent = formatTimestamp(item.solvedAt);
  meta.append(type, elapsed, date);

  article.append(question, answer, meta);
  return article;
}

function nonnegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function renderUnavailable(announceUpdate = false) {
  setMetricValue(totalSolved, 'Unavailable');
  setMetricValue(averageResponse, 'Unavailable');
  setMetricValue(totalResponseTime, 'Unavailable');
  recentCount.textContent = 'Unavailable';
  recentList.replaceChildren();
  recentList.classList.add('hidden');
  emptyState.textContent = 'Stats could not be read from extension storage.';
  emptyState.classList.remove('hidden');
  recentUpdateStatus.textContent = announceUpdate ? 'Recent answer history is unavailable.' : '';
  metricGrid?.setAttribute('aria-busy', 'false');
  recentCard?.setAttribute('aria-busy', 'false');
}

function renderStats(stats, announceUpdate = false) {
  const noStoredHistory = stats === undefined || stats === null;
  const record = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : null;
  const countValue = noStoredHistory ? 0 : nonnegativeNumber(record?.totalSolved);
  const totalValue = noStoredHistory ? 0 : nonnegativeNumber(record?.totalResponseMs);
  if (countValue === null) {
    renderUnavailable(announceUpdate);
    return;
  }
  const count = Math.floor(countValue);
  const totalMs = totalValue === null ? null : Math.round(totalValue);
  const coherentTimes = totalMs !== null && (count > 0 || totalMs === 0);
  const recent = Array.isArray(record?.recent) ? record.recent.filter(item => item && typeof item === 'object').slice(0, 30) : [];

  setMetricValue(totalSolved, count.toLocaleString());
  setMetricValue(averageResponse, count === 0 ? 'No answers yet' : coherentTimes ? formatResponseTime(totalMs / count) : 'Unavailable');
  setMetricValue(totalResponseTime, coherentTimes ? formatResponseTime(totalMs) : 'Unavailable');
  recentCount.textContent = `${recent.length} recent`;
  recentList.replaceChildren(...recent.map(makeRecentItem));
  recentList.classList.toggle('hidden', recent.length === 0);
  emptyState.classList.toggle('hidden', recent.length !== 0);
  emptyState.textContent = count === 0 ? 'No AI answers have been recorded in this browser yet.' : 'No recent entries are stored for these generated answers.';
  recentUpdateStatus.textContent = announceUpdate
    ? `Recent answer history updated. ${recent.length} ${recent.length === 1 ? 'entry' : 'entries'}.`
    : '';
  metricGrid?.setAttribute('aria-busy', 'false');
  recentCard?.setAttribute('aria-busy', 'false');
}

async function loadStats() {
  const revision = statsRevision;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (revision !== statsRevision) return;
    renderStats(stored[STORAGE_KEY]);
  } catch (_) {
    if (revision !== statsRevision) return;
    renderUnavailable();
  }
}

function updateScrollProgress() {
  scrollProgressFrame = 0;
  if (scrollLinkedAnimations) return;
  const range = document.documentElement.scrollHeight - window.innerHeight;
  const progress = range > 0 ? Math.max(0, Math.min(1, window.scrollY / range)) : 0;
  document.documentElement.style.setProperty('--stats-scroll', progress.toFixed(4));
}

function scheduleScrollProgress() {
  if (!scrollProgressFrame) scrollProgressFrame = requestAnimationFrame(updateScrollProgress);
}

window.addEventListener('scroll', scheduleScrollProgress, { passive: true });
window.addEventListener('resize', scheduleScrollProgress, { passive: true });
scheduleScrollProgress();

if (!motionPreference.matches) {
  for (const card of document.querySelectorAll('.metric-card, .recent-card')) {
    card.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || motionPreference.matches) return;
      const bounds = card.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      card.style.setProperty('--card-tilt-x', `${((x - .5) * 4.2).toFixed(2)}deg`);
      card.style.setProperty('--card-tilt-y', `${((.5 - y) * 3.5).toFixed(2)}deg`);
    }, { passive: true });
    card.addEventListener('pointerleave', () => {
      card.style.removeProperty('--card-tilt-x');
      card.style.removeProperty('--card-tilt-y');
    }, { passive: true });
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
  statsRevision += 1;
  renderStats(changes[STORAGE_KEY].newValue, true);
});

loadStats();
