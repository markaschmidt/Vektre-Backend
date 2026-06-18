import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

export interface CollabAuthenticatedUser {
  id: string;
  email?: string;
  displayName?: string;
}

let adminClient: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Supabase credentials are required for the collaboration server');
  }

  adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  return adminClient;
}

export async function verifyCollabToken(token: string): Promise<CollabAuthenticatedUser> {
  if (!token?.trim()) {
    throw new Error('Missing collaboration token');
  }

  const { data, error } = await getAdminClient().auth.getUser(token);
  if (error || !data.user) {
    throw new Error(error?.message ?? 'Invalid or expired collaboration token');
  }

  return toCollabUser(data.user);
}

function toCollabUser(user: User): CollabAuthenticatedUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? undefined,
    displayName:
      (meta['full_name'] as string | undefined) ??
      (meta['name'] as string | undefined) ??
      (user.email ? user.email.split('@')[0] : undefined),
  };
}
