import { updateProviderApiKey } from '../core/storage.js';
import { validateProviderApiKey } from '../core/api-key-validation.js';

export async function testProviderApiKeyRecord(provider, record) {
  const result = await validateProviderApiKey(provider, record.secret);
  let persistenceError = null;
  try {
    await updateProviderApiKey(provider, record.id, {
      lastTest: { at: Date.now(), ok: result.ok, status: result.status, message: result.message }
    });
  } catch (error) {
    persistenceError = error;
  }
  return { result, persistenceError };
}
