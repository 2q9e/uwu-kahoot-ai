import {
  moveProviderApiKey,
  removeProviderApiKey,
  updateProviderApiKey
} from '../core/storage.js';
import { maskApiKey } from '../core/api-key-manager.js';
import { testProviderApiKeyRecord } from './api-key-testing.js';

function managerButton(text, className = 'catalog-action secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  return button;
}

export function createManagedKeyValue(secret, label, setAiFeedback) {
  const row = document.createElement('div');
  row.className = 'managed-key-value';
  const value = document.createElement('code');
  value.className = 'managed-key-mask';
  value.textContent = maskApiKey(secret);
  value.setAttribute('aria-label', label + ': masked key');

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
  copy.setAttribute('aria-label', 'Copy ' + label);
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setAiFeedback(label + ' copied. Clear it from your clipboard when finished.', 'success');
    } catch (_) {
      setAiFeedback('Clipboard access is unavailable in this browser context.', 'error');
    }
  });

  row.append(value, reveal, copy);
  return row;
}

export function createProviderKeyCard({
  provider,
  record,
  index,
  totalRecords,
  priority,
  setAiFeedback,
  refresh
}) {
  const card = document.createElement('article');
  card.className = 'api-key-card' + (record.enabled ? '' : ' disabled');

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
  label.setAttribute('aria-label', 'Label for API key ' + (index + 1));
  labelWrap.append(labelText, label);

  const state = document.createElement('span');
  state.className = 'api-key-state' + (record.enabled ? ' enabled' : '');
  state.textContent = record.enabled ? 'Enabled' : 'Paused';
  const priorityLabel = document.createElement('span');
  priorityLabel.className = 'api-key-priority';
  priorityLabel.textContent = record.enabled ? 'Priority ' + priority : 'Skipped';
  header.append(labelWrap, state, priorityLabel);

  const actions = document.createElement('div');
  actions.className = 'api-key-actions api-key-primary-actions';
  const enableLabel = document.createElement('label');
  enableLabel.className = 'api-key-enabled toggle';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = record.enabled;
  enabled.setAttribute('aria-label', 'Enable ' + record.label);
  const track = document.createElement('span');
  track.className = 'toggle-track';
  enableLabel.append(enabled, track);

  const test = managerButton('Test key');
  test.title = 'Checks provider access without generating an AI response.';
  const up = managerButton('Move up', 'catalog-action secondary compact');
  up.title = 'Move ' + record.label + ' earlier in key order';
  up.setAttribute('aria-label', up.title);
  up.disabled = index === 0;
  const down = managerButton('Move down', 'catalog-action secondary compact');
  down.title = 'Move ' + record.label + ' later in key order';
  down.setAttribute('aria-label', down.title);
  down.disabled = index === totalRecords - 1;
  const replaceButton = managerButton('Replace key');
  const remove = managerButton('Remove', 'catalog-action danger');
  actions.append(enableLabel, test);

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
  replacement.setAttribute('aria-label', 'Replacement key for ' + record.label);
  replacementLabel.append(replacement);
  const replaceSave = managerButton('Update key', 'catalog-action');
  replaceRow.append(replacementLabel, replaceSave);

  const management = document.createElement('details');
  management.className = 'api-key-management';
  const managementSummary = document.createElement('summary');
  managementSummary.textContent = 'Manage key';
  managementSummary.setAttribute('aria-label', 'Manage key ' + record.label);
  const managementContent = document.createElement('div');
  managementContent.className = 'api-key-management-content';
  const managementActions = document.createElement('div');
  managementActions.className = 'api-key-actions api-key-management-actions';
  managementActions.append(up, down, replaceButton, remove);
  managementContent.append(managementActions, replaceRow);
  management.append(managementSummary, managementContent);

  const keyMutationControls = [label, enabled, up, down, replaceButton, remove, replacement, replaceSave];
  let priorMutationControlStates = [];
  function setKeyMutationControlsDisabled(disabled) {
    if (disabled) {
      priorMutationControlStates = keyMutationControls.map(control => [control, control.disabled]);
      for (const [control] of priorMutationControlStates) control.disabled = true;
      return;
    }
    for (const [control, wasDisabled] of priorMutationControlStates) control.disabled = wasDisabled;
    priorMutationControlStates = [];
  }

  async function finishKeyMutation(message) {
    setAiFeedback(message, 'success');
    try {
      await refresh();
    } catch (error) {
      const detail = error?.message ? ' ' + error.message : '';
      setAiFeedback(message + ' The change was saved, but the key list could not be refreshed. Reopen API settings to reload it.' + detail, 'error');
    }
  }

  label.addEventListener('change', async () => {
    try {
      await updateProviderApiKey(provider, record.id, { label: label.value });
      setAiFeedback('Key label updated.', 'success');
    } catch (error) {
      setAiFeedback(error.message || 'Could not update the key label.', 'error');
    }
    try {
      await refresh();
    } catch (error) {
      setAiFeedback(error.message || 'Could not reload saved keys.', 'error');
    }
  });

  enabled.addEventListener('change', async () => {
    enabled.disabled = true;
    try {
      await updateProviderApiKey(provider, record.id, { enabled: enabled.checked });
      setAiFeedback(enabled.checked ? 'Key enabled in provider order.' : 'Key paused; it will be skipped.', 'success');
    } catch (_) {
      setAiFeedback('Could not update this key. Try again.', 'error');
    }
    try {
      await refresh();
    } catch (error) {
      setAiFeedback(error.message || 'Could not reload saved keys.', 'error');
    }
  });

  test.addEventListener('click', async () => {
    if (replacement.value.trim()) {
      setAiFeedback('Finish or clear the replacement key before testing the saved key.', 'error');
      replacement.focus();
      return;
    }
    test.disabled = true;
    test.textContent = 'Testing…';
    setKeyMutationControlsDisabled(true);
    setAiFeedback('Testing ' + record.label + '. No generation request is sent.');
    try {
      const { result, persistenceError, stale } = await testProviderApiKeyRecord(provider, record);
      if (stale) {
        setAiFeedback(record.label + ' changed or was removed during the test. The result was discarded; test the current key.', 'error');
        return;
      }
      if (persistenceError) throw persistenceError;
      setAiFeedback(record.label + ': ' + result.message, result.ok ? 'success' : 'error');
    } catch (error) {
      setAiFeedback(error.message || 'Could not test ' + record.label + '.', 'error');
    } finally {
      setKeyMutationControlsDisabled(false);
      if (test.isConnected) {
        test.disabled = false;
        test.textContent = 'Test key';
      }
      try { await refresh(); } catch (_) {}
    }
  });

  up.addEventListener('click', async () => {
    up.disabled = true;
    try {
      await moveProviderApiKey(provider, record.id, 'up');
      await finishKeyMutation('Key order updated.');
    } catch (error) {
      setAiFeedback(error.message || 'Could not move this key.', 'error');
      up.disabled = false;
    }
  });

  down.addEventListener('click', async () => {
    down.disabled = true;
    try {
      await moveProviderApiKey(provider, record.id, 'down');
      await finishKeyMutation('Key order updated.');
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
      replacement.value = '';
      await finishKeyMutation('Key replaced. Test it to verify provider access.');
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
      await finishKeyMutation('Key removed from this browser.');
    } catch (_) {
      remove.disabled = false;
      setAiFeedback('Could not remove this key. Try again.', 'error');
    }
  });

  const value = createManagedKeyValue(record.secret, record.label, setAiFeedback);
  const testStatus = document.createElement('p');
  testStatus.className = 'api-key-test-status' +
    (record.lastTest ? (record.lastTest.ok ? ' success' : ' failed') : ' pending');
  if (record.lastTest) {
    const when = record.lastTest.at ? new Date(record.lastTest.at).toLocaleString() : '';
    const result = record.lastTest.message || (record.lastTest.ok ? 'key accepted.' : 'check failed.');
    testStatus.textContent = 'Last test: ' + result + (when ? ' · ' + when : '');
  } else {
    testStatus.textContent = 'Not tested yet · Test key checks access without sending a generation request.';
  }

  card.append(header, value, actions, management, testStatus);
  return card;
}

export function createLocalConfigKeyCard(secret, index, setAiFeedback) {
  const card = document.createElement('article');
  card.className = 'api-key-card local-config-card';
  const label = document.createElement('strong');
  label.className = 'local-config-name';
  label.textContent = 'Local config key ' + (index + 1);
  card.append(label, createManagedKeyValue(secret, label.textContent, setAiFeedback));
  return card;
}
