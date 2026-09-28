
import {
  addProviderKeyRecord,
  getEnabledKeys,
  hasImportedLocalConfigKeys,
  importLocalConfigProviderKeys,
  migrateLegacyProviderKey,
  moveProviderKeyRecord,
  readProviderKeyRecords,
  removeProviderKeyRecord,
  updateProviderKeyRecord
} from './api-key-manager.js';

const API_KEY_KEYS = {
  openai: 'openaiApiKey',
  gemini: 'geminiApiKey',
  openrouter: 'openrouterApiKey'
};
let localApiKeysPromise;
const apiKeyCache = new Map();
const API_KEY_CACHE_TTL_MS = 5000;
let cacheStorageArea = null;
let apiKeyCacheRevision = 0;

function clearApiKeyCache() {
  apiKeyCacheRevision += 1;
  apiKeyCache.clear();
}

globalThis.chrome?.storage?.onChanged?.addListener?.((changes, areaName) => {
  const relevantChange = areaName === 'local'
    ? Object.hasOwn(changes, 'uwuKahootApiKeyManagerV1') || Object.values(API_KEY_KEYS).some(key => Object.hasOwn(changes, key))
    : areaName === 'sync' && Object.hasOwn(changes, 'openaiApiKey');
  if (relevantChange) clearApiKeyCache();
});

export async function migrateApiKeyToLocal() {
  const [local, sync] = await Promise.all([
    chrome.storage.local.get(['openaiApiKey']),
    chrome.storage.sync.get(['openaiApiKey'])
  ]);

  const localKey = (local.openaiApiKey || '').trim();
  const syncKey = (sync.openaiApiKey || '').trim();

  if (localKey) {
    if (syncKey) await chrome.storage.sync.remove(['openaiApiKey']);
    return localKey;
  }

  if (syncKey) {
    await chrome.storage.local.set({ openaiApiKey: syncKey });
    await chrome.storage.sync.remove(['openaiApiKey']);
    return syncKey;
  }

  return '';
}

export async function getLocalConfiguredApiKeys(provider = 'openai') {
  try {
    localApiKeysPromise ||= fetch(chrome.runtime.getURL('scripts/core/local-secrets.json'))
      .then(response => response.ok ? response.json() : {})
      .catch(() => ({}));
    const localApiKeys = await localApiKeysPromise;
    const values = localApiKeys[provider];
    return [...new Set((Array.isArray(values) ? values : [values])
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean))];
  } catch (_) {
    return [];
  }
}

export async function getApiKeys(provider = 'openai') {
  const normalizedProvider = API_KEY_KEYS[provider] ? provider : 'openai';
  const storageArea = chrome.storage.local;
  if (cacheStorageArea !== storageArea) {
    cacheStorageArea = storageArea;
    apiKeyCache.clear();
  }
  const cached = apiKeyCache.get(normalizedProvider);
  if (cached && Date.now() - cached.cachedAt < API_KEY_CACHE_TTL_MS) return [...cached.keys];

  const revisionAtRead = apiKeyCacheRevision;
  const entries = await getProviderApiKeyEntries(normalizedProvider);
  const localKeys = await getProviderConfigApiKeys(normalizedProvider);
  const keys = [...new Set([...getEnabledKeys(entries), ...localKeys]
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean))];
  if (revisionAtRead === apiKeyCacheRevision && cacheStorageArea === storageArea) {
    apiKeyCache.set(normalizedProvider, { keys, cachedAt: Date.now() });
  }
  return [...keys];
}

async function prepareProviderApiKeys(provider) {
  const keyName = API_KEY_KEYS[provider] ? provider : 'openai';
  if (keyName === 'openai') await migrateApiKeyToLocal();
  await migrateLegacyProviderKey(keyName);
  return keyName;
}

export async function getProviderApiKeyEntries(provider = 'openai') {
  const normalizedProvider = await prepareProviderApiKeys(provider);
  const records = await readProviderKeyRecords(normalizedProvider);
  if (await hasImportedLocalConfigKeys(normalizedProvider)) return records;
  const localKeys = await getLocalConfiguredApiKeys(normalizedProvider);
  return localKeys.length
    ? importLocalConfigProviderKeys(normalizedProvider, localKeys)
    : records;
}

export async function getProviderConfigApiKeys(provider = 'openai') {
  const normalizedProvider = API_KEY_KEYS[provider] ? provider : 'openai';
  if (await hasImportedLocalConfigKeys(normalizedProvider)) return [];
  return getLocalConfiguredApiKeys(normalizedProvider);
}

export async function addProviderApiKey(provider, entry) {
  const normalizedProvider = await prepareProviderApiKeys(provider);
  return addProviderKeyRecord(normalizedProvider, entry);
}

export async function updateProviderApiKey(provider, id, changes) {
  const normalizedProvider = await prepareProviderApiKeys(provider);
  return updateProviderKeyRecord(normalizedProvider, id, changes);
}

export async function removeProviderApiKey(provider, id) {
  const normalizedProvider = await prepareProviderApiKeys(provider);
  return removeProviderKeyRecord(normalizedProvider, id);
}

export async function moveProviderApiKey(provider, id, direction) {
  const normalizedProvider = await prepareProviderApiKeys(provider);
  return moveProviderKeyRecord(normalizedProvider, id, direction);
}

export async function getApiKey(provider = 'openai') {
  return (await getApiKeys(provider))[0] || '';
}
