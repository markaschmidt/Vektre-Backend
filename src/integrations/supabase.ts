import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly client: SupabaseClient;

  constructor() {
    // Accept either SUPABASE_URL (backend-canonical) or the Vite-prefixed
    // alias present in the shared root .env so the container works without
    // duplicating the value.
    const url =
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const missing: string[] = [];
    if (!url) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)');
    if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

    if (missing.length > 0) {
      throw new Error(
        `Missing required Supabase environment variables: ${missing.join(', ')}. ` +
        'Get SUPABASE_SERVICE_ROLE_KEY from the Supabase dashboard → Settings → API.',
      );
    }

    this.client = createClient(url!, serviceKey!, {
      auth: { persistSession: false },
    });
  }

  /**
   * Validate a Supabase JWT and return a typed AuthenticatedUser.
   * Only called from the auth guard; never expose raw token details to callers.
   */
  async verifyToken(token: string): Promise<AuthenticatedUser> {
    const { data, error } = await this.client.auth.getUser(token);

    if (error || !data.user) {
      this.logger.warn(`Token verification failed: ${error?.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.toAuthenticatedUser(data.user);
  }

  /**
   * Retrieve a user by their Supabase ID, used by server-side admin tasks.
   */
  async getUserById(userId: string): Promise<AuthenticatedUser | null> {
    const { data, error } =
      await this.client.auth.admin.getUserById(userId);

    if (error || !data.user) {
      this.logger.warn(`Failed to fetch user ${userId}: ${error?.message}`);
      return null;
    }

    return this.toAuthenticatedUser(data.user);
  }

  /**
   * Retrieve a stored OAuth provider token for a user (e.g. Google Drive).
   * Returns null when no token is stored for that provider.
   */
  async getProviderToken(
    userId: string,
    provider: string,
  ): Promise<string | null> {
    const { data, error } =
      await this.client.auth.admin.getUserById(userId);

    if (error || !data.user) return null;

    const identity = data.user.identities?.find(
      (id) => id.provider === provider,
    );

    return (identity?.identity_data?.['provider_token'] as string) ?? null;
  }

  /**
   * Return the stored OAuth provider token for a user with additional
   * metadata (refresh token, expiry) when available.
   * Google Drive uses 'google', Notion stores its own token via a separate
   * secure store; this covers Supabase-managed OAuth identity tokens only.
   */
  async getProviderTokenWithMeta(
    userId: string,
    provider: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  } | null> {
    const { data, error } = await this.client.auth.admin.getUserById(userId);

    if (error || !data.user) return null;

    const identity = data.user.identities?.find(
      (id) => id.provider === provider,
    );
    if (!identity?.identity_data) return null;

    const d = identity.identity_data as Record<string, unknown>;
    const accessToken = d['provider_token'] as string | undefined;
    if (!accessToken) return null;

    return {
      accessToken,
      refreshToken: (d['provider_refresh_token'] as string) ?? undefined,
      expiresAt: (d['provider_token_expiry'] as number) ?? undefined,
    };
  }

  /**
   * Look up a Supabase auth user ID by their email address.
   * Uses a SECURITY DEFINER Postgres function so the service role can
   * query auth.users without exposing the schema directly.
   * Returns null when no user with that email exists.
   */
  async getUserIdByEmail(email: string): Promise<string | null> {
    const { data, error } = await this.client.rpc('find_user_id_by_email', {
      lookup_email: email.trim().toLowerCase(),
    });
    if (error) {
      this.logger.warn(`getUserIdByEmail failed for ${email}: ${error.message}`);
      return null;
    }
    return (data as string | null) ?? null;
  }

  /**
   * Resolve auth emails for a set of user IDs (e.g. project member directory).
   */
  async getUserEmailsByIds(userIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    const emails = new Map<string, string>();

    await Promise.all(
      uniqueIds.map(async (userId) => {
        const user = await this.getUserById(userId);
        if (user?.email) {
          emails.set(userId, user.email);
        }
      }),
    );

    return emails;
  }

  /**
   * Service-role Supabase client for Postgres and Storage orchestration.
   * Never expose this client or the service-role key to HTTP callers.
   */
  getAdminClient(): SupabaseClient {
    return this.client;
  }

  getStorageBucket(): string {
    return process.env.SUPABASE_STORAGE_BUCKET ?? 'project-assets';
  }

  async uploadObject(
    objectPath: string,
    data: Buffer | Uint8Array,
    contentType?: string,
    bucket = this.getStorageBucket(),
  ): Promise<void> {
    const { error } = await this.client.storage.from(bucket).upload(objectPath, data, {
      contentType: contentType ?? 'application/octet-stream',
      upsert: true,
    });
    if (error) {
      throw new Error(`Supabase storage upload failed (${objectPath}): ${error.message}`);
    }
  }

  async downloadObject(
    objectPath: string,
    bucket = this.getStorageBucket(),
  ): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(bucket).download(objectPath);
    if (error || !data) {
      throw new Error(
        `Supabase storage download failed (${objectPath}): ${error?.message ?? 'empty response'}`,
      );
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async deleteObject(
    objectPath: string,
    bucket = this.getStorageBucket(),
  ): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([objectPath]);
    if (error) {
      throw new Error(`Supabase storage delete failed (${objectPath}): ${error.message}`);
    }
  }

  async listObjectPaths(
    prefix: string,
    bucket = this.getStorageBucket(),
  ): Promise<string[]> {
    const { data, error } = await this.client.storage.from(bucket).list(prefix);
    if (error) {
      throw new Error(`Supabase storage list failed (${prefix}): ${error.message}`);
    }
    if (!data?.length) return [];
    return data
      .filter((entry) => entry.name && !entry.id?.endsWith('/'))
      .map((entry) => `${prefix.replace(/\/$/, '')}/${entry.name}`);
  }

  async deleteObjectsWithPrefix(
    prefix: string,
    bucket = this.getStorageBucket(),
  ): Promise<void> {
    const paths = await this.listObjectPaths(prefix, bucket);
    if (paths.length === 0) return;
    const { error } = await this.client.storage.from(bucket).remove(paths);
    if (error) {
      throw new Error(`Supabase storage bulk delete failed (${prefix}): ${error.message}`);
    }
  }

  private toAuthenticatedUser(user: User): AuthenticatedUser {
    const meta = user.user_metadata ?? {};
    return {
      id: user.id,
      email: user.email ?? undefined,
      role: (meta['role'] as string) ?? (user.role ?? undefined),
      claims: { ...meta, sub: user.id, iss: 'supabase' },
    };
  }
}
