export function getApiStatusPresentation({
  state,
  currentProvider,
  currentSettings = {},
  providers,
  providerKeyLoadError = false
}) {
  if (state !== 'ready') {
    const unavailable = state === 'unavailable';
    return {
      text: unavailable ? 'Settings unavailable' : 'Checking keys…',
      className: `api-pill ${unavailable ? 'missing' : 'checking'}`,
      title: unavailable
        ? 'Extension storage could not be read. Use Retry settings to try again.'
        : 'Checking the configured provider keys.',
      ariaBusy: String(!unavailable)
    };
  }

  if (providerKeyLoadError) {
    return {
      text: 'Key status unknown',
      className: 'api-pill checking',
      title: 'Saved keys for this provider could not be loaded. Check the key list message and try again.',
      ariaBusy: 'false'
    };
  }

  const privateKeys = currentSettings.privateApiKeys || {};
  const managedKeys = currentSettings.managedApiKeys || {};
  const hasSavedPreferredKey = (managedKeys[currentProvider] || []).some(key => key.enabled);
  const hasPrivatePreferredKey = !!privateKeys[currentProvider]?.length;
  const fallbackKeyCount = Object.keys(providers).reduce((total, provider) => provider === currentProvider
    ? total
    : total + (managedKeys[provider] || []).filter(key => key.enabled).length + (privateKeys[provider]?.length || 0), 0);
  const hasFallbackKey = fallbackKeyCount > 0;
  const fallbackEnabled = currentSettings.aiFallbackEnabled !== false;

  if (hasSavedPreferredKey) {
    const activeCount = (managedKeys[currentProvider] || []).filter(key => key.enabled).length;
    const primaryKey = (managedKeys[currentProvider] || []).find(key => key.enabled);
    const lastTest = primaryKey?.lastTest;
    const keyCount = `${activeCount} managed key${activeCount === 1 ? '' : 's'}`;
    const testDetails = lastTest
      ? `The first key was last checked ${new Date(lastTest.at).toLocaleString()}: ${lastTest.message}`
      : 'Run Test key to check provider access.';
    return {
      text: lastTest ? (lastTest.ok ? 'Key test passed' : 'Key test failed') : 'Key not tested',
      className: `api-pill ${lastTest ? (lastTest.ok ? 'ok' : 'missing') : 'checking'}`,
      title: `${keyCount} enabled for the preferred provider. The first enabled key is tried first. ${testDetails}`,
      ariaBusy: 'false'
    };
  }

  if (hasPrivatePreferredKey) {
    return {
      text: 'Local key · not tested',
      className: 'api-pill local',
      title: 'A key is configured in the local-only source file and has not been verified.',
      ariaBusy: 'false'
    };
  }

  if (fallbackEnabled && hasFallbackKey) {
    return {
      text: 'Fallback configured',
      className: 'api-pill fallback',
      title: `No key is enabled for the selected provider; ${fallbackKeyCount} enabled key${fallbackKeyCount === 1 ? '' : 's'} for another provider can be tried as fallback.`,
      ariaBusy: 'false'
    };
  }

  return {
    text: 'No active key',
    className: 'api-pill missing',
    title: 'No enabled key can currently be used. Add a key for the selected provider or enable a configured fallback.',
    ariaBusy: 'false'
  };
}
