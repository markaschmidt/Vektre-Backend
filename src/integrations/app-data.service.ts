import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './supabase.js';
import type {
  ProjectAssetRow,
  ProjectAssetStatus,
  ProjectMemberRole,
  ProjectMemberRow,
  ProjectRow,
  ProjectStatus,
  ProjectWorkspaceMode,
  RequestStatus,
  RequestStatusRow,
  ShareLinkRole,
  ShareLinkRow,
  UserProfileRow,
  ProjectInviteRow,
  InviteType,
  InviteStatus,
} from './app-data.types.js';

@Injectable()
export class AppDataService {
  private readonly logger = new Logger(AppDataService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ─── Request Status ──────────────────────────────────────────────────────

  async createRequestStatus(
    row: Omit<RequestStatusRow, 'createdAt' | 'updatedAt'>,
  ): Promise<void> {
    this.logger.debug(`createRequestStatus: ${row.requestId} (${row.type})`);
    const now = new Date().toISOString();
    const { error } = await this.db()
      .from('request_status')
      .upsert({
        request_id: row.requestId,
        user_id: row.userId,
        type: row.type,
        status: row.status,
        error_message: row.errorMessage ?? null,
        output_ref: row.outputRef ?? null,
        result_json: row.resultJson ?? null,
        created_at: now,
        updated_at: now,
      });
    throwOnError('createRequestStatus', error);
  }

  async updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    extras?: Pick<RequestStatusRow, 'errorMessage' | 'outputRef' | 'resultJson'>,
  ): Promise<void> {
    this.logger.debug(`updateRequestStatus: ${requestId} → ${status}`);
    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (extras?.errorMessage !== undefined) patch.error_message = extras.errorMessage;
    if (extras?.outputRef !== undefined) patch.output_ref = extras.outputRef;
    if (extras?.resultJson !== undefined) patch.result_json = extras.resultJson;

    const { error } = await this.db()
      .from('request_status')
      .update(patch)
      .eq('request_id', requestId);
    throwOnError('updateRequestStatus', error);
  }

  async getRequestStatus(requestId: string): Promise<RequestStatusRow | null> {
    this.logger.debug(`getRequestStatus: ${requestId}`);
    const { data, error } = await this.db()
      .from('request_status')
      .select('*')
      .eq('request_id', requestId)
      .maybeSingle();
    throwOnError('getRequestStatus', error);
    return data ? mapRequestStatusRow(data) : null;
  }

  async waitForRequestStatus(
    requestId: string,
    opts: { timeoutMs?: number; terminalOnly?: boolean } = {},
  ): Promise<RequestStatusRow | null> {
    const { timeoutMs = 25_000, terminalOnly = true } = opts;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const row = await this.getRequestStatus(requestId);
      if (row && (!terminalOnly || isTerminalStatus(row.status))) {
        return row;
      }
      await sleep(500);
    }

    return this.getRequestStatus(requestId);
  }

  // ─── User Profile ─────────────────────────────────────────────────────────

  async upsertUserProfile(profile: UserProfileRow): Promise<void> {
    this.logger.debug(`upsertUserProfile: ${profile.userId}`);
    const existing = await this.getUserProfile(profile.userId);
    const now = (profile.updatedAt ?? new Date()).toISOString();
    const preferences = { ...profile.preferences };
    if (profile.plan && !preferences.selectedPlan) {
      preferences.selectedPlan = profile.plan;
    }

    const legacyRow: Record<string, unknown> = {
      user_id: profile.userId,
      display_name: profile.displayName ?? null,
      avatar_url: profile.avatarUrl ?? null,
      preferences_json: preferences,
      updated_at: now,
    };

    const extendedRow: Record<string, unknown> = {
      ...legacyRow,
      plan: profile.plan ?? null,
      organization_id: profile.organizationId ?? null,
      storage_id: profile.storageId ?? null,
      on_demand_json: profile.onDemand ?? { monthlyCap: null },
    };
    if (!existing) {
      extendedRow.created_at = (profile.createdAt ?? new Date()).toISOString();
    }

    const { error } = await this.db().from('user_profile').upsert(extendedRow);
    if (!error) return;

    if (isMissingExtendedUserProfileColumns(error)) {
      this.logger.warn(
        'user_profile extended columns missing — upserting legacy shape. ' +
          'Apply supabase/migrations/004_user_profile_extended.sql in Supabase.',
      );
      const { error: legacyError } = await this.db().from('user_profile').upsert(legacyRow);
      throwOnError('upsertUserProfile', legacyError);
      return;
    }

    throwOnError('upsertUserProfile', error);
  }

  async getUserProfile(userId: string): Promise<UserProfileRow | null> {
    this.logger.debug(`getUserProfile: ${userId}`);
    const { data, error } = await this.db()
      .from('user_profile')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    throwOnError('getUserProfile', error);
    return data ? mapUserProfileRow(data) : null;
  }

  async getUserProfilesByIds(userIds: string[]): Promise<Map<string, UserProfileRow>> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    this.logger.debug(`getUserProfilesByIds: ${uniqueIds.length} users`);
    const { data, error } = await this.db()
      .from('user_profile')
      .select('*')
      .in('user_id', uniqueIds);
    throwOnError('getUserProfilesByIds', error);

    const profiles = new Map<string, UserProfileRow>();
    for (const row of data ?? []) {
      profiles.set(row.user_id as string, mapUserProfileRow(row));
    }
    return profiles;
  }

  async updateUserPreferences(
    userId: string,
    preferences: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug(`updateUserPreferences: ${userId}`);
    const existing = await this.getUserProfile(userId);
    await this.upsertUserProfile({
      userId,
      displayName: existing?.displayName,
      avatarUrl: existing?.avatarUrl,
      plan: existing?.plan ?? null,
      preferences,
      organizationId: existing?.organizationId ?? null,
      storageId: existing?.storageId ?? null,
      onDemand: existing?.onDemand ?? { monthlyCap: null },
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    });
  }

  // ─── Projects ─────────────────────────────────────────────────────────────

  async createProject(row: {
    projectId: string;
    ownerUserId: string;
    name: string;
    description?: string | null;
    workspaceMode: ProjectWorkspaceMode;
    iconAssetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProjectRow> {
    this.logger.debug(`createProject: ${row.projectId}`);
    const now = new Date().toISOString();
    const { error: projectError } = await this.db().from('project').insert({
      project_id: row.projectId,
      owner_user_id: row.ownerUserId,
      name: row.name.trim(),
      description: row.description ?? null,
      workspace_mode: row.workspaceMode,
      status: 'active',
      icon_asset_id: row.iconAssetId ?? null,
      metadata_json: row.metadata ?? null,
      created_at: now,
      updated_at: now,
    });
    throwOnError('createProject', projectError);

    const { error: memberError } = await this.db().from('project_member').upsert({
      membership_id: membershipId(row.projectId, row.ownerUserId),
      project_id: row.projectId,
      user_id: row.ownerUserId,
      role: 'owner',
      status: 'active',
      added_by_user_id: row.ownerUserId,
      created_at: now,
      updated_at: now,
    });
    throwOnError('createProject.member', memberError);

    return {
      projectId: row.projectId,
      ownerUserId: row.ownerUserId,
      name: row.name.trim(),
      description: row.description,
      workspaceMode: row.workspaceMode,
      status: 'active',
      iconAssetId: row.iconAssetId,
      metadata: row.metadata,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  async updateProject(
    projectId: string,
    patch: {
      name?: string;
      description?: string | null;
      workspaceMode?: ProjectWorkspaceMode;
      iconAssetId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ProjectRow | null> {
    this.logger.debug(`updateProject: ${projectId}`);
    const existing = await this.getProjectById(projectId);
    if (!existing || existing.status === 'deleted') return null;

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.name !== undefined) update.name = patch.name.trim();
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.workspaceMode !== undefined) update.workspace_mode = patch.workspaceMode;
    if (patch.iconAssetId !== undefined) update.icon_asset_id = patch.iconAssetId;
    if (patch.metadata !== undefined) {
      update.metadata_json = { ...(existing.metadata ?? {}), ...patch.metadata };
    }

    const { data, error } = await this.db()
      .from('project')
      .update(update)
      .eq('project_id', projectId)
      .select('*')
      .maybeSingle();
    throwOnError('updateProject', error);
    return data ? mapProjectRow(data) : null;
  }

  async setProjectStatus(
    projectId: string,
    status: Extract<ProjectStatus, 'archived' | 'deleted'>,
  ): Promise<ProjectRow | null> {
    this.logger.debug(`setProjectStatus: ${projectId} -> ${status}`);
    const existing = await this.getProjectById(projectId);
    if (!existing || existing.status === 'deleted') return null;

    const { data, error } = await this.db()
      .from('project')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .select('*')
      .maybeSingle();
    throwOnError('setProjectStatus', error);
    return data ? mapProjectRow(data) : null;
  }

  async listProjectsForUser(userId: string): Promise<ProjectRow[]> {
    this.logger.debug(`listProjectsForUser: ${userId}`);
    const { data: members, error: memberError } = await this.db()
      .from('project_member')
      .select('project_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    throwOnError('listProjectsForUser.members', memberError);

    const memberProjectIds = [...new Set((members ?? []).map((m) => m.project_id as string))];
    const queries = [
      this.db().from('project').select('*').eq('owner_user_id', userId).neq('status', 'deleted'),
    ];
    if (memberProjectIds.length > 0) {
      queries.push(
        this.db()
          .from('project')
          .select('*')
          .in('project_id', memberProjectIds)
          .neq('status', 'deleted'),
      );
    }

    const results = await Promise.all(queries);
    for (const result of results) throwOnError('listProjectsForUser.projects', result.error);

    const byId = new Map<string, ProjectRow>();
    for (const result of results) {
      for (const row of result.data ?? []) {
        byId.set(row.project_id as string, mapProjectRow(row));
      }
    }
    return [...byId.values()];
  }

  async getProjectForUser(
    userId: string,
    projectId: string,
  ): Promise<ProjectRow | null> {
    this.logger.debug(`getProjectForUser: ${userId} / ${projectId}`);
    const project = await this.getProjectById(projectId);
    if (!project || project.status === 'deleted') return null;
    if (project.ownerUserId === userId) return project;

    const member = await this.getProjectMembership(projectId, userId);
    return member?.status === 'active' ? project : null;
  }

  async getProjectMembership(
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberRow | null> {
    this.logger.debug(`getProjectMembership: ${projectId} / ${userId}`);
    const { data, error } = await this.db()
      .from('project_member')
      .select('*')
      .eq('membership_id', membershipId(projectId, userId))
      .maybeSingle();
    throwOnError('getProjectMembership', error);
    return data ? mapProjectMemberRow(data) : null;
  }

  async listProjectMembers(projectId: string): Promise<ProjectMemberRow[]> {
    this.logger.debug(`listProjectMembers: ${projectId}`);
    const { data, error } = await this.db()
      .from('project_member')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'active');
    throwOnError('listProjectMembers', error);
    return (data ?? []).map(mapProjectMemberRow);
  }

  async upsertProjectMember(row: {
    projectId: string;
    userId: string;
    role: ProjectMemberRole;
    addedByUserId: string;
    displayName?: string;
    color?: string;
  }): Promise<ProjectMemberRow> {
    this.logger.debug(`upsertProjectMember: ${row.projectId} / ${row.userId}`);
    const existing = await this.getProjectMembership(row.projectId, row.userId);
    const now = new Date().toISOString();
    const payload = {
      membership_id: membershipId(row.projectId, row.userId),
      project_id: row.projectId,
      user_id: row.userId,
      role: row.role,
      status: 'active',
      added_by_user_id: row.addedByUserId,
      display_name: row.displayName ?? existing?.displayName ?? null,
      color: row.color ?? existing?.color ?? null,
      created_at: existing?.createdAt.toISOString() ?? now,
      updated_at: now,
    };

    const { data, error } = await this.db()
      .from('project_member')
      .upsert(payload)
      .select('*')
      .single();
    throwOnError('upsertProjectMember', error);
    return mapProjectMemberRow(data);
  }

  async removeProjectMember(
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberRow | null> {
    this.logger.debug(`removeProjectMember: ${projectId} / ${userId}`);
    const existing = await this.getProjectMembership(projectId, userId);
    if (!existing) return null;

    const { data, error } = await this.db()
      .from('project_member')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('membership_id', membershipId(projectId, userId))
      .select('*')
      .maybeSingle();
    throwOnError('removeProjectMember', error);
    return data ? mapProjectMemberRow(data) : null;
  }

  async changeMemberRole(
    projectId: string,
    userId: string,
    newRole: ProjectMemberRole,
  ): Promise<ProjectMemberRow | null> {
    this.logger.debug(`changeMemberRole: ${projectId} / ${userId} -> ${newRole}`);
    const existing = await this.getProjectMembership(projectId, userId);
    if (!existing || existing.status === 'removed') return null;

    const { data, error } = await this.db()
      .from('project_member')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('membership_id', membershipId(projectId, userId))
      .select('*')
      .maybeSingle();
    throwOnError('changeMemberRole', error);
    return data ? mapProjectMemberRow(data) : null;
  }

  // ─── Project Assets ─────────────────────────────────────────────────────────

  async listProjectAssets(projectId: string): Promise<ProjectAssetRow[]> {
    this.logger.debug(`listProjectAssets: ${projectId}`);
    const { data, error } = await this.db()
      .from('project_asset')
      .select('*')
      .eq('project_id', projectId)
      .neq('status', 'deleted');
    throwOnError('listProjectAssets', error);
    return (data ?? []).map(mapProjectAssetRow);
  }

  async getProjectAsset(assetId: string): Promise<ProjectAssetRow | null> {
    const { data, error } = await this.db()
      .from('project_asset')
      .select('*')
      .eq('asset_id', assetId)
      .maybeSingle();
    throwOnError('getProjectAsset', error);
    return data ? mapProjectAssetRow(data) : null;
  }

  async upsertProjectAsset(row: {
    assetId: string;
    projectId: string;
    uploadedByUserId: string;
    assetType: string;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    storageRef: string;
    bucket?: string;
    objectPath?: string;
    publicUrl?: string;
    checksum?: string;
    sourceProvider?: string;
    requestId?: string;
    promptHash?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProjectAssetRow> {
    this.logger.debug(`upsertProjectAsset: ${row.projectId} / ${row.assetId}`);
    const existing = await this.getProjectAsset(row.assetId);
    const now = new Date().toISOString();
    const bucket = row.bucket ?? this.supabase.getStorageBucket();

    const { data, error } = await this.db()
      .from('project_asset')
      .upsert({
        asset_id: row.assetId,
        project_id: row.projectId,
        uploaded_by_user_id: row.uploadedByUserId,
        asset_type: row.assetType,
        name: row.name.trim(),
        mime_type: row.mimeType ?? null,
        size_bytes: row.sizeBytes ?? null,
        storage_ref: row.storageRef,
        bucket,
        object_path: row.objectPath ?? null,
        public_url: row.publicUrl ?? null,
        checksum: row.checksum ?? null,
        status: existing?.status ?? 'generating',
        source_provider: row.sourceProvider ?? null,
        request_id: row.requestId ?? null,
        prompt_hash: row.promptHash ?? null,
        metadata_json: row.metadata ?? null,
        created_at: existing?.createdAt.toISOString() ?? now,
        updated_at: now,
      })
      .select('*')
      .single();
    throwOnError('upsertProjectAsset', error);
    return mapProjectAssetRow(data);
  }

  async updateProjectAssetStatus(
    assetId: string,
    status: ProjectAssetStatus,
    patch: Partial<
      Pick<ProjectAssetRow, 'storageRef' | 'publicUrl' | 'sizeBytes' | 'checksum' | 'objectPath' | 'bucket'>
    > = {},
  ): Promise<ProjectAssetRow | null> {
    this.logger.debug(`updateProjectAssetStatus: ${assetId} -> ${status}`);
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (patch.storageRef !== undefined) update.storage_ref = patch.storageRef;
    if (patch.publicUrl !== undefined) update.public_url = patch.publicUrl;
    if (patch.sizeBytes !== undefined) update.size_bytes = patch.sizeBytes;
    if (patch.checksum !== undefined) update.checksum = patch.checksum;
    if (patch.objectPath !== undefined) update.object_path = patch.objectPath;
    if (patch.bucket !== undefined) update.bucket = patch.bucket;

    const { data, error } = await this.db()
      .from('project_asset')
      .update(update)
      .eq('asset_id', assetId)
      .select('*')
      .maybeSingle();
    throwOnError('updateProjectAssetStatus', error);
    return data ? mapProjectAssetRow(data) : null;
  }

  async removeProjectAsset(
    projectId: string,
    assetId: string,
  ): Promise<ProjectAssetRow | null> {
    this.logger.debug(`removeProjectAsset: ${projectId} / ${assetId}`);
    const existing = await this.getProjectAsset(assetId);
    if (!existing || existing.projectId !== projectId) return null;

    const { data, error } = await this.db()
      .from('project_asset')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('asset_id', assetId)
      .select('*')
      .maybeSingle();
    throwOnError('removeProjectAsset', error);
    return data ? mapProjectAssetRow(data) : null;
  }

  // ─── Generative Model Requests ───────────────────────────────────────────

  async createGenRequest(_row: {
    requestId: string;
    userId: string;
    prompt: string;
    modelProvider: string;
    modelId: string;
    inputRefs: string[];
  }): Promise<void> {
    this.logger.debug(`createGenRequest: ${_row.requestId}`);
  }

  async updateGenRequestOutput(requestId: string, outputRef: string): Promise<void> {
    this.logger.debug(`updateGenRequestOutput: ${requestId}`);
    const { error } = await this.db()
      .from('request_status')
      .update({
        output_ref: outputRef,
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', requestId);
    throwOnError('updateGenRequestOutput', error);
  }

  // ─── External Asset Records ───────────────────────────────────────────────

  async createExternalAsset(row: {
    assetId: string;
    userId: string;
    requestId: string;
    provider: string;
    assetType: 'model3d' | 'image' | 'document' | 'other';
    mimeType: string;
    sizeBytes?: number;
    sourceUrl: string;
    storageRef: string;
  }): Promise<void> {
    this.logger.debug(`createExternalAsset: ${row.assetId} (${row.provider})`);
    const { error } = await this.db().from('external_asset').insert({
      asset_id: row.assetId,
      user_id: row.userId,
      request_id: row.requestId,
      provider: row.provider,
      asset_type: row.assetType,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes ?? null,
      source_url: row.sourceUrl,
      storage_ref: row.storageRef,
      created_at: new Date().toISOString(),
    });
    throwOnError('createExternalAsset', error);
  }

  // ─── Provider Sync Records ────────────────────────────────────────────────

  async upsertProviderSync(row: {
    userId: string;
    provider: string;
    lastSyncedAt: Date;
    itemCount?: number;
    metadata?: Record<string, unknown>;
    errorMessage?: string;
  }): Promise<void> {
    this.logger.debug(`upsertProviderSync: ${row.userId} / ${row.provider}`);
    const { error } = await this.db().from('provider_sync').upsert({
      sync_id: `${row.userId}:${row.provider}`,
      user_id: row.userId,
      provider: row.provider,
      last_synced_at: row.lastSyncedAt.toISOString(),
      item_count: row.itemCount ?? null,
      metadata_json: row.metadata ?? null,
      error_message: row.errorMessage ?? null,
    });
    throwOnError('upsertProviderSync', error);
  }

  async getProviderSync(
    userId: string,
    provider: string,
  ): Promise<{
    lastSyncedAt: Date;
    itemCount?: number;
    metadata?: Record<string, unknown>;
  } | null> {
    this.logger.debug(`getProviderSync: ${userId} / ${provider}`);
    const { data, error } = await this.db()
      .from('provider_sync')
      .select('*')
      .eq('sync_id', `${userId}:${provider}`)
      .maybeSingle();
    throwOnError('getProviderSync', error);
    if (!data) return null;
    return {
      lastSyncedAt: new Date(data.last_synced_at as string),
      itemCount: data.item_count != null ? Number(data.item_count) : undefined,
      metadata: (data.metadata_json as Record<string, unknown> | null) ?? undefined,
    };
  }

  // ─── Imported Content Records ─────────────────────────────────────────────

  async createImportedContent(row: {
    contentId: string;
    userId: string;
    provider: string;
    externalId: string;
    title: string;
    contentType: string;
    importedAt: Date;
    storageRef?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.logger.debug(`createImportedContent: ${row.contentId}`);
    const { error } = await this.db().from('imported_content').insert({
      content_id: row.contentId,
      user_id: row.userId,
      provider: row.provider,
      external_id: row.externalId,
      title: row.title,
      content_type: row.contentType,
      imported_at: row.importedAt.toISOString(),
      storage_ref: row.storageRef ?? null,
      metadata_json: row.metadata ?? null,
    });
    throwOnError('createImportedContent', error);
  }

  async getImportedContent(
    contentId: string,
  ): Promise<{ contentId: string; userId: string; provider: string } | null> {
    this.logger.debug(`getImportedContent: ${contentId}`);
    const { data, error } = await this.db()
      .from('imported_content')
      .select('content_id, user_id, provider')
      .eq('content_id', contentId)
      .maybeSingle();
    throwOnError('getImportedContent', error);
    if (!data) return null;
    return {
      contentId: data.content_id as string,
      userId: data.user_id as string,
      provider: data.provider as string,
    };
  }

  // ─── Share Links ──────────────────────────────────────────────────────────

  async createShareLink(row: {
    linkId: string;
    projectId: string;
    tokenHash: string;
    roleToGrant: ShareLinkRole;
    createdByUserId: string;
    expiresAt: Date;
    maxUses?: number;
  }): Promise<ShareLinkRow> {
    this.logger.debug(`createShareLink: ${row.linkId} for project ${row.projectId}`);
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('share_link')
      .insert({
        link_id: row.linkId,
        project_id: row.projectId,
        token_hash: row.tokenHash,
        role_to_grant: row.roleToGrant,
        created_by_user_id: row.createdByUserId,
        expires_at: row.expiresAt.toISOString(),
        max_uses: row.maxUses ?? null,
        use_count: 0,
        created_at: now,
      })
      .select('*')
      .single();
    throwOnError('createShareLink', error);
    return mapShareLinkRow(data);
  }

  async getShareLinkByHash(tokenHash: string): Promise<ShareLinkRow | null> {
    this.logger.debug('getShareLinkByHash');
    const { data, error } = await this.db()
      .from('share_link')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    throwOnError('getShareLinkByHash', error);
    return data ? mapShareLinkRow(data) : null;
  }

  async getShareLinkById(linkId: string): Promise<ShareLinkRow | null> {
    this.logger.debug(`getShareLinkById: ${linkId}`);
    const { data, error } = await this.db()
      .from('share_link')
      .select('*')
      .eq('link_id', linkId)
      .maybeSingle();
    throwOnError('getShareLinkById', error);
    return data ? mapShareLinkRow(data) : null;
  }

  async listProjectShareLinks(projectId: string): Promise<ShareLinkRow[]> {
    this.logger.debug(`listProjectShareLinks: ${projectId}`);
    const { data, error } = await this.db()
      .from('share_link')
      .select('*')
      .eq('project_id', projectId)
      .is('revoked_at', null);
    throwOnError('listProjectShareLinks', error);
    return (data ?? []).map(mapShareLinkRow);
  }

  async revokeShareLink(linkId: string): Promise<ShareLinkRow | null> {
    this.logger.debug(`revokeShareLink: ${linkId}`);
    const existing = await this.getShareLinkById(linkId);
    if (!existing || existing.revokedAt) return existing;

    const { data, error } = await this.db()
      .from('share_link')
      .update({ revoked_at: new Date().toISOString() })
      .eq('link_id', linkId)
      .select('*')
      .maybeSingle();
    throwOnError('revokeShareLink', error);
    return data ? mapShareLinkRow(data) : null;
  }

  async consumeShareLink(
    tokenHash: string,
    consumingUserId: string,
    opts?: { displayName?: string; color?: string },
  ): Promise<{ link: ShareLinkRow; member: ProjectMemberRow } | null> {
    this.logger.debug(`consumeShareLink for user ${consumingUserId}`);
    const link = await this.getShareLinkByHash(tokenHash);
    if (!link) return null;
    if (link.revokedAt) return null;
    if (link.expiresAt <= new Date()) return null;
    if (link.maxUses !== undefined && link.useCount >= link.maxUses) return null;

    const newUseCount = link.useCount + 1;
    const isSingleUse = link.maxUses !== undefined && link.maxUses === 1;
    const linkPatch: Record<string, unknown> = {
      use_count: newUseCount,
      consumed_at: isSingleUse ? new Date().toISOString() : link.consumedAt?.toISOString() ?? null,
    };

    const { data: updatedLink, error: linkError } = await this.db()
      .from('share_link')
      .update(linkPatch)
      .eq('link_id', link.linkId)
      .select('*')
      .single();
    throwOnError('consumeShareLink.link', linkError);

    const member = await this.upsertProjectMember({
      projectId: link.projectId,
      userId: consumingUserId,
      role: link.roleToGrant,
      addedByUserId: link.createdByUserId,
      displayName: opts?.displayName,
      color: opts?.color,
    });

    return { link: mapShareLinkRow(updatedLink), member };
  }

  // ─── Project Invites ─────────────────────────────────────────────────────────

  async createProjectInvite(row: {
    inviteId: string;
    projectId: string;
    invitedByUserId: string;
    inviteType: InviteType;
    roleToGrant: ProjectMemberRole;
    inviteeEmail?: string;
    inviteeUserId?: string;
    inviteCodeHash?: string;
    expiresAt?: Date;
  }): Promise<ProjectInviteRow> {
    this.logger.debug(`createProjectInvite: ${row.inviteId} (${row.inviteType}) for project ${row.projectId}`);
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('project_invite')
      .insert({
        invite_id: row.inviteId,
        project_id: row.projectId,
        invited_by_user_id: row.invitedByUserId,
        invite_type: row.inviteType,
        role_to_grant: row.roleToGrant,
        invitee_email: row.inviteeEmail ?? null,
        invitee_user_id: row.inviteeUserId ?? null,
        invite_code_hash: row.inviteCodeHash ?? null,
        status: 'pending',
        expires_at: row.expiresAt?.toISOString() ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    throwOnError('createProjectInvite', error);
    return mapProjectInviteRow(data);
  }

  async getProjectInviteById(inviteId: string): Promise<ProjectInviteRow | null> {
    this.logger.debug(`getProjectInviteById: ${inviteId}`);
    const { data, error } = await this.db()
      .from('project_invite')
      .select('*')
      .eq('invite_id', inviteId)
      .maybeSingle();
    throwOnError('getProjectInviteById', error);
    return data ? mapProjectInviteRow(data) : null;
  }

  async getProjectInviteByCodeHash(codeHash: string): Promise<ProjectInviteRow | null> {
    this.logger.debug('getProjectInviteByCodeHash');
    const { data, error } = await this.db()
      .from('project_invite')
      .select('*')
      .eq('invite_code_hash', codeHash)
      .maybeSingle();
    throwOnError('getProjectInviteByCodeHash', error);
    return data ? mapProjectInviteRow(data) : null;
  }

  async listProjectInvites(
    projectId: string,
    opts: { type?: InviteType; status?: InviteStatus } = {},
  ): Promise<ProjectInviteRow[]> {
    this.logger.debug(`listProjectInvites: ${projectId}`);
    let query = this.db()
      .from('project_invite')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (opts.type) query = query.eq('invite_type', opts.type);
    if (opts.status) query = query.eq('status', opts.status);

    const { data, error } = await query;
    throwOnError('listProjectInvites', error);
    return (data ?? []).map(mapProjectInviteRow);
  }

  async revokeProjectInvite(inviteId: string): Promise<ProjectInviteRow | null> {
    this.logger.debug(`revokeProjectInvite: ${inviteId}`);
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('project_invite')
      .update({ status: 'revoked', revoked_at: now, updated_at: now })
      .eq('invite_id', inviteId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    throwOnError('revokeProjectInvite', error);
    return data ? mapProjectInviteRow(data) : null;
  }

  /**
   * Accept a project invite: marks it accepted and upserts the user as a project member.
   * Returns null when the invite is missing, expired, revoked, or already accepted.
   */
  async acceptProjectInvite(
    inviteId: string,
    acceptingUserId: string,
    opts?: { displayName?: string; color?: string },
  ): Promise<{ invite: ProjectInviteRow; member: ProjectMemberRow } | null> {
    this.logger.debug(`acceptProjectInvite: ${inviteId} by ${acceptingUserId}`);
    const invite = await this.getProjectInviteById(inviteId);
    if (!invite) return null;
    if (invite.status !== 'pending') return null;
    if (invite.expiresAt && invite.expiresAt <= new Date()) return null;

    const now = new Date().toISOString();
    const { data: updatedInvite, error: inviteError } = await this.db()
      .from('project_invite')
      .update({
        status: 'accepted',
        accepted_at: now,
        accepted_by_user_id: acceptingUserId,
        updated_at: now,
      })
      .eq('invite_id', inviteId)
      .select('*')
      .single();
    throwOnError('acceptProjectInvite.invite', inviteError);

    const member = await this.upsertProjectMember({
      projectId: invite.projectId,
      userId: acceptingUserId,
      role: invite.roleToGrant,
      addedByUserId: invite.invitedByUserId,
      displayName: opts?.displayName,
      color: opts?.color,
    });

    return { invite: mapProjectInviteRow(updatedInvite), member };
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  // ─── Provider OAuth Credentials (ciphertext at rest — use ProviderCredentialService) ─

  async upsertProviderCredential(row: {
    userId: string;
    provider: string;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }): Promise<void> {
    this.logger.debug(`upsertProviderCredential: ${row.userId} / ${row.provider}`);
    const now = new Date().toISOString();
    const { error } = await this.db()
      .from('provider_credential')
      .upsert(
        {
          credential_id: `${row.userId}:${row.provider}`,
          user_id: row.userId,
          provider: row.provider,
          access_token: row.accessToken,
          refresh_token: row.refreshToken ?? null,
          expires_at: row.expiresAt?.toISOString() ?? null,
          updated_at: now,
        },
        { onConflict: 'user_id,provider' },
      );
    throwOnError('upsertProviderCredential', error);
  }

  async getProviderCredential(
    userId: string,
    provider: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  } | null> {
    this.logger.debug(`getProviderCredential: ${userId} / ${provider}`);
    const { data, error } = await this.db()
      .from('provider_credential')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    throwOnError('getProviderCredential', error);
    if (!data?.access_token) return null;

    return {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string | null) ?? undefined,
      expiresAt: data.expires_at
        ? new Date(data.expires_at as string).getTime()
        : undefined,
    };
  }

  private db() {
    return this.supabase.getAdminClient();
  }

  async getProjectById(projectId: string): Promise<ProjectRow | null> {
    const { data, error } = await this.db()
      .from('project')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();
    throwOnError('getProjectById', error);
    return data ? mapProjectRow(data) : null;
  }
}

function membershipId(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

function isTerminalStatus(status: RequestStatus | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function throwOnError(context: string, error: { message: string } | null): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function isMissingExtendedUserProfileColumns(error: { message: string }): boolean {
  return (
    error.message.includes('schema cache') &&
    (error.message.includes('on_demand_json') ||
      error.message.includes('organization_id') ||
      error.message.includes('storage_id') ||
      error.message.includes("'plan'") ||
      error.message.includes('created_at'))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapRequestStatusRow(row: Record<string, unknown>): RequestStatusRow {
  return {
    requestId: row.request_id as string,
    userId: row.user_id as string,
    type: row.type as string,
    status: row.status as RequestStatus,
    errorMessage: (row.error_message as string | null) ?? undefined,
    outputRef: (row.output_ref as string | null) ?? undefined,
    resultJson: (row.result_json as Record<string, unknown> | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapUserProfileRow(row: Record<string, unknown>): UserProfileRow {
  const onDemandRaw = row.on_demand_json as { monthlyCap?: number | null } | null;
  return {
    userId: row.user_id as string,
    displayName: (row.display_name as string | null) ?? undefined,
    avatarUrl: (row.avatar_url as string | null) ?? undefined,
    plan: (row.plan as UserProfileRow['plan']) ?? null,
    preferences: (row.preferences_json as UserProfileRow['preferences']) ?? {},
    organizationId: (row.organization_id as string | null) ?? null,
    storageId: (row.storage_id as string | null) ?? null,
    onDemand: {
      monthlyCap: onDemandRaw?.monthlyCap ?? null,
    },
    createdAt: new Date((row.created_at as string) ?? (row.updated_at as string)),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapProjectRow(row: Record<string, unknown>): ProjectRow {
  return {
    projectId: row.project_id as string,
    ownerUserId: row.owner_user_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? undefined,
    workspaceMode: row.workspace_mode as ProjectWorkspaceMode,
    status: row.status as ProjectStatus,
    iconAssetId: (row.icon_asset_id as string | null) ?? undefined,
    metadata: (row.metadata_json as Record<string, unknown> | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapProjectMemberRow(row: Record<string, unknown>): ProjectMemberRow {
  return {
    membershipId: row.membership_id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    role: row.role as ProjectMemberRole,
    status: row.status as ProjectMemberRow['status'],
    addedByUserId: row.added_by_user_id as string,
    displayName: (row.display_name as string | null) ?? undefined,
    color: (row.color as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapProjectAssetRow(row: Record<string, unknown>): ProjectAssetRow {
  return {
    assetId: row.asset_id as string,
    projectId: row.project_id as string,
    uploadedByUserId: row.uploaded_by_user_id as string,
    assetType: row.asset_type as string,
    name: row.name as string,
    mimeType: (row.mime_type as string | null) ?? undefined,
    sizeBytes: row.size_bytes != null ? Number(row.size_bytes) : undefined,
    storageRef: row.storage_ref as string,
    bucket: (row.bucket as string | null) ?? undefined,
    objectPath: (row.object_path as string | null) ?? undefined,
    publicUrl: (row.public_url as string | null) ?? undefined,
    checksum: (row.checksum as string | null) ?? undefined,
    status: row.status as ProjectAssetRow['status'],
    sourceProvider: (row.source_provider as string | null) ?? undefined,
    requestId: (row.request_id as string | null) ?? undefined,
    promptHash: (row.prompt_hash as string | null) ?? undefined,
    metadata: (row.metadata_json as Record<string, unknown> | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapShareLinkRow(row: Record<string, unknown>): ShareLinkRow {
  return {
    linkId: row.link_id as string,
    projectId: row.project_id as string,
    tokenHash: row.token_hash as string,
    roleToGrant: row.role_to_grant as ShareLinkRole,
    createdByUserId: row.created_by_user_id as string,
    expiresAt: new Date(row.expires_at as string),
    maxUses: row.max_uses != null ? Number(row.max_uses) : undefined,
    useCount: Number(row.use_count),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : undefined,
    consumedAt: row.consumed_at ? new Date(row.consumed_at as string) : undefined,
    createdAt: new Date(row.created_at as string),
  };
}

function mapProjectInviteRow(row: Record<string, unknown>): ProjectInviteRow {
  return {
    inviteId: row.invite_id as string,
    projectId: row.project_id as string,
    invitedByUserId: row.invited_by_user_id as string,
    inviteType: row.invite_type as InviteType,
    roleToGrant: row.role_to_grant as ProjectMemberRole,
    inviteeEmail: (row.invitee_email as string | null) ?? undefined,
    inviteeUserId: (row.invitee_user_id as string | null) ?? undefined,
    inviteCodeHash: (row.invite_code_hash as string | null) ?? undefined,
    status: row.status as InviteStatus,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at as string) : undefined,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : undefined,
    acceptedByUserId: (row.accepted_by_user_id as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
