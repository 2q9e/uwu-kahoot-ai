
export const API_KEY_MANAGER_STORAGE_KEY = 'uwuKahootApiKeyManagerV1';

const PROVIDERS = new Set(['openai', 'gemini', 'openrouter']);
const MANAGER_WRITE_LOCK_NAME = `${API_KEY_MANAGER_STORAGE_KEY}:write`;
const LEGACY_KEY_NAMES = {
  openai: 'openaiApiKey',
  gemini: 'geminiApiKey',
  openrouter: 'openrouterApiKey'
};
let managerWriteQueue = Promise.resolve();

function assertProvider(provider) {
  if (!PROVIDERS.has(provider)) throw new Error('Unknown API provider.');
}

function newId() {
  return globalThis.crypto?.randomUUID?.() || `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function redactSecret(message, secret) {
  return secret ? message.split(secret).join('[hidden]') : message;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const secret = typeof record.secret === 'string' ? record.secret.trim() : '';
  if (!secret) return null;
  const id = typeof record.id === 'string' ? record.id.trim().slice(0, 100) : '';
  return {
    id: id || newId(),
    label: typeof record.label === 'string' && record.label.trim() ? record.label.trim().slice(0, 60) : 'API key',
    secret,
    enabled: record.enabled === undefined ? true : record.enabled === true,
    createdAt: Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : Date.now(),
    lastTest: record.lastTest && typeof record.lastTest === 'object' ? {
      at: Number.isFinite(Number(record.lastTest.at)) ? Number(record.lastTest.at) : 0,
      ok: record.lastTest.ok === true,
      status: Number.isFinite(Number(record.lastTest.status)) ? Number(record.lastTest.status) : 0,
      message: typeof record.lastTest.message === 'string'
        ? redactSecret(record.lastTest.message, secret).slice(0, 100)
        : ''
    } : null
  };
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set();
  const seenSecrets = new Set();
  return value.map(normalizeRecord).filter(record => {
    if (!record || seenIds.has(record.id) || seenSecrets.has(record.secret)) return false;
    seenIds.add(record.id);
    seenSecrets.add(record.secret);
    return true;
  });
}

async function readManager() {
  const saved = await chrome.storage.local.get(API_KEY_MANAGER_STORAGE_KEY);
  const manager = saved[API_KEY_MANAGER_STORAGE_KEY];
  if (!manager || typeof manager !== 'object' || Array.isArray(manager)) return {};
  return {
    ...manager,
    openai: normalizeRecords(manager.openai),
    gemini: normalizeRecords(manager.gemini),
    openrouter: normalizeRecords(manager.openrouter)
  };
}

function serializeManagerMutation(mutate) {
  const update = async () => {
    const runWithLock = async () => {
      const manager = await readManager();
      return mutate(manager);
    };
    const locks = globalThis.navigator?.locks;
    return typeof locks?.request === 'function'
      ? locks.request(MANAGER_WRITE_LOCK_NAME, { mode: 'exclusive' }, runWithLock)
      : runWithLock();
  };
  const task = managerWriteQueue.then(update, update);
  managerWriteQueue = task.then(() => undefined, () => undefined);
  return task;
}

function mutateProviderRecords(provider, mutate) {
  return serializeManagerMutation(async manager => {
    const records = normalizeRecords(manager[provider]);
    const result = await mutate(records);
    await chrome.storage.local.set({
      [API_KEY_MANAGER_STORAGE_KEY]: { ...manager, [provider]: normalizeRecords(records) }
    });
    return result;
  });
}

export async function readProviderKeyRecords(provider) {
  assertProvider(provider);
  const manager = await readManager();
  return normalizeRecords(manager[provider]);
}

export async function migrateLegacyProviderKey(provider) {
  assertProvider(provider);
  const legacyName = LEGACY_KEY_NAMES[provider];
  return serializeManagerMutation(async manager => {
    const legacy = await chrome.storage.local.get(legacyName);
    const secret = typeof legacy[legacyName] === 'string' ? legacy[legacyName].trim() : '';
    const records = normalizeRecords(manager[provider]);
    if (secret && !records.some(record => record.secret === secret)) {
      records.unshift({ id: newId(), label: records.length ? 'Migrated primary key' : 'Primary key', secret, enabled: true, createdAt: Date.now(), lastTest: null });
    }
    if (secret) {
      await chrome.storage.local.set({
        [API_KEY_MANAGER_STORAGE_KEY]: { ...manager, [provider]: normalizeRecords(records) }
      });
      await chrome.storage.local.remove(legacyName);
    }
    return records;
  });
}

export async function importLocalConfigProviderKeys(provider, secrets) {
  assertProvider(provider);
  const normalized = [...new Set((Array.isArray(secrets) ? secrets : [])
    .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
  if (!normalized.length) return readProviderKeyRecords(provider);
  return serializeManagerMutation(async manager => {
    const imports = manager.__localConfigImported && typeof manager.__localConfigImported === 'object'
      ? manager.__localConfigImported : {};
    const records = normalizeRecords(manager[provider]);
    if (imports[provider] === true) return records;
    normalized.forEach((secret, index) => {
      if (!records.some(record => record.secret === secret)) {
        records.push(normalizeRecord({
          id: newId(), label: `Imported local key ${index + 1}`, secret, enabled: true, createdAt: Date.now()
        }));
      }
    });
    await chrome.storage.local.set({
      [API_KEY_MANAGER_STORAGE_KEY]: {
        ...manager,
        [provider]: normalizeRecords(records),
        __localConfigImported: { ...imports, [provider]: true }
      }
    });
    return records;
  });
}

export async function hasImportedLocalConfigKeys(provider) {
  assertProvider(provider);
  const manager = await readManager();
  return manager.__localConfigImported?.[provider] === true;
}

export async function addProviderKeyRecord(provider, { label, secret }) {
  assertProvider(provider);
  const normalizedSecret = typeof secret === 'string' ? secret.trim() : '';
  if (!normalizedSecret) throw new Error('Enter an API key first.');
  return mutateProviderRecords(provider, records => {
    if (records.some(record => record.secret === normalizedSecret)) throw new Error('That key is already in this provider list.');
    const record = normalizeRecord({ id: newId(), label, secret: normalizedSecret, enabled: true, createdAt: Date.now() });
    records.push(record);
    return record;
  });
}

export async function updateProviderKeyRecord(provider, id, changes = {}) {
  assertProvider(provider);
  return mutateProviderRecords(provider, records => {
    const index = records.findIndex(record => record.id === id);
    if (index < 0) throw new Error('API key entry not found.');
    const next = { ...records[index] };
    if (Object.hasOwn(changes, 'label')) {
      const label = typeof changes.label === 'string' ? changes.label.trim().slice(0, 60) : '';
      if (!label) throw new Error('Enter a label for this key.');
      next.label = label;
    }
    if (Object.hasOwn(changes, 'secret')) {
      const secret = typeof changes.secret === 'string' ? changes.secret.trim() : '';
      if (!secret) throw new Error('Enter a replacement API key.');
      if (records.some((record, recordIndex) => recordIndex !== index && record.secret === secret)) throw new Error('That key is already in this provider list.');
      next.secret = secret;
      next.lastTest = null;
    }
    if (Object.hasOwn(changes, 'enabled')) next.enabled = changes.enabled === true;
    if (Object.hasOwn(changes, 'lastTest')) {
      const result = changes.lastTest;
      let message = typeof result?.message === 'string' ? result.message : '';
      message = redactSecret(message, records[index].secret);
      message = redactSecret(message, next.secret).slice(0, 100);
      next.lastTest = result && typeof result === 'object' ? {
        at: Number.isFinite(Number(result.at)) ? Number(result.at) : Date.now(),
        ok: result.ok === true,
        status: Number.isFinite(Number(result.status)) ? Number(result.status) : 0,
        message
      } : null;
    }
    records[index] = normalizeRecord(next);
    return records[index];
  });
}

export async function removeProviderKeyRecord(provider, id) {
  assertProvider(provider);
  return mutateProviderRecords(provider, records => {
    const next = records.filter(record => record.id !== id);
    if (next.length === records.length) return false;
    records.splice(0, records.length, ...next);
    return true;
  });
}

export async function moveProviderKeyRecord(provider, id, direction) {
  assertProvider(provider);
  return mutateProviderRecords(provider, records => {
    const index = records.findIndex(record => record.id === id);
    const nextIndex = index + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0);
    if (index < 0 || nextIndex < 0 || nextIndex >= records.length) return records;
    [records[index], records[nextIndex]] = [records[nextIndex], records[index]];
    return records;
  });
}

export function maskApiKey(secret) {
  const value = typeof secret === 'string' ? secret : '';
  return value ? `••••••••${value.length > 4 ? value.slice(-4) : ''}` : 'No key';
}

export function getEnabledKeys(records) {
  return (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter(record => record?.enabled)
    .map(record => record.secret);
}
