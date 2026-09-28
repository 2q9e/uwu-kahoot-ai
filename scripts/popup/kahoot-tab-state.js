export function isKahootUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === 'kahoot.it' || hostname.endsWith('.kahoot.it');
  } catch (_) {
    return false;
  }
}

export function resolveKahootTabSelection(tabs, previousTabId, { preferActive = false, selectionLocked = false } = {}) {
  const previousStillOpen = tabs.some(tab => tab.id === previousTabId);
  if (previousStillOpen && (!preferActive || selectionLocked)) {
    return { selectedTabId: previousTabId, selectionLocked };
  }

  const next = (preferActive ? tabs.find(tab => tab.active) : null) || tabs[0] || null;
  return { selectedTabId: next?.id ?? null, selectionLocked: false };
}

export function isCurrentKahootTabMessage(senderTab, selectedTab) {
  if (!senderTab || !selectedTab || senderTab.id !== selectedTab.id) return false;
  if (senderTab.url && !isKahootUrl(senderTab.url)) return false;
  if (selectedTab.url && !isKahootUrl(selectedTab.url)) return false;
  return !senderTab.url || !selectedTab.url || senderTab.url === selectedTab.url;
}
