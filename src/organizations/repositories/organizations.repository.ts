import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../integrations/supabase.js';
import type {
  OrganizationMemberRow,
  OrganizationProvider,
  OrganizationProviderCredentialRow,
  OrganizationRole,
  OrganizationRow,
} from '../../integrations/app-data.types.js';

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private db() {
    return this.supabase.getAdminClient();
  }

  async createOrganization(input: {
    organizationId: string;
    name: string;
    slug: string;
    createdBy: string;
    logoUrl?: string | null;
    logoWidth?: number | null;
    logoHeight?: number | null;
  }): Promise<OrganizationRow> {
    const now = new Date().toISOString();
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('organization')
        .insert({
          organization_id: input.organizationId,
          name: input.name,
          slug: input.slug,
          created_by: input.createdBy,
          logo_url: input.logoUrl ?? null,
          logo_width: input.logoWidth ?? null,
          logo_height: input.logoHeight ?? null,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single(),
    );
    assertNoError('createOrganization', error);
    return mapOrganization(data);
  }

  async updateOrganization(
    organizationId: string,
    patch: {
      name?: string;
      logoUrl?: string | null;
      logoWidth?: number | null;
      logoHeight?: number | null;
    },
  ): Promise<OrganizationRow> {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.logoUrl !== undefined) update.logo_url = patch.logoUrl;
    if (patch.logoWidth !== undefined) update.logo_width = patch.logoWidth;
    if (patch.logoHeight !== undefined) update.logo_height = patch.logoHeight;

    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('organization')
        .update(update)
        .eq('organization_id', organizationId)
        .select('*')
        .single(),
    );
    assertNoError('updateOrganization', error);
    return mapOrganization(data);
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('organization')
        .delete()
        .eq('organization_id', organizationId),
    );
    assertNoError('deleteOrganization', error);
  }

  async getOrganization(
    organizationId: string,
  ): Promise<OrganizationRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('organization')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle(),
    );
    assertNoError('getOrganization', error);
    return data ? mapOrganization(data) : null;
  }

  async getOrganizationsByIds(
    organizationIds: string[],
  ): Promise<Map<string, OrganizationRow>> {
    const ids = [...new Set(organizationIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('organization')
        .select('*')
        .in('organization_id', ids),
    );
    assertNoError('getOrganizationsByIds', error);
    return new Map(
      (data ?? []).map((row) => {
        const organization = mapOrganization(row);
        return [organization.organizationId, organization];
      }),
    );
  }

  async getMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMemberRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('organization_member')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .maybeSingle(),
    );
    assertNoError('getOrganizationMembership', error);
    return data ? mapMember(data) : null;
  }

  async listMembershipsForUser(
    userId: string,
  ): Promise<OrganizationMemberRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('organization_member')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active'),
    );
    assertNoError('listMembershipsForUser', error);
    return (data ?? []).map(mapMember);
  }

  async listMembers(organizationId: string): Promise<OrganizationMemberRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('organization_member')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('created_at', { ascending: true }),
    );
    assertNoError('listOrganizationMembers', error);
    return (data ?? []).map(mapMember);
  }

  async upsertMember(input: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    addedByUserId: string;
  }): Promise<OrganizationMemberRow> {
    const existing = await this.getMembership(
      input.organizationId,
      input.userId,
    );
    const now = new Date().toISOString();
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('organization_member')
        .upsert({
          organization_id: input.organizationId,
          user_id: input.userId,
          role: input.role,
          status: 'active',
          added_by_user_id: input.addedByUserId,
          created_at: existing?.createdAt.toISOString() ?? now,
          updated_at: now,
        })
        .select('*')
        .single(),
    );
    assertNoError('upsertOrganizationMember', error);
    return mapMember(data);
  }

  async removeMember(organizationId: string, userId: string): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('organization_member')
        .update({ status: 'removed', updated_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('user_id', userId),
    );
    assertNoError('removeOrganizationMember', error);
  }

  async countActiveExecutives(organizationId: string): Promise<number> {
    const { count, error } = queryResult<null>(
      await this.db()
        .from('organization_member')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('role', 'executive')
        .eq('status', 'active'),
    );
    assertNoError('countActiveExecutives', error);
    return count ?? 0;
  }

  async upsertProviderCredential(input: {
    organizationId: string;
    provider: OrganizationProvider;
    encryptedPayload: string;
    status: OrganizationProviderCredentialRow['status'];
    metadata: Record<string, unknown>;
    updatedBy: string;
  }): Promise<OrganizationProviderCredentialRow> {
    const existing = await this.getProviderCredential(
      input.organizationId,
      input.provider,
    );
    const now = new Date().toISOString();
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('organization_provider_credential')
        .upsert({
          organization_id: input.organizationId,
          provider: input.provider,
          encrypted_payload: input.encryptedPayload,
          status: input.status,
          metadata_json: input.metadata,
          updated_by: input.updatedBy,
          created_at: existing?.createdAt.toISOString() ?? now,
          updated_at: now,
        })
        .select('*')
        .single(),
    );
    assertNoError('upsertOrganizationProviderCredential', error);
    return mapProviderCredential(data);
  }

  async getProviderCredential(
    organizationId: string,
    provider: OrganizationProvider,
  ): Promise<OrganizationProviderCredentialRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('organization_provider_credential')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('provider', provider)
        .maybeSingle(),
    );
    assertNoError('getOrganizationProviderCredential', error);
    return data ? mapProviderCredential(data) : null;
  }

  async listProviderCredentials(
    organizationId: string,
  ): Promise<OrganizationProviderCredentialRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('organization_provider_credential')
        .select('*')
        .eq('organization_id', organizationId)
        .neq('status', 'disconnected'),
    );
    assertNoError('listOrganizationProviderCredentials', error);
    return (data ?? []).map(mapProviderCredential);
  }

  async disconnectProvider(
    organizationId: string,
    provider: OrganizationProvider,
    updatedBy: string,
  ): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('organization_provider_credential')
        .update({
          status: 'disconnected',
          encrypted_payload: '',
          metadata_json: {},
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', organizationId)
        .eq('provider', provider),
    );
    assertNoError('disconnectOrganizationProvider', error);
  }

  async updateProviderStatus(
    organizationId: string,
    provider: OrganizationProvider,
    status: OrganizationProviderCredentialRow['status'],
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (metadata !== undefined) update.metadata_json = metadata;
    const { error } = queryResult<null>(
      await this.db()
        .from('organization_provider_credential')
        .update(update)
        .eq('organization_id', organizationId)
        .eq('provider', provider),
    );
    assertNoError('updateOrganizationProviderStatus', error);
  }

  async getUserStorageUsageBytes(userId: string): Promise<number> {
    const { data, error } = queryResult<unknown>(
      await this.db().rpc('user_storage_usage_bytes', {
        p_user_id: userId,
      }),
    );
    assertNoError('getUserStorageUsageBytes', error);
    return Number(data ?? 0);
  }

  async getOrganizationStorageUsageBytes(
    organizationId: string,
  ): Promise<number> {
    const { data, error } = queryResult<unknown>(
      await this.db().rpc('organization_storage_usage_bytes', {
        p_organization_id: organizationId,
      }),
    );
    assertNoError('getOrganizationStorageUsageBytes', error);
    return Number(data ?? 0);
  }
}

function mapOrganization(row: Record<string, unknown>): OrganizationRow {
  return {
    organizationId: row.organization_id as string,
    name: row.name as string,
    slug: row.slug as string,
    createdBy: row.created_by as string,
    logoUrl: (row.logo_url as string | null | undefined) ?? null,
    logoWidth:
      row.logo_width == null ? null : Number(row.logo_width),
    logoHeight:
      row.logo_height == null ? null : Number(row.logo_height),
    storageQuotaOverrideBytes:
      row.storage_quota_override_bytes == null
        ? null
        : Number(row.storage_quota_override_bytes),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapMember(row: Record<string, unknown>): OrganizationMemberRow {
  return {
    organizationId: row.organization_id as string,
    userId: row.user_id as string,
    role: row.role as OrganizationRole,
    status: row.status as OrganizationMemberRow['status'],
    addedByUserId: row.added_by_user_id as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapProviderCredential(
  row: Record<string, unknown>,
): OrganizationProviderCredentialRow {
  return {
    organizationId: row.organization_id as string,
    provider: row.provider as OrganizationProvider,
    encryptedPayload: row.encrypted_payload as string,
    status: row.status as OrganizationProviderCredentialRow['status'],
    metadata: (row.metadata_json as Record<string, unknown> | null) ?? {},
    updatedBy: row.updated_by as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function assertNoError(
  operation: string,
  error: { message: string } | null,
): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

function queryResult<T>(value: unknown): {
  data: T;
  error: { message: string } | null;
  count: number | null;
} {
  return value as {
    data: T;
    error: { message: string } | null;
    count: number | null;
  };
}
