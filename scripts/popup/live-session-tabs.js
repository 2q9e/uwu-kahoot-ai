import { isKahootUrl, resolveKahootTabSelection } from './kahoot-tab-state.js';

const SELECTED_KAHOOT_TAB_KEY = 'uwuKahootSelectedTabId';

export function createLiveSessionTabs({
  kahootTabSelect,
  kahootTabCount,
  kahootAttachStatus,
  focusKahootTabBtn,
  reloadKahootTabBtn,
  clearSelectedQuestion,
  setLiveStatus,
  pollCurrentQuestion,
  tabsApi = globalThis.chrome?.tabs,
  windowsApi = globalThis.chrome?.windows,
  sessionStorage = globalThis.chrome?.storage?.session
}) {
  let kahootTabs = [];
  let selectedKahootTabId = null;
  let selectionLocked = false;
  let tabRefreshToken = 0;
  let kahootTabProbeSequence = 0;
  const kahootTabConnections = new Map();
  const kahootTabProbeTokens = new Map();

  function compareKahootTabs(a, b) {
    return Number(b.active) - Number(a.active) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
  }

  function getSelectedTab() {
    return kahootTabs.find(tab => tab.id === selectedKahootTabId) || null;
  }

  function persistSelectedTab() {
    try {
      if (sessionStorage) void sessionStorage.set({ [SELECTED_KAHOOT_TAB_KEY]: selectedKahootTabId }).catch(() => {});
    } catch (_) {
    }
  }

  function connectionState(tabId) {
    return kahootTabConnections.get(tabId)?.state || 'checking';
  }

  function renderTabs() {
    if (!kahootTabSelect) return;
    const selectedId = String(selectedKahootTabId ?? '');
    kahootTabSelect.replaceChildren();
    if (!kahootTabs.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No open Kahoot tabs';
      kahootTabSelect.append(option);
      kahootTabSelect.disabled = true;
      if (kahootTabCount) kahootTabCount.textContent = '0 open';
      if (kahootAttachStatus) kahootAttachStatus.textContent = 'Open a Kahoot game in any window to attach.';
      focusKahootTabBtn && (focusKahootTabBtn.disabled = true);
      reloadKahootTabBtn?.classList.add('hidden');
      return;
    }

    kahootTabSelect.disabled = false;
    for (const [position, tab] of kahootTabs.entries()) {
      const option = document.createElement('option');
      option.value = String(tab.id);
      const label = (tab.title || 'Kahoot game').replace(/\s+/g, ' ').trim().slice(0, 52) || 'Kahoot game';
      const windowLabel = `Window ${Number.isInteger(tab.windowId) ? tab.windowId + 1 : '?'}`;
      const positionLabel = Number.isInteger(tab.index) ? `Tab ${tab.index + 1}` : `Tab ${position + 1}`;
      const activeLabel = tab.active ? ' · Active' : '';
      const connection = connectionState(tab.id);
      const connectionLabel = connection === 'connected' ? ' · Connected' : connection === 'reload' ? ' · Reload needed' : ' · Checking';
      option.textContent = `${windowLabel} · ${positionLabel}${activeLabel} · ${label}${connectionLabel}`;
      option.selected = String(tab.id) === selectedId;
      kahootTabSelect.append(option);
    }

    const connectedCount = kahootTabs.filter(tab => connectionState(tab.id) === 'connected').length;
    if (kahootTabCount) kahootTabCount.textContent = `${kahootTabs.length} open · ${connectedCount} connected`;
    const selected = getSelectedTab();
    if (focusKahootTabBtn) focusKahootTabBtn.disabled = !selected;
    const needsReload = !!selected && connectionState(selected.id) === 'reload';
    if (reloadKahootTabBtn) {
      reloadKahootTabBtn.classList.toggle('hidden', !needsReload);
      reloadKahootTabBtn.disabled = !needsReload;
    }
    if (kahootAttachStatus) {
      const state = selected ? connectionState(selected.id) : 'checking';
      kahootAttachStatus.textContent = !selected
        ? 'Choose a Kahoot tab to view its live question.'
        : state === 'connected'
          ? `Connected to this tab. The live panel only shows activity from the selected tab${selected.active ? ', which is active' : ''}.`
          : state === 'reload'
            ? 'This page has not connected yet. Reload this selected Kahoot tab to attach the extension.'
            : 'Checking this tab for the extension connection…';
    }
  }

  async function probeTab(tabId) {
    const tabAtStart = kahootTabs.find(candidate => candidate.id === tabId);
    if (!tabAtStart) return;
    const expectedUrl = tabAtStart.url;
    const probeToken = ++kahootTabProbeSequence;
    kahootTabProbeTokens.set(tabId, probeToken);
    let connected = false;
    try {
      await tabsApi.sendMessage(tabId, { action: 'ping' }, { frameId: 0 });
      connected = true;
    } catch (_) {
      try {
        await tabsApi.sendMessage(tabId, { action: 'ping' });
        connected = true;
      } catch (_) {
      }
    }
    const tab = kahootTabs.find(candidate => candidate.id === tabId);
    if (!tab || tab.url !== expectedUrl || kahootTabProbeTokens.get(tabId) !== probeToken) return;
    kahootTabConnections.set(tabId, { url: tab.url, state: connected ? 'connected' : 'reload' });
    renderTabs();
  }

  async function refreshTabs({ preferActive = false, probeIds = [] } = {}) {
    const token = ++tabRefreshToken;
    let tabs;
    try {
      tabs = (await tabsApi.query({})).filter(tab => Number.isInteger(tab.id) && isKahootUrl(tab.url)).sort(compareKahootTabs);
    } catch (_) {
      if (token !== tabRefreshToken) return;
      kahootTabs = [];
      kahootTabConnections.clear();
      kahootTabProbeTokens.clear();
      selectedKahootTabId = null;
      selectionLocked = false;
      persistSelectedTab();
      renderTabs();
      clearSelectedQuestion();
      if (kahootAttachStatus) kahootAttachStatus.textContent = 'Could not inspect open tabs. Close and reopen the extension popup.';
      setLiveStatus('error', 'Could not check Kahoot tabs', 'Close and reopen the popup to retry the tab check.');
      return;
    }
    if (token !== tabRefreshToken) return;

    const oldSelection = selectedKahootTabId;
    const existingIds = new Set(tabs.map(tab => tab.id));
    for (const id of kahootTabConnections.keys()) {
      if (!existingIds.has(id)) {
        kahootTabConnections.delete(id);
        kahootTabProbeTokens.delete(id);
      }
    }
    kahootTabs = tabs;
    const selection = resolveKahootTabSelection(tabs, oldSelection, { preferActive, selectionLocked });
    selectedKahootTabId = selection.selectedTabId;
    selectionLocked = selection.selectionLocked;
    if (selectedKahootTabId !== oldSelection) persistSelectedTab();

    if (!tabs.length) {
      kahootTabConnections.clear();
      kahootTabProbeTokens.clear();
      clearSelectedQuestion();
      setLiveStatus('idle', 'Open a Kahoot game', 'Open a Kahoot tab in any window to see live question status.');
    }
    for (const tab of tabs) {
      const previous = kahootTabConnections.get(tab.id);
      const forceProbe = probeIds.includes(tab.id);
      if (!previous || previous.url !== tab.url || forceProbe) {
        kahootTabConnections.set(tab.id, { url: tab.url, state: 'checking' });
        void probeTab(tab.id);
      }
    }
    renderTabs();
    if (selectedKahootTabId !== oldSelection) {
      clearSelectedQuestion();
      setLiveStatus('ready', 'Checking selected tab…', 'Reading the selected Kahoot tab.');
      await pollCurrentQuestion(selectedKahootTabId);
    }
  }

  async function initialize() {
    try {
      const storedTab = await sessionStorage?.get(SELECTED_KAHOOT_TAB_KEY);
      const savedTabId = Number(storedTab?.[SELECTED_KAHOOT_TAB_KEY]);
      if (Number.isInteger(savedTabId) && savedTabId > 0) {
        selectedKahootTabId = savedTabId;
        selectionLocked = true;
      }
    } catch (_) {}
    await refreshTabs({ preferActive: !selectionLocked });
  }

  kahootTabSelect?.addEventListener('change', () => {
    selectedKahootTabId = Number(kahootTabSelect.value) || null;
    selectionLocked = selectedKahootTabId !== null;
    persistSelectedTab();
    clearSelectedQuestion();
    renderTabs();
    if (selectedKahootTabId) {
      setLiveStatus('ready', 'Checking selected tab…', 'Reading the selected Kahoot tab.');
      pollCurrentQuestion(selectedKahootTabId);
    } else setLiveStatus('idle', 'Open a Kahoot game', 'Open a Kahoot tab in any window to see live question status.');
  });

  focusKahootTabBtn?.addEventListener('click', async () => {
    const tab = getSelectedTab();
    if (!tab?.id) return;
    focusKahootTabBtn.disabled = true;
    try {
      await windowsApi.update(tab.windowId, { focused: true });
      await tabsApi.update(tab.id, { active: true });
    } catch (_) {
      setLiveStatus('error', 'Could not focus tab', 'The selected Kahoot tab may have been closed.');
    } finally {
      focusKahootTabBtn.disabled = !getSelectedTab();
    }
  });

  reloadKahootTabBtn?.addEventListener('click', async () => {
    const tab = getSelectedTab();
    if (!tab?.id) return;
    reloadKahootTabBtn.disabled = true;
    kahootTabConnections.set(tab.id, { url: tab.url, state: 'checking' });
    renderTabs();
    setLiveStatus('processing', 'Connecting…', 'Reloading only the selected Kahoot tab.');
    try {
      await tabsApi.reload(tab.id);
    } catch (_) {
      kahootTabConnections.set(tab.id, { url: tab.url, state: 'reload' });
      renderTabs();
      setLiveStatus('error', 'Could not reload tab', 'Try reloading the selected Kahoot page in the browser.');
    }
  });

  tabsApi.onCreated.addListener(() => { void refreshTabs(); });
  tabsApi.onRemoved.addListener(tabId => {
    kahootTabConnections.delete(tabId);
    kahootTabProbeTokens.delete(tabId);
    void refreshTabs({ preferActive: true });
  });
  tabsApi.onActivated.addListener(() => {
    void refreshTabs({ preferActive: !selectionLocked });
  });
  tabsApi.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      void refreshTabs();
      return;
    }
    if (!isKahootUrl(tab?.url) || changeInfo.status !== 'complete') return;
    void refreshTabs({ probeIds: [tabId] }).then(() => {
      if (tabId === selectedKahootTabId) void pollCurrentQuestion(tabId);
    });
  });
  windowsApi.onFocusChanged.addListener(() => { void refreshTabs({ preferActive: !selectionLocked }); });

  return {
    getSelectedTab,
    getSelectedTabId: () => selectedKahootTabId,
    getTabs: () => kahootTabs,
    initialize,
    refreshTabs,
    renderTabs,
    setConnection: (tabId, connection) => kahootTabConnections.set(tabId, connection),
    getConnectionState: connectionState
  };
}
