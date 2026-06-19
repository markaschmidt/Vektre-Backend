import { registerAs } from '@nestjs/config';
import { createHash } from 'node:crypto';

export interface IntegrationCryptoConfig {
  /** 32-byte AES-256 key. */
  secretsKey: Buffer;
}

const KEY_ENV = 'INTEGRATION_SECRETS_KEY';

function decodeSecretsKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${KEY_ENV} is empty`);
  }

  let key = Buffer.from(trimmed, 'base64');
  if (key.length === 32) return key;

  key = Buffer.from(trimmed, 'base64url');
  if (key.length === 32) return key;

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, 'hex');
    if (key.length === 32) return key;
  }

  throw new Error(
    `${KEY_ENV} must decode to 32 bytes (use \`openssl rand -base64 32\`).`,
  );
}

/**
 * Application-level encryption for integration OAuth tokens at rest.
 * Registered under the `integrationCrypto` namespace.
 */
export const integrationCryptoConfig = registerAs(
  'integrationCrypto',
  (): IntegrationCryptoConfig => {
    const raw = process.env[KEY_ENV];
    if (!raw) {
      throw new Error(
        `Missing required environment variable: ${KEY_ENV}. ` +
          'Generate with: openssl rand -base64 32',
      );
    }

    return { secretsKey: decodeSecretsKey(raw) };
  },
);

/** Stable fingerprint for logs (never log the raw key). */
export function secretsKeyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}
