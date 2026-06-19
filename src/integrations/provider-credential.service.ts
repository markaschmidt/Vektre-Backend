import { Injectable } from '@nestjs/common';
import { AppDataService } from './app-data.service.js';
import { IntegrationCryptoService } from './integration-crypto.service.js';

export interface ProviderCredentialTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Encrypted read/write for OAuth tokens in `provider_credential`.
 * Used by Google Drive, Notion, and future integrations.
 */
@Injectable()
export class ProviderCredentialService {
  constructor(
    private readonly appData: AppDataService,
    private readonly crypto: IntegrationCryptoService,
  ) {}

  async save(row: {
    userId: string;
    provider: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }): Promise<void> {
    await this.appData.upsertProviderCredential({
      userId: row.userId,
      provider: row.provider,
      accessToken: this.crypto.encrypt(row.accessToken),
      refreshToken: this.crypto.encryptOptional(row.refreshToken) ?? undefined,
      expiresAt: row.expiresAt,
    });
  }

  async get(
    userId: string,
    provider: string,
  ): Promise<ProviderCredentialTokens | null> {
    const row = await this.appData.getProviderCredential(userId, provider);
    if (!row?.accessToken) return null;

    return {
      accessToken: this.crypto.decrypt(row.accessToken),
      refreshToken: this.crypto.decryptOptional(row.refreshToken),
      expiresAt: row.expiresAt,
    };
  }
}
