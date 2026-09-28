import {
  getProviderApiKeyEntries,
  moveProviderApiKey,
  removeProviderApiKey,
  updateProviderApiKey
} from '../core/storage.js';
import { maskApiKey } from '../core/api-key-manager.js';
import { validateProviderApiKey } from '../core/api-key-validation.js';

export function createApiKeyManager({ getCurrentProvider, getCurrentSettings, setAiFeedback, updateApiStatus }) {
  const apiKeyList = document.getElementById('apiKeyList');
  const apiKeySummary = document.getElementById('apiKeySummary');
  const localConfigKeysEl = document.getElementById('localConfigKeys');
  const testEnabledKeysButton = document.getElementById('testEnabledApiKeys');
  let renderTokenCounter = 0;

function managerButton(text, className = 'catalog-action secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

function makeManagedKeyValue(secret, label) {
  const row = document.createElement('div');
  row.className = 'managed-key-value';
  const value = document.createElement('code');
  value.className = 'managed-key-mask';
  value.textContent = maskApiKey(secret);
  value.setAttribute('aria-label', `${label}: masked key`);
  const reveal = managerButton('Reveal');
  reveal.setAttribute('aria-pressed', 'false');
  reveal.addEventListener('click', () => {
    const wasRevealed = reveal.getAttribute('aria-pressed') === 'true';
    value.textContent = wasRevealed ? maskApiKey(secret) : secret;
    value.classList.toggle('revealed', !wasRevealed);
    reveal.textContent = wasRevealed ? 'Reveal' : 'Hide';
    reveal.setAttribute('aria-pressed', String(!wasRevealed));
  });
  const copy = managerButton('Copy');
  copy.setAttribute('aria-label', `Copy ${label}`);
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setAiFeedback(`${label} copied. Clear it from your clipboard when finished.`, 'success');
    } catch (_) {
      setAiFeedback('Clipboard access is unavailable in this browser context.', 'error');
    }
  });
  row.append(value, reveal, copy);
  return row;
}

async function render(provider = getCurrentProvider()) {
  if (!apiKeyList || !localConfigKeysEl) return;
  const renderToken = ++renderTokenCounter;
  const records = await getProviderApiKeyEntries(provider);
  if (renderToken !== renderTokenCounter || provider !== getCurrentProvider()) return;
  const settings = getCurrentSettings();
  const localKeys = settings.privateApiKeys?.[provider] || [];
  const enabledRecords = records.filter(record => record.enabled);
  const primaryLabel = enabledRecords[0]?.label || 'none';
  if (testEnabledKeysButton) testEnabledKeysButton.disabled = enabledRecords.length === 0;
  if (apiKeySummary) {
    const localNote = localKeys.length ? ` · ${localKeys.length} local-config key${localKeys.length === 1 ? '' : 's'}` : '';
    apiKeySummary.textContent = enabledRecords.length
      ? `${enabledRecords.length} active · ${records.length} saved · first tried: ${primaryLabel}${localNote}`
      : `${records.length} saved · no active key${localNote}`;
  }
  settings.managedApiKeys = { ...(settings.managedApiKeys || {}), [provider]: records };
  apiKeyList.replaceChildren();
  localConfigKeysEl.replaceChildren();

  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'api-key-empty';
    empty.textContent = 'No saved keys for this provider. Add one below to enable requests.';
    apiKeyList.append(empty);
  }
  const addKeySummary = document.querySelector('.add-api-key summary');
  const addKeyDetails = document.querySelector('.add-api-key');
  if (addKeySummary) addKeySummary.textContent = records.length ? 'Add another API key' : 'Add an API key';
  if (addKeyDetails && !records.length && !localKeys.length) addKeyDetails.open = true;

  records.forEach((record, index) => {
    const card = document.createElement('article');
    card.className = `api-key-card${record.enabled ? '' : ' disabled'}`;
    const header = document.createElement('div');
    header.className = 'api-key-card-header';
    const labelWrap = document.createElement('label');
    labelWrap.className = 'api-key-label-wrap';
    const labelText = document.createElement('span');
    labelText.textContent = 'Label';
    const label = document.createElement('input');
    label.className = 'field-input api-key-label';
    label.type = 'text';
    label.maxLength = 60;
    label.value = record.label;
    label.setAttribute('aria-label', `Label for API key ${index + 1}`);
    labelWrap.append(labelText, label);
    const state = document.createElement('span');
    state.className = `api-key-state${record.enabled ? ' enabled' : ''}`;
    state.textContent = record.enabled ? 'Enabled' : 'Paused';
    const priority = document.createElement('span');
    priority.className = 'api-key-priority';
    priority.textContent = record.enabled ? `Priority ${enabledRecords.indexOf(record) + 1}` : 'Skipped';
    header.append(labelWrap, state, priority);

    const actions = document.createElement('div');
    actions.className = 'api-key-actions';
    const enableLabel = document.createElement('label');
    enableLabel.className = 'api-key-enabled toggle';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = record.enabled;
    enabled.setAttribute('aria-label', `Enable ${record.label}`);
    const track = document.createElement('span');
    track.className = 'toggle-track';
    enableLabel.append(enabled, track);
    const test = managerButton('Test key');
    test.title = 'Checks provider access without generating an AI response.';
    const up = managerButton('Move up', 'catalog-action secondary compact');
    up.title = `Move ${record.label} earlier in key order`;
    up.setAttribute('aria-label', up.title);
    up.disabled = index === 0;
    const down = managerButton('Move down', 'catalog-action secondary compact');
    down.title = `Move ${record.label} later in key order`;
    down.setAttribute('aria-label', down.title);
    down.disabled = index === records.length - 1;
    const replaceButton = managerButton('Replace key');
    const remove = managerButton('Remove', 'catalog-action danger');
    actions.append(enableLabel, test, up, down, replaceButton, remove);

    const replaceRow = document.createElement('div');
    replaceRow.className = 'key-replace-row hidden';
    const replacementLabel = document.createElement('label');
    replacementLabel.className = 'field-label key-replacement-label';
    replacementLabel.textContent = 'Replacement API key';
    const replacement = document.createElement('input');
    replacement.className = 'field-input';
    replacement.type = 'password';
    replacement.autocomplete = 'new-password';
    replacement.spellcheck = false;
    replacement.setAttribute('aria-label', `Replacement key for ${record.label}`);
    replacementLabel.append(replacement);
    const replaceSave = managerButton('Update key', 'catalog-action');
    replaceRow.append(replacementLabel, replaceSave);

    label.addEventListener('change', async () => {
      try {
        await updateProviderApiKey(provider, record.id, { label: label.value });
        setAiFeedback('Key label updated.', 'success');
      } catch (error) {
        setAiFeedback(error.message || 'Could not update the key label.', 'error');
      }
      await render(provider);
    });
    enabled.addEventListener('change', async () => {
      enabled.disabled = true;
      try {
        await updateProviderApiKey(provider, record.id, { enabled: enabled.checked });
        setAiFeedback(enabled.checked ? 'Key enabled in provider order.' : 'Key paused; it will be skipped.', 'success');
      } catch (_) {
        setAiFeedback('Could not update this key. Try again.', 'error');
      }
      await render(provider);
    });
    test.addEventListener('click', async () => {
      test.disabled = true;
      test.textContent = 'Testing…';
      setAiFeedback(`Testing ${record.label}. No generation request is sent.`);
      try {
        const result = await validateProviderApiKey(provider, record.secret);
        await updateProviderApiKey(provider, record.id, {
          lastTest: { at: Date.now(), ok: result.ok, status: result.status, message: result.message }
        });
        setAiFeedback(`${record.label}: ${result.message}`, result.ok ? 'success' : 'error');
      } catch (error) {
        setAiFeedback(error.message || `Could not test ${record.label}.`, 'error');
      } finally {
        if (test.isConnected) {
          test.disabled = false;
          test.textContent = 'Test key';
        }
        try { await render(provider); } catch (_) {  }
      }
    });
    up.addEventListener('click', async () => {
      up.disabled = true;
      try {
        await moveProviderApiKey(provider, record.id, 'up');
        setAiFeedback('Key order updated.', 'success');
        await render(provider);
      } catch (error) {
        setAiFeedback(error.message || 'Could not move this key.', 'error');
        up.disabled = false;
      }
    });
    down.addEventListener('click', async () => {
      down.disabled = true;
      try {
        await moveProviderApiKey(provider, record.id, 'down');
        setAiFeedback('Key order updated.', 'success');
        await render(provider);
      } catch (error) {
        setAiFeedback(error.message || 'Could not move this key.', 'error');
        down.disabled = false;
      }
    });
    replaceButton.addEventListener('click', () => {
      replaceRow.classList.toggle('hidden');
      if (!replaceRow.classList.contains('hidden')) replacement.focus();
    });
    replaceSave.addEventListener('click', async () => {
      replaceSave.disabled = true;
      try {
        await updateProviderApiKey(provider, record.id, { secret: replacement.value });
        setAiFeedback('Key replaced. Test it to verify provider access.', 'success');
        await render(provider);
      } catch (error) {
        setAiFeedback(error.message || 'Could not replace this key.', 'error');
      } finally {
        replaceSave.disabled = false;
      }
    });
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await removeProviderApiKey(provider, record.id);
        setAiFeedback('Key removed from this browser.', 'success');
        await render(provider);
      } catch (_) {
        remove.disabled = false;
        setAiFeedback('Could not remove this key. Try again.', 'error');
      }
    });

    const value = makeManagedKeyValue(record.secret, record.label);
    const testStatus = document.createElement('p');
    testStatus.className = `api-key-test-status${record.lastTest ? (record.lastTest.ok ? ' success' : ' failed') : ' pending'}`;
    if (record.lastTest) {
      const when = record.lastTest.at ? new Date(record.lastTest.at).toLocaleString() : '';
      testStatus.textContent = `Last test: ${record.lastTest.message || (record.lastTest.ok ? 'key accepted.' : 'check failed.')}${when ? ` · ${when}` : ''}`;
    } else {
      testStatus.textContent = 'Not tested yet · Test key checks access without sending a generation request.';
    }
    card.append(header, value, actions, replaceRow, testStatus);
    apiKeyList.append(card);
  });

  if (localKeys.length) {
    const heading = document.createElement('p');
    heading.className = 'local-key-heading';
    heading.textContent = `Local config keys · ${localKeys.length} read-only`;
    localConfigKeysEl.append(heading);
    localKeys.forEach((secret, index) => {
      const card = document.createElement('article');
      card.className = 'api-key-card local-config-card';
      const label = document.createElement('strong');
      label.className = 'local-config-name';
      label.textContent = `Local config key ${index + 1}`;
      card.append(label, makeManagedKeyValue(secret, `Local config key ${index + 1}`));
      localConfigKeysEl.append(card);
    });
  }
  updateApiStatus();
}

async function testEnabledKeys() {
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
  testEnabledKeysButton.disabled = true;
  const originalText = testEnabledKeysButton.textContent;
  testEnabledKeysButton.textContent = `Testing 0/${records.length}…`;
  let passed = 0;
  try {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      testEnabledKeysButton.textContent = `Testing ${index + 1}/${records.length}…`;
      setAiFeedback(`Checking ${record.label} (${index + 1} of ${records.length}). No generation request is sent.`);
      const result = await validateProviderApiKey(provider, record.secret);
      try {
        await updateProviderApiKey(provider, record.id, {
          lastTest: { at: Date.now(), ok: result.ok, status: result.status, message: result.message }
        });
      } catch (_) {  }
      if (result.ok) passed += 1;
    }
    await render(provider);
    setAiFeedback(`${passed} of ${records.length} enabled key${records.length === 1 ? '' : 's'} passed the provider access check.`, passed === records.length ? 'success' : 'error');
  } catch (error) {
    setAiFeedback(error.message || 'Could not finish testing enabled keys.', 'error');
  } finally {
    testEnabledKeysButton.textContent = originalText;
    try { await render(getCurrentProvider()); } catch (_) {  }
  }
}

testEnabledKeysButton?.addEventListener('click', testEnabledKeys);

  return { render };
}
