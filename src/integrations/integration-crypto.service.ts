import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IntegrationCryptoConfig } from '../config/integration-crypto.config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
export const ENCRYPTED_SECRET_PREFIX = 'enc:v1:';

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_SECRET_PREFIX);
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_SECRET_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

/** Plaintext legacy values are returned unchanged. */
export function decryptSecret(key: Buffer, stored: string): string {
  if (!isEncryptedSecret(stored)) {
    return stored;
  }

  const payload = stored.slice(ENCRYPTED_SECRET_PREFIX.length);
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Invalid encrypted integration secret format');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(dataPart, 'base64url');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Encrypts/decrypts integration secrets (OAuth tokens) before Postgres storage.
 */
@Injectable()
export class IntegrationCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = config.get<IntegrationCryptoConfig>('integrationCrypto')!.secretsKey;
  }

  isEncrypted(value: string): boolean {
    return isEncryptedSecret(value);
  }

  encrypt(plaintext: string): string {
    return encryptSecret(this.key, plaintext);
  }

  decrypt(stored: string): string {
    return decryptSecret(this.key, stored);
  }

  encryptOptional(value?: string): string | null {
    if (value == null || value === '') return null;
    return this.encrypt(value);
  }

  decryptOptional(value?: string | null): string | undefined {
    if (value == null || value === '') return undefined;
    return this.decrypt(value);
  }
}
