import {
  moveProviderApiKey,
  removeProviderApiKey,
  updateProviderApiKey
} from '../core/storage.js';
import { maskApiKey } from '../core/api-key-manager.js';
import { validateProviderApiKey } from '../core/api-key-validation.js';

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
  actions.className = 'api-key-actions';
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
  replacement.setAttribute('aria-label', 'Replacement key for ' + record.label);
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
    test.disabled = true;
    test.textContent = 'Testing…';
    setAiFeedback('Testing ' + record.label + '. No generation request is sent.');
    try {
      const result = await validateProviderApiKey(provider, record.secret);
      await updateProviderApiKey(provider, record.id, {
        lastTest: { at: Date.now(), ok: result.ok, status: result.status, message: result.message }
      });
      setAiFeedback(record.label + ': ' + result.message, result.ok ? 'success' : 'error');
    } catch (error) {
      setAiFeedback(error.message || 'Could not test ' + record.label + '.', 'error');
    } finally {
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
      setAiFeedback('Key order updated.', 'success');
      await refresh();
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
      await refresh();
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
      await refresh();
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
      await refresh();
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

  card.append(header, value, actions, replaceRow, testStatus);
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
