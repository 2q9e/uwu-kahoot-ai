import { getQuizPlatform, isSupportedQuizUrl } from '../core/quiz-platform.js';

export function isKahootUrl(url) {
  return getQuizPlatform(url) === 'kahoot';
}

export { getQuizPlatform, isSupportedQuizUrl };

export function resolveKahootTabSelection(tabs, previousTabId, { preferActive = false, selectionLocked = false } = {}) {
  const previousStillOpen = tabs.some(tab => tab.id === previousTabId);
  if (previousStillOpen && (!preferActive || selectionLocked)) {
    return { selectedTabId: previousTabId, selectionLocked };
  }

  const next = (preferActive ? tabs.find(tab => tab.active) : null) || tabs[0] || null;
  return { selectedTabId: next?.id ?? null, selectionLocked: false };
}

export function isCurrentQuizTabMessage(senderTab, selectedTab) {
  if (!senderTab || !selectedTab || senderTab.id !== selectedTab.id) return false;
  if (senderTab.url && !isSupportedQuizUrl(senderTab.url)) return false;
  if (selectedTab.url && !isSupportedQuizUrl(selectedTab.url)) return false;
  return !senderTab.url || !selectedTab.url || senderTab.url === selectedTab.url;
}

export const isCurrentKahootTabMessage = isCurrentQuizTabMessage;
