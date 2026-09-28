import { setMotionMode, scheduleScrollScene } from './hero-motion.js';

const modeButtons = [...document.querySelectorAll('[data-mode]')];
const dashboardFrame = document.getElementById('dashboardApp');
const modeSaveStatus = document.getElementById('modeSaveStatus');
let userSelectedMode = false;
let modePreferenceRevision = 0;
let modePreferenceWriteQueue = Promise.resolve();

function applyMode(mode) {
  const nextMode = mode === 'classic' ? 'classic' : '3d';
  setMotionMode(nextMode);
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === nextMode));
  }
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
