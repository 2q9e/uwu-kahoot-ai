import { getProviderApiKeyEntries } from '../core/storage.js';
import { testProviderApiKeyRecord } from './api-key-testing.js';
import {
  createLocalConfigKeyCard,
  createProviderKeyCard
} from './api-key-card.js';

export function createApiKeyManager({
  getCurrentProvider,
  getCurrentSettings,
  setAiFeedback,
  updateApiStatus,
  onProviderKeysLoaded,
  onProviderKeysLoadFailed
}) {
  const apiKeyList = document.getElementById('apiKeyList');
  const apiKeySummary = document.getElementById('apiKeySummary');
  const localConfigKeysEl = document.getElementById('localConfigKeys');
  const testEnabledKeysButton = document.getElementById('testEnabledApiKeys');
  let renderTokenCounter = 0;

  function updateSummary(records, enabledRecords, localKeys) {
    if (testEnabledKeysButton) testEnabledKeysButton.disabled = enabledRecords.length === 0;
    if (!apiKeySummary) return;

    const firstEnabledLabel = enabledRecords[0]?.label || 'none';
    const localNote = localKeys.length
      ? ' · ' + localKeys.length + ' local-config key' + (localKeys.length === 1 ? '' : 's')
      : '';
    apiKeySummary.textContent = enabledRecords.length
      ? enabledRecords.length + ' active · ' + records.length + ' saved · first tried: ' + firstEnabledLabel + localNote
      : records.length + ' saved · no active key' + localNote;
  }

  function renderSavedKeys(provider, records, enabledRecords, localKeys) {
    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'api-key-empty';
      empty.textContent = 'No saved keys for this provider. Add one below to enable requests.';
      apiKeyList.append(empty);
    }

    const addKeySummary = document.querySelector('.add-api-key summary');
    const addKeyDetails = document.querySelector('.add-api-key');
    if (addKeySummary) addKeySummary.textContent = records.length ? 'Add another API key' : 'Add an API key';
    if (addKeyDetails && !records.length && !localKeys.length) {
      addKeyDetails.open = true;
    }

    records.forEach((record, index) => {
      const priority = record.enabled ? enabledRecords.indexOf(record) + 1 : 0;
      const card = createProviderKeyCard({
        provider,
        record,
        index,
        totalRecords: records.length,
        priority,
        setAiFeedback,
        refresh: () => render(provider)
      });
      apiKeyList.append(card);
    });
  }

  function renderLocalKeys(localKeys) {
    if (!localKeys.length) return;

    const heading = document.createElement('p');
    heading.className = 'local-key-heading';
    heading.textContent = 'Local config keys · ' + localKeys.length + ' read-only';
    localConfigKeysEl.append(heading);

    localKeys.forEach((secret, index) => {
      localConfigKeysEl.append(createLocalConfigKeyCard(secret, index, setAiFeedback));
    });
  }

  async function render(provider = getCurrentProvider()) {
    if (!apiKeyList || !localConfigKeysEl) return;
    const renderToken = ++renderTokenCounter;
    let records;
    try {
      records = await getProviderApiKeyEntries(provider);
    } catch (error) {
      if (renderToken === renderTokenCounter && provider === getCurrentProvider()) {
        apiKeyList.replaceChildren();
        localConfigKeysEl.replaceChildren();
        if (apiKeySummary) apiKeySummary.textContent = 'Could not load keys for this provider.';
        if (testEnabledKeysButton) testEnabledKeysButton.disabled = true;
        onProviderKeysLoadFailed?.(provider);
      }
      throw error;
    }

    if (renderToken !== renderTokenCounter || provider !== getCurrentProvider()) return;

    const settings = getCurrentSettings();
    const localKeys = settings.privateApiKeys?.[provider] || [];
    const enabledRecords = records.filter(record => record.enabled);
    updateSummary(records, enabledRecords, localKeys);
    settings.managedApiKeys = { ...(settings.managedApiKeys || {}), [provider]: records };
    apiKeyList.replaceChildren();
    localConfigKeysEl.replaceChildren();

    renderSavedKeys(provider, records, enabledRecords, localKeys);
    renderLocalKeys(localKeys);
    onProviderKeysLoaded?.(provider);
    updateApiStatus();
  }

  async function testEnabledKeys() {
    if (!testEnabledKeysButton) return;

    const provider = getCurrentProvider();
    let records;
    try {
      records = (await getProviderApiKeyEntries(provider)).filter(record => record.enabled);
    } catch (error) {
      setAiFeedback(error.message || 'Could not read saved keys.', 'error');
      return;
    }
    if (!records.length) {
      setAiFeedback('Enable a saved key before testing provider access.', 'error');
      return;
    }
    const replacementDraft = [...(apiKeyList?.querySelectorAll('.key-replacement-label input') || [])]
      .find(input => input.value.trim());
    if (replacementDraft) {
      setAiFeedback('Finish or clear the replacement key before testing enabled keys.', 'error');
      replacementDraft.focus();
      return;
    }

    testEnabledKeysButton.disabled = true;
    const originalText = testEnabledKeysButton.textContent;
    let passed = 0;
    let changedDuringTest = 0;
    const wasInert = apiKeyList?.inert === true;
    const previousBusyState = apiKeyList?.getAttribute('aria-busy');
    if (apiKeyList) {
      apiKeyList.inert = true;
      apiKeyList.setAttribute('aria-busy', 'true');
    }
    try {
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        testEnabledKeysButton.textContent = 'Testing ' + (index + 1) + '/' + records.length + '…';
        setAiFeedback('Checking ' + record.label + ' (' + (index + 1) + ' of ' + records.length + '). No generation request is sent.');
        const { result, stale } = await testProviderApiKeyRecord(provider, record);
        if (stale) {
          changedDuringTest += 1;
          continue;
        }
        if (result.ok) passed += 1;
      }

      await render(provider);
      const countLabel = records.length === 1 ? 'key' : 'keys';
      const summary = changedDuringTest
        ? passed + ' of ' + records.length + ' enabled ' + countLabel + ' passed. ' + changedDuringTest +
          ' changed or were removed during testing; their results were discarded.'
        : passed + ' of ' + records.length + ' enabled ' + countLabel + ' passed the provider access check.';
      setAiFeedback(
        summary,
        passed === records.length && changedDuringTest === 0 ? 'success' : 'error'
      );
    } catch (error) {
      setAiFeedback(error.message || 'Could not finish testing enabled keys.', 'error');
    } finally {
      if (apiKeyList) {
        apiKeyList.inert = wasInert;
        if (previousBusyState === null) apiKeyList.removeAttribute('aria-busy');
        else apiKeyList.setAttribute('aria-busy', previousBusyState);
      }
      testEnabledKeysButton.textContent = originalText;
      try { await render(getCurrentProvider()); } catch (_) {}
    }
  }

  testEnabledKeysButton?.addEventListener('click', testEnabledKeys);

  return { render };
}
