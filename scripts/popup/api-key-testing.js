import { saveProviderApiKeyTestResult } from '../core/storage.js';
import { validateProviderApiKey } from '../core/api-key-validation.js';

export async function testProviderApiKeyRecord(provider, record) {
  const result = await validateProviderApiKey(provider, record.secret);
  let persistenceError = null;
  let stale = false;
  try {
    const saved = await saveProviderApiKeyTestResult(provider, record.id, record.secret, {
      at: Date.now(), ok: result.ok, status: result.status, message: result.message
    });
    stale = !saved;
  } catch (error) {
    persistenceError = error;
  }
  return { result, persistenceError, stale };
}
