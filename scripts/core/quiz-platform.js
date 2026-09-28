export function getQuizPlatform(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'kahoot.it' || hostname.endsWith('.kahoot.it')) return 'kahoot';
    if (hostname === 'play.blooket.com') return 'blooket';
  } catch (_) {
  }
  return null;
}

export function isSupportedQuizUrl(url) {
  return getQuizPlatform(url) !== null;
}
