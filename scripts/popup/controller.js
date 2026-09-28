
import { initializeLiveSession, setLiveStatus } from './live-session.js';
import { initializePopupStats } from './stats-summary.js';
import { createPopupSettingsController } from './settings-controller.js';

const versionLabel    = document.getElementById('versionLabel');
const openStatsBtn = document.getElementById('openStats');
const openStatsCardBtn = document.getElementById('openStatsCard');
const openApiDashboardBtn = document.getElementById('openApiDashboard');
const apiPageIntro = document.getElementById('apiPageIntro');
const apiPageNav = document.getElementById('apiPageNav');
const isApiPage = new URLSearchParams(location.search).get('api') === '1';
const settingsController = createPopupSettingsController();
const isDashboardFrame = new URLSearchParams(location.search).get('dashboard') === '1';

apiPageNav?.addEventListener('click', event => {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
  if (!link) return;
  const target = document.getElementById(link.hash.slice(1));
  if (target instanceof HTMLDetailsElement) target.open = true;
});

if (isApiPage) {
  document.documentElement.classList.add('api-page-html');
  document.body.classList.add('api-page');
  document.title = 'UwU Kahoot AI · Provider settings';
  apiPageIntro?.classList.remove('hidden');
  apiPageNav?.classList.remove('hidden');
  if (versionLabel) versionLabel.textContent = 'Provider settings';

  if (apiPageNav) {
    let anchorOffsetFrame = 0;
    const updateApiAnchorOffset = () => {
      anchorOffsetFrame = 0;
      const navHeight = apiPageNav.offsetHeight;
      const stickyTop = Number.parseFloat(getComputedStyle(apiPageNav).top) || 0;
      const scrollGap = 12;
      const offset = Math.ceil(navHeight + stickyTop + scrollGap);
      document.documentElement.style.setProperty('--api-anchor-offset', `${offset}px`);
    };
    const scheduleApiAnchorOffsetUpdate = () => {
      if (anchorOffsetFrame) return;
      anchorOffsetFrame = requestAnimationFrame(updateApiAnchorOffset);
    };

    updateApiAnchorOffset();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(scheduleApiAnchorOffsetUpdate).observe(apiPageNav);
    }
    window.addEventListener('resize', scheduleApiAnchorOffsetUpdate, { passive: true });
  }
}

if (isDashboardFrame) {
  document.documentElement.classList.add('dashboard-html');
  document.body.classList.add('dashboard-embedded');
  const reportDashboardHeight = () => {
    const height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    window.parent.postMessage({ source: 'uwukahootai-dashboard-frame', height }, location.origin);
  };
  const resizeObserver = new ResizeObserver(() => requestAnimationFrame(reportDashboardHeight));
  resizeObserver.observe(document.documentElement);
  window.addEventListener('load', reportDashboardHeight, { once: true });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.source !== 'uwukahootai-dashboard-mode') return;
    document.body.dataset.dashboardMode = event.data.mode === 'classic' ? 'classic' : '3d';
    requestAnimationFrame(reportDashboardHeight);
  });
}


async function openStatsPage(button) {
  if (button) button.disabled = true;
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('pages/stats.html') });
    if (button === openStatsBtn) window.close();
  } catch (_) {
    if (button) button.disabled = false;
    setLiveStatus('error', 'Could not open stats', 'Try opening the extension popup again.');
  }
}
openStatsBtn?.addEventListener('click', () => openStatsPage(openStatsBtn));
openStatsCardBtn?.addEventListener('click', () => openStatsPage(openStatsCardBtn));

openApiDashboardBtn?.addEventListener('click', async () => {
  openApiDashboardBtn.disabled = true;
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('pages/popup.html?api=1') });
    window.close();
  } catch (_) {
    openApiDashboardBtn.disabled = false;
    setLiveStatus('error', 'Could not open API settings', 'Try opening the extension popup again.');
  }
});


(async function init() {
  if (versionLabel) versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
  if (isApiPage) {
    if (versionLabel) versionLabel.textContent = 'Provider settings';
  } else {
    initializePopupStats();
    void initializeLiveSession().catch(() => {
      setLiveStatus('error', 'Could not check quiz tabs', 'Close and reopen the popup to retry the tab check.');
    });
  }
  settingsController.wireSettings();
  const hasKey = await settingsController.loadSettingsWithRecovery();
  await settingsController.initializeModelCatalog();
  if (isApiPage || !hasKey) {
    settingsController.expandAdvancedSettings();
  }
})();
