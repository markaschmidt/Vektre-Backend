import { randomBytes } from 'node:crypto';
import {
  decryptSecret,
  encryptSecret,
  ENCRYPTED_SECRET_PREFIX,
  isEncryptedSecret,
} from './integration-crypto.service.js';

describe('integration secret crypto', () => {
  const key = randomBytes(32);

  it('round-trips plaintext through encrypt/decrypt', () => {
    const token = 'ya29.a0AfB_by_example_google_access_token';
    const stored = encryptSecret(key, token);
    expect(stored.startsWith(ENCRYPTED_SECRET_PREFIX)).toBe(true);
    expect(decryptSecret(key, stored)).toBe(token);
  });

  it('returns legacy plaintext values unchanged', () => {
    const legacy = 'plain-unencrypted-token';
    expect(isEncryptedSecret(legacy)).toBe(false);
    expect(decryptSecret(key, legacy)).toBe(legacy);
  });

  it('produces distinct ciphertext for the same plaintext', () => {
    const token = 'same-token';
    expect(encryptSecret(key, token)).not.toBe(encryptSecret(key, token));
  });

  it('rejects malformed encrypted payloads', () => {
    expect(() => decryptSecret(key, 'enc:v1:incomplete')).toThrow();
  });

  it('rejects decryption with the wrong key', () => {
    const stored = encryptSecret(key, 'secret');
    expect(() => decryptSecret(randomBytes(32), stored)).toThrow();
  });
});
