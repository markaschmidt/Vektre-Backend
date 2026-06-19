import { Injectable } from '@nestjs/common';
import { ProviderCredentialService } from '../provider-credential.service.js';
import { SupabaseService } from '../supabase.js';

export interface GoogleProviderTokenMeta {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Resolves Google OAuth tokens for server-side Drive API calls.
 *
 * Supabase returns provider_token in the browser session after OAuth but does
 * not persist it in auth identities. Callers must POST tokens to
 * /integrations/google-drive/connect after sign-in so the backend can store them.
 */
@Injectable()
export class GoogleDriveTokenService {
  constructor(
    private readonly credentials: ProviderCredentialService,
    private readonly supabase: SupabaseService,
  ) {}

  async getTokenMeta(userId: string): Promise<GoogleProviderTokenMeta | null> {
    const stored = await this.credentials.get(userId, 'google');
    if (stored?.accessToken) return stored;

    return this.supabase.getProviderTokenWithMeta(userId, 'google');
  }

  async saveTokens(
    userId: string,
    tokens: GoogleProviderTokenMeta,
  ): Promise<void> {
    await this.credentials.save({
      userId,
      provider: 'google',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : undefined,
    });
  }
}
