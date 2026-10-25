import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './supabase.js';
import type {
  ProjectAccessResult,
  ProjectAssetRow,
  ProjectAssetStatus,
  ProjectMemberRole,
  ProjectMemberRow,
  ProjectRow,
  ProjectStatus,
  ProjectWorkspaceMode,
  RequestStatus,
  RequestStatusRow,
  RiggingJobRow,
  RiggingJobStatus,
  Mesh2MotionJobRow,
  Mesh2MotionJobStatus,
  ShareLinkRole,
  ShareLinkRow,
  UserProfileRow,
  ProjectInviteRow,
  InviteType,
  InviteStatus,
  CollaborationDocumentType,
  CollaborationDocumentRow,
  CollaborationSnapshotRow,
  ProjectCommentRow,
  CollaborationActivityType,
  CollaborationActivityStatus,
  CollaborationActivityRow,
  GenerationUsageEventRow,
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
    extras?: Pick<
      RequestStatusRow,
      'errorMessage' | 'outputRef' | 'resultJson'
    >,
  ): Promise<void> {
    this.logger.debug(`updateRequestStatus: ${requestId} → ${status}`);
    const patch: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (extras?.errorMessage !== undefined)
      patch.error_message = extras.errorMessage;
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

  // ─── Generation usage / cost events ───────────────────────────────────────

  async upsertGenerationUsageEvent(
    row: Omit<GenerationUsageEventRow, 'createdAt'> & { createdAt?: Date },
  ): Promise<void> {
    const now = (row.createdAt ?? new Date()).toISOString();
    const { error } = await this.db()
      .from('generation_usage_event')
      .upsert(
        {
          event_id: row.eventId,
          request_id: row.requestId,
          project_id: row.projectId,
          actor_user_id: row.actorUserId,
          provider: row.provider,
          model_id: row.modelId ?? null,
          surface: row.surface,
          action_kind: row.actionKind ?? null,
          request_type: row.requestType,
          usage_json: row.usage,
          estimated_cost_usd: row.estimatedCostUsd,
          currency: row.currency,
          billable: row.billable,
          created_at: now,
          document_id: row.documentId ?? null,
          thread_id: row.threadId ?? null,
          run_id: row.runId ?? null,
          stage: row.stage ?? null,
          provider_request_id: row.providerRequestId ?? null,
          requested_model: row.requestedModel ?? null,
          actual_model: row.actualModel ?? null,
          model_preset_id: row.modelPresetId ?? null,
          prompt_version: row.promptVersion ?? null,
          schema_version: row.schemaVersion ?? null,
          context_manifest_version: row.contextManifestVersion ?? null,
          provider_cost_usd: row.providerCostUsd ?? null,
          price_table_version: row.priceTableVersion ?? null,
          latency_ms: row.latencyMs ?? null,
          retry_count: row.retryCount ?? null,
          repair_attempts: row.repairAttempts ?? null,
          outcome: row.outcome ?? null,
          error_category: row.errorCategory ?? null,
          image_count: row.imageCount ?? null,
        },
        { onConflict: 'request_id', ignoreDuplicates: true },
      );
    throwOnError('upsertGenerationUsageEvent', error);
  }

  async listGenerationUsageEvents(
    projectId: string,
    opts: { since?: Date; billableOnly?: boolean } = {},
  ): Promise<GenerationUsageEventRow[]> {
    let query = this.db()
      .from('generation_usage_event')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (opts.billableOnly) {
      query = query.eq('billable', true);
    }
    if (opts.since) {
      query = query.gte('created_at', opts.since.toISOString());
    }

    const { data, error } = await query;
    throwOnError('listGenerationUsageEvents', error);
    return (data ?? []).map(mapGenerationUsageEventRow);
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
      const { error: legacyError } = await this.db()
        .from('user_profile')
        .upsert(legacyRow);
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

  async getUserProfilesByIds(
    userIds: string[],
  ): Promise<Map<string, UserProfileRow>> {
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
    organizationId?: string | null;
    name: string;
    description?: string | null;
    workspaceMode: ProjectWorkspaceMode;
    iconAssetId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProjectRow> {
    this.logger.debug(`createProject: ${row.projectId}`);
    const now = new Date().toISOString();
    const { error: projectError } = await this.db()
      .from('project')
      .insert({
        project_id: row.projectId,
        owner_user_id: row.ownerUserId,
        organization_id: row.organizationId ?? null,
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

    const { error: memberError } = await this.db()
      .from('project_member')
      .upsert({
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
      organizationId: row.organizationId ?? null,
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
      organizationId?: string | null;
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
    if (patch.workspaceMode !== undefined)
      update.workspace_mode = patch.workspaceMode;
    if (patch.iconAssetId !== undefined)
      update.icon_asset_id = patch.iconAssetId;
    if (patch.metadata !== undefined) {
      update.metadata_json = {
        ...(existing.metadata ?? {}),
        ...patch.metadata,
      };
    }
    if (patch.organizationId !== undefined) {
      update.organization_id = patch.organizationId;
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

    const memberProjectIds = [
      ...new Set((members ?? []).map((m) => m.project_id as string)),
    ];
    const queries = [
      this.db()
        .from('project')
        .select('*')
        .eq('owner_user_id', userId)
        .neq('status', 'deleted'),
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
    for (const result of results)
      throwOnError('listProjectsForUser.projects', result.error);

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
    const result = await this.resolveProjectAccessForUser(userId, projectId);
    return result.ok ? result.project : null;
  }

  async resolveProjectAccessForUser(
    userId: string,
    projectId: string,
  ): Promise<ProjectAccessResult> {
    this.logger.debug(`resolveProjectAccessForUser: ${userId} / ${projectId}`);
    const project = await this.getProjectById(projectId);
    if (!project) return { ok: false, reason: 'not_found' };

    const member = await this.getProjectMembership(projectId, userId);
    const wasAssociated = project.ownerUserId === userId || member !== null;

    if (project.status === 'deleted') {
      return wasAssociated
        ? { ok: false, reason: 'deleted' }
        : { ok: false, reason: 'not_found' };
    }

    if (project.ownerUserId === userId) return { ok: true, project };
    if (member?.status === 'active') return { ok: true, project };
    if (member?.status === 'removed') return { ok: false, reason: 'removed' };

    return { ok: false, reason: 'not_found' };
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

  /** Accepts either a userId or a composite membershipId (`projectId:userId`). */
  async getProjectMembershipByRef(
    projectId: string,
    memberRef: string,
  ): Promise<ProjectMemberRow | null> {
    const trimmed = memberRef.trim();
    if (trimmed.includes(':')) {
      this.logger.debug(`getProjectMembershipByRef: ${projectId} / ${trimmed}`);
      const { data, error } = await this.db()
        .from('project_member')
        .select('*')
        .eq('project_id', projectId)
        .eq('membership_id', trimmed)
        .maybeSingle();
      throwOnError('getProjectMembershipByRef', error);
      return data ? mapProjectMemberRow(data) : null;
    }
    return this.getProjectMembership(projectId, trimmed);
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

  async removeAllProjectMembers(projectId: string): Promise<void> {
    this.logger.debug(`removeAllProjectMembers: ${projectId}`);
    const { error } = await this.db()
      .from('project_member')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('status', 'active');
    throwOnError('removeAllProjectMembers', error);
  }

  async changeMemberRole(
    projectId: string,
    userId: string,
    newRole: ProjectMemberRole,
  ): Promise<ProjectMemberRow | null> {
    this.logger.debug(
      `changeMemberRole: ${projectId} / ${userId} -> ${newRole}`,
    );
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
    /** Cloud project id. Omit/null when using localProjectId. */
    projectId?: string | null;
    localProjectId?: string | null;
    ownerUserId?: string | null;
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
    status?: ProjectAssetStatus;
  }): Promise<ProjectAssetRow> {
    const hasCloud = Boolean(row.projectId);
    const hasLocal = Boolean(row.localProjectId);
    if (hasCloud === hasLocal) {
      throw new Error(
        'upsertProjectAsset requires exactly one of projectId or localProjectId',
      );
    }
    this.logger.debug(
      `upsertProjectAsset: ${row.projectId ?? row.localProjectId} / ${row.assetId}`,
    );
    const existing = await this.getProjectAsset(row.assetId);
    const now = new Date().toISOString();
    const bucket = row.bucket ?? this.supabase.getStorageBucket();
    const ownerUserId =
      row.ownerUserId ?? existing?.ownerUserId ?? row.uploadedByUserId;

    const { data, error } = await this.db()
      .from('project_asset')
      .upsert({
        asset_id: row.assetId,
        project_id: row.projectId ?? null,
        local_project_id: row.localProjectId ?? null,
        owner_user_id: ownerUserId,
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
        status: row.status ?? existing?.status ?? 'generating',
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
      Pick<
        ProjectAssetRow,
        | 'storageRef'
        | 'publicUrl'
        | 'sizeBytes'
        | 'checksum'
        | 'objectPath'
        | 'bucket'
      >
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

  async removeLocalProjectAsset(
    localProjectId: string,
    ownerUserId: string,
    assetId: string,
  ): Promise<ProjectAssetRow | null> {
    const existing = await this.getProjectAsset(assetId);
    if (
      !existing ||
      existing.localProjectId !== localProjectId ||
      existing.ownerUserId !== ownerUserId
    ) {
      return null;
    }
    const { data, error } = await this.db()
      .from('project_asset')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('asset_id', assetId)
      .select('*')
      .maybeSingle();
    throwOnError('removeLocalProjectAsset', error);
    return data ? mapProjectAssetRow(data) : null;
  }

  // ─── Rigging jobs ─────────────────────────────────────────────────────────

  async createRiggingJob(
    row: Omit<RiggingJobRow, 'createdAt' | 'updatedAt'>,
  ): Promise<RiggingJobRow> {
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('rigging_job')
      .upsert({
        job_id: row.jobId,
        user_id: row.userId,
        project_id: row.projectId ?? null,
        local_project_id: row.localProjectId ?? null,
        source_asset_id: row.sourceAssetId,
        output_asset_id: row.outputAssetId,
        worker_job_id: row.workerJobId ?? null,
        idempotency_key: row.idempotencyKey ?? null,
        status: row.status,
        simplify: row.simplify,
        target_face_count: row.targetFaceCount,
        error_message: row.errorMessage ?? null,
        result_json: row.resultJson ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    throwOnError('createRiggingJob', error);
    return mapRiggingJobRow(data);
  }

  async getRiggingJob(jobId: string): Promise<RiggingJobRow | null> {
    const { data, error } = await this.db()
      .from('rigging_job')
      .select('*')
      .eq('job_id', jobId)
      .maybeSingle();
    throwOnError('getRiggingJob', error);
    return data ? mapRiggingJobRow(data) : null;
  }

  async getRiggingJobByIdempotencyKey(
    key: string,
  ): Promise<RiggingJobRow | null> {
    const { data, error } = await this.db()
      .from('rigging_job')
      .select('*')
      .eq('idempotency_key', key)
      .maybeSingle();
    throwOnError('getRiggingJobByIdempotencyKey', error);
    return data ? mapRiggingJobRow(data) : null;
  }

  async updateRiggingJob(
    jobId: string,
    patch: Partial<
      Pick<
        RiggingJobRow,
        | 'status'
        | 'workerJobId'
        | 'errorMessage'
        | 'resultJson'
        | 'idempotencyKey'
      >
    >,
  ): Promise<RiggingJobRow | null> {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.workerJobId !== undefined)
      update.worker_job_id = patch.workerJobId;
    if (patch.errorMessage !== undefined) {
      update.error_message = patch.errorMessage;
    }
    if (patch.resultJson !== undefined) update.result_json = patch.resultJson;
    if (patch.idempotencyKey !== undefined) {
      update.idempotency_key = patch.idempotencyKey;
    }

    const { data, error } = await this.db()
      .from('rigging_job')
      .update(update)
      .eq('job_id', jobId)
      .select('*')
      .maybeSingle();
    throwOnError('updateRiggingJob', error);
    return data ? mapRiggingJobRow(data) : null;
  }

  // ─── Mesh2Motion jobs ─────────────────────────────────────────────────────

  async createMesh2MotionJob(
    row: Omit<Mesh2MotionJobRow, 'createdAt' | 'updatedAt'>,
  ): Promise<Mesh2MotionJobRow> {
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('mesh2motion_job')
      .upsert({
        job_id: row.jobId,
        user_id: row.userId,
        project_id: row.projectId ?? null,
        local_project_id: row.localProjectId ?? null,
        source_asset_id: row.sourceAssetId,
        output_asset_id: row.outputAssetId,
        worker_job_id: row.workerJobId ?? null,
        idempotency_key: row.idempotencyKey ?? null,
        status: row.status,
        skeleton_type: row.skeletonType,
        animation_names: row.animationNames ?? null,
        error_message: row.errorMessage ?? null,
        result_json: row.resultJson ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    throwOnError('createMesh2MotionJob', error);
    return mapMesh2MotionJobRow(data);
  }

  async getMesh2MotionJob(jobId: string): Promise<Mesh2MotionJobRow | null> {
    const { data, error } = await this.db()
      .from('mesh2motion_job')
      .select('*')
      .eq('job_id', jobId)
      .maybeSingle();
    throwOnError('getMesh2MotionJob', error);
    return data ? mapMesh2MotionJobRow(data) : null;
  }

  async getMesh2MotionJobByIdempotencyKey(
    key: string,
  ): Promise<Mesh2MotionJobRow | null> {
    const { data, error } = await this.db()
      .from('mesh2motion_job')
      .select('*')
      .eq('idempotency_key', key)
      .maybeSingle();
    throwOnError('getMesh2MotionJobByIdempotencyKey', error);
    return data ? mapMesh2MotionJobRow(data) : null;
  }

  async updateMesh2MotionJob(
    jobId: string,
    patch: Partial<
      Pick<
        Mesh2MotionJobRow,
        | 'status'
        | 'workerJobId'
        | 'errorMessage'
        | 'resultJson'
        | 'idempotencyKey'
      >
    >,
  ): Promise<Mesh2MotionJobRow | null> {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.workerJobId !== undefined)
      update.worker_job_id = patch.workerJobId;
    if (patch.errorMessage !== undefined) {
      update.error_message = patch.errorMessage;
    }
    if (patch.resultJson !== undefined) update.result_json = patch.resultJson;
    if (patch.idempotencyKey !== undefined) {
      update.idempotency_key = patch.idempotencyKey;
    }

    const { data, error } = await this.db()
      .from('mesh2motion_job')
      .update(update)
      .eq('job_id', jobId)
      .select('*')
      .maybeSingle();
    throwOnError('updateMesh2MotionJob', error);
    return data ? mapMesh2MotionJobRow(data) : null;
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

  async updateGenRequestOutput(
    requestId: string,
    outputRef: string,
  ): Promise<void> {
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
    const { error } = await this.db()
      .from('external_asset')
      .insert({
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
    const { error } = await this.db()
      .from('provider_sync')
      .upsert({
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
      metadata:
        (data.metadata_json as Record<string, unknown> | null) ?? undefined,
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
    const { error } = await this.db()
      .from('imported_content')
      .insert({
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
    this.logger.debug(
      `createShareLink: ${row.linkId} for project ${row.projectId}`,
    );
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
    if (link.maxUses !== undefined && link.useCount >= link.maxUses)
      return null;

    const newUseCount = link.useCount + 1;
    const isSingleUse = link.maxUses !== undefined && link.maxUses === 1;
    const linkPatch: Record<string, unknown> = {
      use_count: newUseCount,
      consumed_at: isSingleUse
        ? new Date().toISOString()
        : (link.consumedAt?.toISOString() ?? null),
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
    this.logger.debug(
      `createProjectInvite: ${row.inviteId} (${row.inviteType}) for project ${row.projectId}`,
    );
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

  async getProjectInviteById(
    inviteId: string,
  ): Promise<ProjectInviteRow | null> {
    this.logger.debug(`getProjectInviteById: ${inviteId}`);
    const { data, error } = await this.db()
      .from('project_invite')
      .select('*')
      .eq('invite_id', inviteId)
      .maybeSingle();
    throwOnError('getProjectInviteById', error);
    return data ? mapProjectInviteRow(data) : null;
  }

  async getProjectInviteByCodeHash(
    codeHash: string,
  ): Promise<ProjectInviteRow | null> {
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

  async revokeProjectInvite(
    inviteId: string,
  ): Promise<ProjectInviteRow | null> {
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

  // ─── Collaboration Documents (Yjs registry) ─────────────────────────────────

  async createCollaborationDocument(row: {
    documentKey: string;
    documentId: string;
    projectId: string;
    documentType: CollaborationDocumentType;
    title: string;
    createdByUserId: string;
    metadata?: Record<string, unknown>;
  }): Promise<CollaborationDocumentRow> {
    this.logger.debug(`createCollaborationDocument: ${row.documentKey}`);
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('collaboration_document')
      .insert({
        document_key: row.documentKey,
        document_id: row.documentId,
        project_id: row.projectId,
        document_type: row.documentType,
        title: row.title.trim() || 'Untitled',
        version: 0,
        created_by_user_id: row.createdByUserId,
        metadata_json: row.metadata ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    throwOnError('createCollaborationDocument', error);
    return mapCollaborationDocumentRow(data);
  }

  async getCollaborationDocumentByKey(
    documentKey: string,
  ): Promise<CollaborationDocumentRow | null> {
    const { data, error } = await this.db()
      .from('collaboration_document')
      .select('*')
      .eq('document_key', documentKey)
      .maybeSingle();
    throwOnError('getCollaborationDocumentByKey', error);
    return data ? mapCollaborationDocumentRow(data) : null;
  }

  async getCollaborationDocumentById(
    projectId: string,
    documentId: string,
  ): Promise<CollaborationDocumentRow | null> {
    const { data, error } = await this.db()
      .from('collaboration_document')
      .select('*')
      .eq('project_id', projectId)
      .eq('document_id', documentId)
      .maybeSingle();
    throwOnError('getCollaborationDocumentById', error);
    return data ? mapCollaborationDocumentRow(data) : null;
  }

  async listCollaborationDocuments(
    projectId: string,
    opts: {
      documentType?: CollaborationDocumentType;
      includeArchived?: boolean;
    } = {},
  ): Promise<CollaborationDocumentRow[]> {
    let query = this.db()
      .from('collaboration_document')
      .select('*')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false });

    if (opts.documentType) query = query.eq('document_type', opts.documentType);
    if (!opts.includeArchived) query = query.is('archived_at', null);

    const { data, error } = await query;
    throwOnError('listCollaborationDocuments', error);
    return (data ?? []).map(mapCollaborationDocumentRow);
  }

  async updateCollaborationDocument(
    documentKey: string,
    patch: {
      title?: string;
      archived?: boolean;
      metadata?: Record<string, unknown>;
      version?: number;
      updatedByUserId?: string;
    },
  ): Promise<CollaborationDocumentRow | null> {
    this.logger.debug(`updateCollaborationDocument: ${documentKey}`);
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.title !== undefined)
      update.title = patch.title.trim() || 'Untitled';
    if (patch.archived !== undefined)
      update.archived_at = patch.archived ? new Date().toISOString() : null;
    if (patch.metadata !== undefined) update.metadata_json = patch.metadata;
    if (patch.version !== undefined) update.version = patch.version;
    if (patch.updatedByUserId !== undefined)
      update.updated_by_user_id = patch.updatedByUserId;

    const { data, error } = await this.db()
      .from('collaboration_document')
      .update(update)
      .eq('document_key', documentKey)
      .select('*')
      .maybeSingle();
    throwOnError('updateCollaborationDocument', error);
    return data ? mapCollaborationDocumentRow(data) : null;
  }

  async listCollaborationSnapshots(
    documentKey: string,
    opts: { limit?: number } = {},
  ): Promise<CollaborationSnapshotRow[]> {
    const { data, error } = await this.db()
      .from('collaboration_snapshot')
      .select('*')
      .eq('document_key', documentKey)
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 50);
    throwOnError('listCollaborationSnapshots', error);
    return (data ?? []).map(mapCollaborationSnapshotRow);
  }

  async getCollaborationSnapshotById(
    snapshotId: string,
  ): Promise<CollaborationSnapshotRow | null> {
    const { data, error } = await this.db()
      .from('collaboration_snapshot')
      .select('*')
      .eq('snapshot_id', snapshotId)
      .maybeSingle();
    throwOnError('getCollaborationSnapshotById', error);
    return data ? mapCollaborationSnapshotRow(data) : null;
  }

  async createCollaborationSnapshot(input: {
    snapshotId: string;
    documentKey: string;
    documentId: string;
    storageRef: string;
    stateVector?: string | null;
    byteLength?: number;
    createdByUserId?: string;
    name?: string | null;
    createdAt?: Date;
  }): Promise<CollaborationSnapshotRow> {
    const { data, error } = await this.db()
      .from('collaboration_snapshot')
      .insert({
        snapshot_id: input.snapshotId,
        document_key: input.documentKey,
        document_id: input.documentId,
        state_vector: input.stateVector ?? null,
        storage_ref: input.storageRef,
        byte_length: input.byteLength ?? null,
        created_by_user_id: input.createdByUserId ?? null,
        created_at: (input.createdAt ?? new Date()).toISOString(),
        name: input.name ?? null,
      })
      .select('*')
      .single();
    throwOnError('createCollaborationSnapshot', error);
    return mapCollaborationSnapshotRow(data as Record<string, unknown>);
  }

  async updateCollaborationSnapshotPreview(input: {
    snapshotId: string;
    previewStorageRef?: string | null;
    previewContentType?: string | null;
    previewByteLength?: number | null;
  }): Promise<CollaborationSnapshotRow | null> {
    const patch: Record<string, unknown> = {};
    if (input.previewStorageRef !== undefined) {
      patch.preview_storage_ref = input.previewStorageRef;
    }
    if (input.previewContentType !== undefined) {
      patch.preview_content_type = input.previewContentType;
    }
    if (input.previewByteLength !== undefined) {
      patch.preview_byte_length = input.previewByteLength;
    }
    if (Object.keys(patch).length === 0) {
      return this.getCollaborationSnapshotById(input.snapshotId);
    }
    const { data, error } = await this.db()
      .from('collaboration_snapshot')
      .update(patch)
      .eq('snapshot_id', input.snapshotId)
      .select('*')
      .maybeSingle();
    throwOnError('updateCollaborationSnapshotPreview', error);
    return data ? mapCollaborationSnapshotRow(data) : null;
  }

  // ─── Project Comments ────────────────────────────────────────────────────────

  async createProjectComment(row: {
    commentId: string;
    projectId: string;
    documentId?: string;
    assetId?: string;
    authorUserId: string;
    parentCommentId?: string;
    body: string;
    anchor?: Record<string, unknown>;
  }): Promise<ProjectCommentRow> {
    this.logger.debug(`createProjectComment: ${row.commentId}`);
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('project_comment')
      .insert({
        comment_id: row.commentId,
        project_id: row.projectId,
        document_id: row.documentId ?? null,
        asset_id: row.assetId ?? null,
        author_user_id: row.authorUserId,
        parent_comment_id: row.parentCommentId ?? null,
        body: row.body,
        status: 'open',
        anchor_json: row.anchor ?? null,
        anchor_id: row.anchor?.objectId ?? row.anchor?.blockId ?? null,
        anchor_type: row.documentId ? 'document' : row.assetId ? 'asset' : null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    throwOnError('createProjectComment', error);
    return mapProjectCommentRow(data);
  }

  async getProjectComment(
    commentId: string,
  ): Promise<ProjectCommentRow | null> {
    const { data, error } = await this.db()
      .from('project_comment')
      .select('*')
      .eq('comment_id', commentId)
      .maybeSingle();
    throwOnError('getProjectComment', error);
    return data ? mapProjectCommentRow(data) : null;
  }

  async listProjectComments(
    projectId: string,
    opts: { documentId?: string; includeDeleted?: boolean } = {},
  ): Promise<ProjectCommentRow[]> {
    let query = this.db()
      .from('project_comment')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (opts.documentId) query = query.eq('document_id', opts.documentId);
    if (!opts.includeDeleted) query = query.neq('status', 'deleted');

    const { data, error } = await query;
    throwOnError('listProjectComments', error);
    return (data ?? []).map(mapProjectCommentRow);
  }

  async updateProjectComment(
    commentId: string,
    patch: { body?: string },
  ): Promise<ProjectCommentRow | null> {
    const { data, error } = await this.db()
      .from('project_comment')
      .update({ body: patch.body, updated_at: new Date().toISOString() })
      .eq('comment_id', commentId)
      .select('*')
      .maybeSingle();
    throwOnError('updateProjectComment', error);
    return data ? mapProjectCommentRow(data) : null;
  }

  async resolveProjectComment(
    commentId: string,
    resolvedByUserId: string,
    resolved: boolean,
  ): Promise<ProjectCommentRow | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('project_comment')
      .update({
        status: resolved ? 'resolved' : 'open',
        resolved: resolved,
        resolved_by_user_id: resolved ? resolvedByUserId : null,
        resolved_at: resolved ? now : null,
        updated_at: now,
      })
      .eq('comment_id', commentId)
      .select('*')
      .maybeSingle();
    throwOnError('resolveProjectComment', error);
    return data ? mapProjectCommentRow(data) : null;
  }

  async deleteProjectComment(commentId: string): Promise<void> {
    const { error } = await this.db()
      .from('project_comment')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('comment_id', commentId);
    throwOnError('deleteProjectComment', error);
  }

  // ─── Collaboration Activity (durable generation/import/sync jobs) ──────────

  async createCollaborationActivity(row: {
    activityId: string;
    projectId: string;
    documentId?: string;
    documentType?: CollaborationDocumentType;
    requestId?: string;
    actorUserId: string;
    activityType: CollaborationActivityType;
    status?: CollaborationActivityStatus;
    target?: Record<string, unknown>;
    result?: Record<string, unknown>;
    workflowId?: string;
    nodeId?: string;
    runId?: string;
    actionKind?: string;
  }): Promise<CollaborationActivityRow> {
    this.logger.debug(
      `createCollaborationActivity: ${row.activityId} (${row.activityType})`,
    );
    const now = new Date().toISOString();
    const { data, error } = await this.db()
      .from('collaboration_activity')
      .insert({
        activity_id: row.activityId,
        project_id: row.projectId,
        document_id: row.documentId ?? null,
        document_type: row.documentType ?? null,
        request_id: row.requestId ?? null,
        actor_user_id: row.actorUserId,
        activity_type: row.activityType,
        status: row.status ?? 'pending',
        target_json: row.target ?? null,
        result_json: row.result ?? null,
        workflow_id: row.workflowId ?? null,
        node_id: row.nodeId ?? null,
        run_id: row.runId ?? null,
        action_kind: row.actionKind ?? null,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();
    throwOnError('createCollaborationActivity', error);
    return mapCollaborationActivityRow(data);
  }

  async getCollaborationActivityByRunId(
    projectId: string,
    documentId: string,
    runId: string,
  ): Promise<CollaborationActivityRow | null> {
    const { data, error } = await this.db()
      .from('collaboration_activity')
      .select('*')
      .eq('project_id', projectId)
      .eq('document_id', documentId)
      .eq('run_id', runId)
      .maybeSingle();
    throwOnError('getCollaborationActivityByRunId', error);
    return data ? mapCollaborationActivityRow(data) : null;
  }

  async getCollaborationActivity(
    activityId: string,
  ): Promise<CollaborationActivityRow | null> {
    const { data, error } = await this.db()
      .from('collaboration_activity')
      .select('*')
      .eq('activity_id', activityId)
      .maybeSingle();
    throwOnError('getCollaborationActivity', error);
    return data ? mapCollaborationActivityRow(data) : null;
  }

  async updateCollaborationActivity(
    activityId: string,
    patch: {
      status?: CollaborationActivityStatus;
      result?: Record<string, unknown>;
      errorMessage?: string;
      reconciled?: boolean;
    },
  ): Promise<CollaborationActivityRow | null> {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.result !== undefined) update.result_json = patch.result;
    if (patch.errorMessage !== undefined)
      update.error_message = patch.errorMessage;
    if (patch.reconciled !== undefined) {
      update.reconciled_at = patch.reconciled ? new Date().toISOString() : null;
    }

    const { data, error } = await this.db()
      .from('collaboration_activity')
      .update(update)
      .eq('activity_id', activityId)
      .select('*')
      .maybeSingle();
    throwOnError('updateCollaborationActivity', error);
    return data ? mapCollaborationActivityRow(data) : null;
  }

  async listActiveCollaborationActivity(
    projectId: string,
  ): Promise<CollaborationActivityRow[]> {
    const { data, error } = await this.db()
      .from('collaboration_activity')
      .select('*')
      .eq('project_id', projectId)
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false });
    throwOnError('listActiveCollaborationActivity', error);
    return (data ?? []).map(mapCollaborationActivityRow);
  }

  async listUnreconciledCollaborationActivity(
    projectId: string,
    documentId?: string,
  ): Promise<CollaborationActivityRow[]> {
    let query = this.db()
      .from('collaboration_activity')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'completed')
      .is('reconciled_at', null)
      .order('created_at', { ascending: false });
    if (documentId) query = query.eq('document_id', documentId);

    const { data, error } = await query;
    throwOnError('listUnreconciledCollaborationActivity', error);
    return (data ?? []).map(mapCollaborationActivityRow);
  }

  async getProjectAssetByRequestId(
    projectId: string,
    requestId: string,
  ): Promise<ProjectAssetRow | null> {
    const { data, error } = await this.db()
      .from('project_asset')
      .select('*')
      .eq('project_id', projectId)
      .eq('request_id', requestId)
      .maybeSingle();
    throwOnError('getProjectAssetByRequestId', error);
    return data ? mapProjectAssetRow(data) : null;
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
    this.logger.debug(
      `upsertProviderCredential: ${row.userId} / ${row.provider}`,
    );
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
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

function throwOnError(
  context: string,
  error: { message: string } | null,
): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function isMissingExtendedUserProfileColumns(error: {
  message: string;
}): boolean {
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
    resultJson:
      (row.result_json as Record<string, unknown> | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapGenerationUsageEventRow(
  row: Record<string, unknown>,
): GenerationUsageEventRow {
  return {
    eventId: row.event_id as string,
    requestId: row.request_id as string,
    projectId: row.project_id as string,
    actorUserId: row.actor_user_id as string,
    provider: row.provider as string,
    modelId: (row.model_id as string | null) ?? undefined,
    surface: row.surface as string,
    actionKind: (row.action_kind as string | null) ?? undefined,
    requestType: row.request_type as string,
    usage: (row.usage_json as Record<string, unknown>) ?? {},
    estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
    currency: (row.currency as string) ?? 'USD',
    billable: Boolean(row.billable),
    createdAt: new Date(row.created_at as string),
    documentId: (row.document_id as string | null) ?? undefined,
    threadId: (row.thread_id as string | null) ?? undefined,
    runId: (row.run_id as string | null) ?? undefined,
    stage: (row.stage as string | null) ?? undefined,
    providerRequestId: (row.provider_request_id as string | null) ?? undefined,
    requestedModel: (row.requested_model as string | null) ?? undefined,
    actualModel: (row.actual_model as string | null) ?? undefined,
    modelPresetId: (row.model_preset_id as string | null) ?? undefined,
    promptVersion: (row.prompt_version as string | null) ?? undefined,
    schemaVersion: (row.schema_version as string | null) ?? undefined,
    contextManifestVersion:
      (row.context_manifest_version as string | null) ?? undefined,
    providerCostUsd:
      row.provider_cost_usd == null
        ? undefined
        : Number(row.provider_cost_usd),
    priceTableVersion: (row.price_table_version as string | null) ?? undefined,
    latencyMs: row.latency_ms == null ? undefined : Number(row.latency_ms),
    retryCount: row.retry_count == null ? undefined : Number(row.retry_count),
    repairAttempts:
      row.repair_attempts == null ? undefined : Number(row.repair_attempts),
    outcome: (row.outcome as string | null) ?? undefined,
    errorCategory: (row.error_category as string | null) ?? undefined,
    imageCount: row.image_count == null ? undefined : Number(row.image_count),
  };
}

function mapUserProfileRow(row: Record<string, unknown>): UserProfileRow {
  const onDemandRaw = row.on_demand_json as {
    monthlyCap?: number | null;
  } | null;
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
    createdAt: new Date(
      (row.created_at as string) ?? (row.updated_at as string),
    ),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapProjectRow(row: Record<string, unknown>): ProjectRow {
  return {
    projectId: row.project_id as string,
    ownerUserId: row.owner_user_id as string,
    organizationId: (row.organization_id as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? undefined,
    workspaceMode: row.workspace_mode as ProjectWorkspaceMode,
    status: row.status as ProjectStatus,
    iconAssetId: (row.icon_asset_id as string | null) ?? undefined,
    metadata:
      (row.metadata_json as Record<string, unknown> | null) ?? undefined,
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
    projectId: (row.project_id as string | null) ?? null,
    localProjectId: (row.local_project_id as string | null) ?? null,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
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
    metadata:
      (row.metadata_json as Record<string, unknown> | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapRiggingJobRow(row: Record<string, unknown>): RiggingJobRow {
  return {
    jobId: row.job_id as string,
    userId: row.user_id as string,
    projectId: (row.project_id as string | null) ?? null,
    localProjectId: (row.local_project_id as string | null) ?? null,
    sourceAssetId: row.source_asset_id as string,
    outputAssetId: row.output_asset_id as string,
    workerJobId: (row.worker_job_id as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    status: row.status as RiggingJobStatus,
    simplify: Boolean(row.simplify),
    targetFaceCount: Number(row.target_face_count ?? 8192),
    errorMessage: (row.error_message as string | null) ?? null,
    resultJson: (row.result_json as Record<string, unknown> | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapMesh2MotionJobRow(row: Record<string, unknown>): Mesh2MotionJobRow {
  const rawNames = row.animation_names;
  let animationNames: string[] | null = null;
  if (Array.isArray(rawNames)) {
    animationNames = rawNames.filter((n): n is string => typeof n === 'string');
  }

  return {
    jobId: row.job_id as string,
    userId: row.user_id as string,
    projectId: (row.project_id as string | null) ?? null,
    localProjectId: (row.local_project_id as string | null) ?? null,
    sourceAssetId: row.source_asset_id as string,
    outputAssetId: row.output_asset_id as string,
    workerJobId: (row.worker_job_id as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    status: row.status as Mesh2MotionJobStatus,
    skeletonType: row.skeleton_type as string,
    animationNames,
    errorMessage: (row.error_message as string | null) ?? null,
    resultJson: (row.result_json as Record<string, unknown> | null) ?? null,
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
    consumedAt: row.consumed_at
      ? new Date(row.consumed_at as string)
      : undefined,
    createdAt: new Date(row.created_at as string),
  };
}

function mapCollaborationDocumentRow(
  row: Record<string, unknown>,
): CollaborationDocumentRow {
  return {
    documentKey: row.document_key as string,
    documentId: row.document_id as string,
    projectId: row.project_id as string,
    documentType: row.document_type as CollaborationDocumentType,
    title: (row.title as string | null) ?? 'Untitled',
    storageRef: (row.storage_ref as string | null) ?? undefined,
    version: Number(row.version ?? 0),
    createdByUserId: (row.created_by_user_id as string | null) ?? undefined,
    updatedByUserId: (row.updated_by_user_id as string | null) ?? undefined,
    archivedAt: row.archived_at
      ? new Date(row.archived_at as string)
      : undefined,
    metadata:
      (row.metadata_json as Record<string, unknown> | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapCollaborationSnapshotRow(
  row: Record<string, unknown>,
): CollaborationSnapshotRow {
  return {
    snapshotId: row.snapshot_id as string,
    documentKey: row.document_key as string,
    documentId: row.document_id as string,
    stateVector: (row.state_vector as string | null) ?? undefined,
    storageRef: row.storage_ref as string,
    byteLength: row.byte_length != null ? Number(row.byte_length) : undefined,
    createdByUserId: (row.created_by_user_id as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    name: (row.name as string | null) ?? null,
    previewStorageRef: (row.preview_storage_ref as string | null) ?? null,
    previewContentType: (row.preview_content_type as string | null) ?? null,
    previewByteLength:
      row.preview_byte_length != null
        ? Number(row.preview_byte_length)
        : null,
  };
}

function mapProjectCommentRow(row: Record<string, unknown>): ProjectCommentRow {
  return {
    commentId: row.comment_id as string,
    projectId: row.project_id as string,
    documentId: (row.document_id as string | null) ?? undefined,
    assetId: (row.asset_id as string | null) ?? undefined,
    authorUserId: row.author_user_id as string,
    parentCommentId: (row.parent_comment_id as string | null) ?? undefined,
    body: row.body as string,
    status:
      (row.status as ProjectCommentRow['status']) ??
      (row.resolved ? 'resolved' : 'open'),
    anchor: (row.anchor_json as Record<string, unknown> | null) ?? undefined,
    resolvedByUserId: (row.resolved_by_user_id as string | null) ?? undefined,
    resolvedAt: row.resolved_at
      ? new Date(row.resolved_at as string)
      : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapCollaborationActivityRow(
  row: Record<string, unknown>,
): CollaborationActivityRow {
  return {
    activityId: row.activity_id as string,
    projectId: row.project_id as string,
    documentId: (row.document_id as string | null) ?? undefined,
    documentType:
      (row.document_type as CollaborationDocumentType | null) ?? undefined,
    requestId: (row.request_id as string | null) ?? undefined,
    actorUserId: row.actor_user_id as string,
    activityType: row.activity_type as CollaborationActivityType,
    status: row.status as CollaborationActivityStatus,
    target: (row.target_json as Record<string, unknown> | null) ?? undefined,
    result: (row.result_json as Record<string, unknown> | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    reconciledAt: row.reconciled_at
      ? new Date(row.reconciled_at as string)
      : undefined,
    workflowId: (row.workflow_id as string | null) ?? undefined,
    nodeId: (row.node_id as string | null) ?? undefined,
    runId: (row.run_id as string | null) ?? undefined,
    actionKind: (row.action_kind as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
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
    acceptedAt: row.accepted_at
      ? new Date(row.accepted_at as string)
      : undefined,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : undefined,
    acceptedByUserId: (row.accepted_by_user_id as string | null) ?? undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}
