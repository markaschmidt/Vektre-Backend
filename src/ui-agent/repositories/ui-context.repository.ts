import { Injectable } from '@nestjs/common';
import {
  ContextManifestSchema,
  JsonValueSchema,
  type AgentRun,
  type AgentStep,
  type ContextManifest,
  type JsonValue,
  type ModelInvocationTelemetry,
} from '@markaschmidt/ui-builder-contracts';
import { SupabaseService } from '../../integrations/supabase.js';
import type {
  UiAgentRunRow,
  UiAgentStepRow,
  UiAiBaselineRow,
  UiAgentStageArtifactRow,
  UiAgentAssetRequestRow,
  UiContextManifestRow,
  UiDocumentRevisionRow,
  UiVisibility,
} from '../models/ui-agent.model.js';

@Injectable()
export class UiContextRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private db() {
    return this.supabase.getAdminClient();
  }

  async upsertDocumentRevision(input: {
    revisionId: string;
    projectId: string;
    documentId: string;
    documentKey: string;
    documentHash: string;
    snapshotId?: string;
    stateVector?: string;
    structuralDigest: JsonValue;
    layoutFingerprints?: JsonValue;
    sourceSnapshotCreatedAt?: Date;
  }): Promise<UiDocumentRevisionRow> {
    const existing = await this.getDocumentRevisionByHash(
      input.documentKey,
      input.documentHash,
    );
    if (existing) {
      return this.updateDocumentRevisionFields(existing.revisionId, input);
    }

    const inserted = await this.insertDocumentRevision(input);
    if (inserted) return inserted;

    const raced = await this.getDocumentRevisionByHash(
      input.documentKey,
      input.documentHash,
    );
    if (!raced) {
      throw new Error(
        'upsertUiDocumentRevision failed: duplicate document hash without an existing revision',
      );
    }
    return this.updateDocumentRevisionFields(raced.revisionId, input);
  }

  async getDocumentRevisionByHash(
    documentKey: string,
    documentHash: string,
  ): Promise<UiDocumentRevisionRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_document_revision')
        .select('*')
        .eq('document_key', documentKey)
        .eq('document_hash', documentHash)
        .maybeSingle(),
    );
    assertNoError('getUiDocumentRevisionByHash', error);
    return data ? mapRevision(data) : null;
  }

  private async insertDocumentRevision(input: {
    revisionId: string;
    projectId: string;
    documentId: string;
    documentKey: string;
    documentHash: string;
    snapshotId?: string;
    stateVector?: string;
    structuralDigest: JsonValue;
    layoutFingerprints?: JsonValue;
    sourceSnapshotCreatedAt?: Date;
  }): Promise<UiDocumentRevisionRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_document_revision')
        .insert({
          revision_id: input.revisionId,
          ...documentRevisionFields(input),
        })
        .select('*')
        .single(),
    );
    if (isUniqueViolation(error)) return null;
    assertNoError('insertUiDocumentRevision', error);
    if (!data) {
      throw new Error('insertUiDocumentRevision failed: empty response');
    }
    return mapRevision(data);
  }

  private async updateDocumentRevisionFields(
    revisionId: string,
    input: {
      projectId: string;
      documentId: string;
      documentKey: string;
      documentHash: string;
      snapshotId?: string;
      stateVector?: string;
      structuralDigest: JsonValue;
      layoutFingerprints?: JsonValue;
      sourceSnapshotCreatedAt?: Date;
    },
  ): Promise<UiDocumentRevisionRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_document_revision')
        .update(documentRevisionFields(input))
        .eq('revision_id', revisionId)
        .select('*')
        .single(),
    );
    assertNoError('updateUiDocumentRevision', error);
    return mapRevision(data);
  }

  async getLatestDocumentRevision(
    documentKey: string,
  ): Promise<UiDocumentRevisionRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_document_revision')
        .select('*')
        .eq('document_key', documentKey)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    assertNoError('getLatestUiDocumentRevision', error);
    return data ? mapRevision(data) : null;
  }

  async getDocumentRevision(
    revisionId: string,
  ): Promise<UiDocumentRevisionRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_document_revision')
        .select('*')
        .eq('revision_id', revisionId)
        .maybeSingle(),
    );
    assertNoError('getUiDocumentRevision', error);
    return data ? mapRevision(data) : null;
  }

  async getBaseline(documentKey: string): Promise<UiAiBaselineRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_ai_baseline')
        .select('*')
        .eq('document_key', documentKey)
        .maybeSingle(),
    );
    assertNoError('getUiAiBaseline', error);
    return data ? mapBaseline(data) : null;
  }

  async upsertBaseline(input: {
    documentKey: string;
    projectId: string;
    documentId: string;
    revisionId?: string;
    runId?: string;
    activityId?: string;
    documentHash: string;
    proposalHash?: string;
    reconciledAt: Date;
  }): Promise<UiAiBaselineRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_ai_baseline')
        .upsert(
          {
            document_key: input.documentKey,
            project_id: input.projectId,
            document_id: input.documentId,
            revision_id: input.revisionId ?? null,
            run_id: input.runId ?? null,
            activity_id: input.activityId ?? null,
            document_hash: input.documentHash,
            proposal_hash: input.proposalHash ?? null,
            reconciled_at: input.reconciledAt.toISOString(),
          },
          { onConflict: 'document_key' },
        )
        .select('*')
        .single(),
    );
    assertNoError('upsertUiAiBaseline', error);
    return mapBaseline(data);
  }

  async createRun(input: {
    runId: string;
    requestId: string;
    activityId?: string;
    projectId: string;
    documentId: string;
    documentKey: string;
    threadId?: string;
    actorUserId: string;
    ownerUserId: string;
    visibility: UiVisibility;
    status: AgentRun['status'];
    intent: string;
    baseDocumentHash: string;
    frozenRevisionId?: string;
    messageId?: string;
    modelPresetId?: string;
    mutating?: boolean;
  }): Promise<UiAgentRunRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_agent_run')
        .insert({
          run_id: input.runId,
          request_id: input.requestId,
          activity_id: input.activityId ?? null,
          project_id: input.projectId,
          document_id: input.documentId,
          document_key: input.documentKey,
          thread_id: input.threadId ?? null,
          actor_user_id: input.actorUserId,
          owner_user_id: input.ownerUserId,
          visibility: input.visibility,
          status: input.status,
          intent: input.intent,
          base_document_hash: input.baseDocumentHash,
          frozen_revision_id: input.frozenRevisionId ?? null,
          message_id: input.messageId ?? null,
          model_preset_id: input.modelPresetId ?? null,
          mutating: input.mutating ?? true,
        })
        .select('*')
        .single(),
    );
    assertNoError('createUiAgentRun', error);
    return mapRun(data);
  }

  async getRun(
    projectId: string,
    documentId: string,
    runId: string,
  ): Promise<UiAgentRunRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_agent_run')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .eq('run_id', runId)
        .maybeSingle(),
    );
    assertNoError('getUiAgentRun', error);
    return data ? mapRun(data) : null;
  }

  async getRunByRequest(
    projectId: string,
    requestId: string,
  ): Promise<UiAgentRunRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_agent_run')
        .select('*')
        .eq('project_id', projectId)
        .eq('request_id', requestId)
        .maybeSingle(),
    );
    assertNoError('getUiAgentRunByRequest', error);
    return data ? mapRun(data) : null;
  }

  async getActiveMutatingRun(
    documentKey: string,
  ): Promise<UiAgentRunRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_agent_run')
        .select('*')
        .eq('document_key', documentKey)
        .eq('mutating', true)
        .not('status', 'in', '("completed","failed","cancelled")')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    );
    assertNoError('getActiveMutatingUiAgentRun', error);
    return data ? mapRun(data) : null;
  }

  async listRunsByStatus(
    status: AgentRun['status'],
    limit = 500,
  ): Promise<UiAgentRunRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('ui_agent_run')
        .select('*')
        .eq('status', status)
        .order('updated_at', { ascending: true })
        .limit(limit),
    );
    assertNoError('listUiAgentRunsByStatus', error);
    return (data ?? []).map(mapRun);
  }

  async expireAbandonedRuns(now = new Date()): Promise<UiAgentRunRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('ui_agent_run')
        .update({
          status: 'failed',
          error_code: 'review_expired',
          error_message: 'The paused UI-agent run expired before review',
          completed_at: now.toISOString(),
        })
        .in('status', [
          'awaiting_clarification',
          'awaiting_review',
          'needs_rebase',
        ])
        .lt('content_expires_at', now.toISOString())
        .select('*'),
    );
    assertNoError('expireAbandonedUiAgentRuns', error);
    return (data ?? []).map(mapRun);
  }

  async transitionRun(input: {
    runId: string;
    expectedStatuses: AgentRun['status'][];
    status: AgentRun['status'];
    result?: JsonValue;
    proposalHash?: string;
    review?: JsonValue;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<UiAgentRunRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db().rpc('transition_ui_agent_run', {
        p_run_id: input.runId,
        p_expected_statuses: input.expectedStatuses,
        p_next_status: input.status,
        p_result_json: input.result ?? null,
        p_proposal_hash: input.proposalHash ?? null,
        p_review_json: input.review ?? null,
        p_error_code: input.errorCode ?? null,
        p_error_message: input.errorMessage ?? null,
      }),
    );
    assertNoError('transitionUiAgentRun', error);
    return data ? mapRun(data) : null;
  }

  async markRunReconciled(runId: string): Promise<UiAgentRunRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_agent_run')
        .update({ reconciled_at: new Date().toISOString() })
        .eq('run_id', runId)
        .is('reconciled_at', null)
        .select('*')
        .maybeSingle(),
    );
    assertNoError('reconcileUiAgentRun', error);
    return data ? mapRun(data) : null;
  }

  async updateRunRebaseBase(input: {
    runId: string;
    documentHash: string;
    revisionId: string;
  }): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_agent_run')
        .update({
          base_document_hash: input.documentHash,
          frozen_revision_id: input.revisionId,
        })
        .eq('run_id', input.runId)
        .eq('status', 'validating'),
    );
    assertNoError('updateUiAgentRunRebaseBase', error);
  }

  async createStep(input: {
    stepId: string;
    runId: string;
    projectId: string;
    stageExecutionId: string;
    stage: AgentStep['stage'];
    attempt: number;
    idempotencyKey: string;
    status: AgentStep['status'];
    inputRef?: string;
    ownerUserId: string;
    visibility: UiVisibility;
  }): Promise<UiAgentStepRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_agent_step')
        .insert({
          step_id: input.stepId,
          run_id: input.runId,
          project_id: input.projectId,
          stage_execution_id: input.stageExecutionId,
          stage: input.stage,
          attempt: input.attempt,
          idempotency_key: input.idempotencyKey,
          status: input.status,
          input_ref: input.inputRef ?? null,
          owner_user_id: input.ownerUserId,
          visibility: input.visibility,
        })
        .select('*')
        .single(),
    );
    assertNoError('createUiAgentStep', error);
    return mapStep(data);
  }

  async getStepByStageExecution(
    stageExecutionId: string,
  ): Promise<UiAgentStepRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_agent_step')
        .select('*')
        .eq('stage_execution_id', stageExecutionId)
        .maybeSingle(),
    );
    assertNoError('getUiAgentStepByStageExecution', error);
    return data ? mapStep(data) : null;
  }

  async listSteps(runId: string): Promise<UiAgentStepRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('ui_agent_step')
        .select('*')
        .eq('run_id', runId)
        .order('created_at', { ascending: true }),
    );
    assertNoError('listUiAgentSteps', error);
    return (data ?? []).map(mapStep);
  }

  async listPendingTransitionJobs(limit = 500): Promise<
    Array<{
      projectId: string;
      documentId: string;
      runId: string;
      stageExecutionId: string;
    }>
  > {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('ui_agent_step')
        .select(
          'project_id, run_id, stage_execution_id, ui_agent_run!inner(document_id, status)',
        )
        .eq('status', 'pending')
        .not('ui_agent_run.status', 'in', '("completed","failed","cancelled")')
        .limit(limit),
    );
    assertNoError('listPendingUiAgentTransitions', error);
    return (data ?? []).map((row) => {
      const joined = row.ui_agent_run as
        | Record<string, unknown>
        | Record<string, unknown>[];
      const run = Array.isArray(joined) ? joined[0] : joined;
      return {
        projectId: row.project_id as string,
        documentId: run?.document_id as string,
        runId: row.run_id as string,
        stageExecutionId: row.stage_execution_id as string,
      };
    });
  }

  async claimStep(stageExecutionId: string): Promise<UiAgentStepRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db().rpc('claim_ui_agent_step', {
        p_stage_execution_id: stageExecutionId,
      }),
    );
    assertNoError('claimUiAgentStep', error);
    return data ? mapStep(data) : null;
  }

  async setStepInputRef(
    stageExecutionId: string,
    inputRef: string,
  ): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_agent_step')
        .update({ input_ref: inputRef })
        .eq('stage_execution_id', stageExecutionId)
        .is('input_ref', null),
    );
    assertNoError('setUiAgentStepInputRef', error);
  }

  async completeStep(input: {
    stageExecutionId: string;
    outputRef: string;
    usage?: JsonValue;
  }): Promise<UiAgentStepRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db().rpc('complete_ui_agent_step', {
        p_stage_execution_id: input.stageExecutionId,
        p_output_ref: input.outputRef,
        p_usage_json: input.usage ?? null,
      }),
    );
    assertNoError('completeUiAgentStep', error);
    return data ? mapStep(data) : null;
  }

  async failStep(input: {
    stageExecutionId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<UiAgentStepRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db().rpc('fail_ui_agent_step', {
        p_stage_execution_id: input.stageExecutionId,
        p_error_code: input.errorCode,
        p_error_message: input.errorMessage,
      }),
    );
    assertNoError('failUiAgentStep', error);
    return data ? mapStep(data) : null;
  }

  async cancelPendingSteps(runId: string): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_agent_step')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        })
        .eq('run_id', runId)
        .in('status', ['pending', 'running']),
    );
    assertNoError('cancelUiAgentSteps', error);
  }

  async saveStageArtifact(input: {
    artifactId: string;
    runId: string;
    stepId?: string;
    projectId: string;
    documentId: string;
    ownerUserId: string;
    visibility: UiVisibility;
    artifactKind: UiAgentStageArtifactRow['artifactKind'];
    contentHash: string;
    payload: JsonValue;
  }): Promise<UiAgentStageArtifactRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_agent_stage_artifact')
        .upsert(
          {
            artifact_id: input.artifactId,
            run_id: input.runId,
            step_id: input.stepId ?? null,
            project_id: input.projectId,
            document_id: input.documentId,
            owner_user_id: input.ownerUserId,
            visibility: input.visibility,
            artifact_kind: input.artifactKind,
            content_hash: input.contentHash,
            payload_json: input.payload,
          },
          { onConflict: 'step_id,artifact_kind' },
        )
        .select('*')
        .single(),
    );
    assertNoError('saveUiAgentStageArtifact', error);
    return mapStageArtifact(data);
  }

  async getStageArtifact(
    artifactId: string,
  ): Promise<UiAgentStageArtifactRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_agent_stage_artifact')
        .select('*')
        .eq('artifact_id', artifactId)
        .maybeSingle(),
    );
    assertNoError('getUiAgentStageArtifact', error);
    return data ? mapStageArtifact(data) : null;
  }

  async listStageArtifacts(
    runId: string,
    artifactKind?: UiAgentStageArtifactRow['artifactKind'],
  ): Promise<UiAgentStageArtifactRow[]> {
    let query = this.db()
      .from('ui_agent_stage_artifact')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true });
    if (artifactKind) query = query.eq('artifact_kind', artifactKind);
    const { data, error } = queryResult<Record<string, unknown>[]>(await query);
    assertNoError('listUiAgentStageArtifacts', error);
    return (data ?? []).map(mapStageArtifact);
  }

  async upsertAssetRequest(input: {
    requestId: string;
    runId: string;
    stepId: string;
    projectId: string;
    requestKey: string;
    assetRole: string;
    preferredAssetId: string;
  }): Promise<UiAgentAssetRequestRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_agent_asset_request')
        .upsert(
          {
            request_id: input.requestId,
            run_id: input.runId,
            step_id: input.stepId,
            project_id: input.projectId,
            request_key: input.requestKey,
            asset_role: input.assetRole,
            preferred_asset_id: input.preferredAssetId,
          },
          { onConflict: 'run_id,request_key' },
        )
        .select('*')
        .single(),
    );
    assertNoError('upsertUiAgentAssetRequest', error);
    return mapAssetRequest(data);
  }

  async listAssetRequests(runId: string): Promise<UiAgentAssetRequestRow[]> {
    const { data, error } = queryResult<Record<string, unknown>[]>(
      await this.db()
        .from('ui_agent_asset_request')
        .select('*')
        .eq('run_id', runId)
        .order('created_at', { ascending: true }),
    );
    assertNoError('listUiAgentAssetRequests', error);
    return (data ?? []).map(mapAssetRequest);
  }

  async updateAssetRequest(input: {
    requestId: string;
    status: UiAgentAssetRequestRow['status'];
    assetId?: string;
    errorMessage?: string;
  }): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_agent_asset_request')
        .update({
          status: input.status,
          asset_id: input.assetId ?? null,
          error_message: input.errorMessage ?? null,
        })
        .eq('request_id', input.requestId),
    );
    assertNoError('updateUiAgentAssetRequest', error);
  }

  async saveContextManifest(input: {
    manifest: ContextManifest;
    manifestHash: string;
    documentId: string;
    threadId?: string;
    actorUserId: string;
    ownerUserId: string;
    visibility: UiVisibility;
  }): Promise<UiContextManifestRow> {
    const manifest = ContextManifestSchema.parse(input.manifest);
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_context_manifest')
        .upsert(
          {
            manifest_id: manifest.manifestId,
            run_id: manifest.runId,
            project_id: manifest.projectId,
            document_id: input.documentId,
            thread_id: input.threadId ?? null,
            actor_user_id: input.actorUserId,
            owner_user_id: input.ownerUserId,
            visibility: input.visibility,
            document_revision: manifest.documentRevision,
            document_hash: manifest.documentHash,
            model_preset_id: manifest.modelPresetId,
            total_token_budget: manifest.totalTokenBudget,
            estimated_tokens: manifest.estimatedTokens,
            manifest_hash: input.manifestHash,
            manifest_json: manifest,
          },
          { onConflict: 'run_id' },
        )
        .select('*')
        .single(),
    );
    assertNoError('saveUiContextManifest', error);
    const row = mapManifest(data);

    const { error: runError } = queryResult<null>(
      await this.db()
        .from('ui_agent_run')
        .update({ context_manifest_id: row.manifestId })
        .eq('run_id', row.runId),
    );
    assertNoError('linkUiContextManifest', runError);
    return row;
  }

  async getContextManifestByRun(
    projectId: string,
    documentId: string,
    runId: string,
  ): Promise<UiContextManifestRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_context_manifest')
        .select('*')
        .eq('project_id', projectId)
        .eq('document_id', documentId)
        .eq('run_id', runId)
        .maybeSingle(),
    );
    assertNoError('getUiContextManifestByRun', error);
    return data ? mapManifest(data) : null;
  }

  async upsertArtifactRelation(input: {
    relationId: string;
    projectId: string;
    documentId?: string;
    threadId?: string;
    ownerUserId: string;
    visibility: UiVisibility;
    sourceKind: string;
    sourceId: string;
    sourceHash?: string;
    relationKind: string;
    targetKind: string;
    targetId: string;
    targetHash?: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_artifact_relation')
        .upsert(
          {
            relation_id: input.relationId,
            project_id: input.projectId,
            document_id: input.documentId ?? null,
            thread_id: input.threadId ?? null,
            owner_user_id: input.ownerUserId,
            visibility: input.visibility,
            source_kind: input.sourceKind,
            source_id: input.sourceId,
            source_hash: input.sourceHash ?? null,
            relation_kind: input.relationKind,
            target_kind: input.targetKind,
            target_id: input.targetId,
            target_hash: input.targetHash ?? null,
            metadata_json: input.metadata,
          },
          {
            onConflict:
              'project_id,source_kind,source_id,relation_kind,target_kind,target_id,visibility,owner_user_id',
          },
        ),
    );
    assertNoError('upsertUiArtifactRelation', error);
  }

  async upsertArtifactEmbedding(input: {
    embeddingId: string;
    projectId: string;
    documentId?: string;
    threadId?: string;
    ownerUserId: string;
    visibility: UiVisibility;
    sourceKind: string;
    sourceId: string;
    sourceHash: string;
    model: string;
    version: string;
    embedding: number[];
  }): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_artifact_embedding')
        .upsert(
          {
            embedding_id: input.embeddingId,
            project_id: input.projectId,
            document_id: input.documentId ?? null,
            thread_id: input.threadId ?? null,
            owner_user_id: input.ownerUserId,
            visibility: input.visibility,
            source_kind: input.sourceKind,
            source_id: input.sourceId,
            source_hash: input.sourceHash,
            embedding_model: input.model,
            embedding_version: input.version,
            embedding_json: input.embedding,
            dimensions: input.embedding.length,
          },
          {
            onConflict:
              'project_id,source_kind,source_id,source_hash,embedding_model,embedding_version,visibility,owner_user_id',
          },
        ),
    );
    assertNoError('upsertUiArtifactEmbedding', error);
  }

  async recordModelInvocation(input: {
    telemetry: ModelInvocationTelemetry;
    threadId?: string;
    runId?: string;
    stepId?: string;
    ownerUserId: string;
    visibility: UiVisibility;
  }): Promise<void> {
    const event = input.telemetry;
    const existing = await this.findInvocationId(event);
    const invocationId = existing ?? event.invocationId;
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_model_invocation')
        .upsert(
          {
            invocation_id: invocationId,
            project_id: event.projectId,
            document_id: event.documentId,
            thread_id: input.threadId ?? null,
            run_id: input.runId ?? event.runId,
            step_id: input.stepId ?? null,
            stage_execution_id: event.stageExecutionId,
            actor_user_id: event.actorId,
            owner_user_id: input.ownerUserId,
            visibility: input.visibility,
            gateway: event.gateway,
            provider: event.usage.provider,
            requested_model: event.requestedModel,
            actual_model: event.actualModel,
            provider_request_id: event.usage.providerRequestId ?? null,
            prompt_version: event.promptVersion,
            schema_version: event.schemaVersion,
            context_manifest_version: event.contextManifestVersion,
            usage_json: event.usage,
            provider_cost_usd: event.usage.providerCostUsd ?? null,
            estimated_cost_usd: event.estimatedCostUsd ?? null,
            price_table_version: event.priceTableVersion ?? null,
            latency_ms: event.latencyMs,
            retry_count: event.retryCount,
            repair_attempts: event.repairAttempts,
            outcome: event.outcome,
            error_category: event.errorCategory ?? null,
            created_at: event.createdAt,
            model_preset_id: event.modelPresetId ?? null,
            finish_reason: event.finishReason ?? null,
            image_count: event.imageCount ?? null,
            image_width: event.imageWidth ?? null,
            image_height: event.imageHeight ?? null,
            cache_write_tokens: event.cacheWriteTokens ?? null,
            trace_id: event.traceId ?? null,
            span_id: event.spanId ?? null,
          },
          { onConflict: 'invocation_id' },
        ),
    );
    assertNoError('recordUiModelInvocation', error);
  }

  async recordQualityEvent(input: {
    eventId: string;
    projectId: string;
    documentId: string;
    runId?: string;
    threadId?: string;
    ownerUserId: string;
    visibility: UiVisibility;
    metricKind: string;
    metricValue: number;
    documentKind?: string;
    modelPresetId?: string;
    promptVersion?: string;
    schemaVersion?: string;
    dimensions?: Record<string, unknown>;
    createdAt?: Date;
  }): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_agent_quality_event')
        .upsert(
          {
            event_id: input.eventId,
            project_id: input.projectId,
            document_id: input.documentId,
            run_id: input.runId ?? null,
            thread_id: input.threadId ?? null,
            owner_user_id: input.ownerUserId,
            visibility: input.visibility,
            metric_kind: input.metricKind,
            metric_value: input.metricValue,
            document_kind: input.documentKind ?? null,
            model_preset_id: input.modelPresetId ?? null,
            prompt_version: input.promptVersion ?? null,
            schema_version: input.schemaVersion ?? null,
            dimensions_json: input.dimensions ?? {},
            created_at: (input.createdAt ?? new Date()).toISOString(),
          },
          { onConflict: 'event_id' },
        ),
    );
    assertNoError('recordUiAgentQualityEvent', error);
  }

  async getTelemetryPolicy(projectId: string): Promise<{
    contentTraces: boolean;
    zeroRetention: boolean;
    debugContentUntil?: Date;
    allowPrivateAggregates: boolean;
  } | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('project_telemetry_policy')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle(),
    );
    assertNoError('getProjectTelemetryPolicy', error);
    if (!data) return null;
    return {
      contentTraces: Boolean(data.content_traces),
      zeroRetention: Boolean(data.zero_retention),
      debugContentUntil: data.debug_content_until
        ? new Date(data.debug_content_until as string)
        : undefined,
      allowPrivateAggregates: Boolean(data.allow_private_aggregates),
    };
  }

  async listStalledSteps(projectId: string): Promise<
    Array<{
      runId: string;
      stageExecutionId: string;
      stage: string;
      status: string;
      stalledMs: number;
    }>
  > {
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await this.db()
        .from('ui_ops_stalled_stages')
        .select('*')
        .eq('project_id', projectId),
    );
    assertNoError('listStalledUiAgentSteps', error);
    return (data ?? []).map((row) => ({
      runId: row.run_id as string,
      stageExecutionId: row.stage_execution_id as string,
      stage: row.stage as string,
      status: row.status as string,
      stalledMs: Number(row.stalled_ms ?? 0),
    }));
  }

  async listQualityRollup(projectId: string): Promise<
    Array<{
      documentKind?: string;
      modelPresetId?: string;
      promptVersion?: string;
      metricKind: string;
      eventCount: number;
      avgValue: number;
      sumValue: number;
    }>
  > {
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await this.db()
        .from('ui_ops_quality_rollup')
        .select('*')
        .eq('project_id', projectId),
    );
    assertNoError('listUiAgentQualityRollup', error);
    return (data ?? []).map((row) => ({
      documentKind: (row.document_kind as string | null) ?? undefined,
      modelPresetId: (row.model_preset_id as string | null) ?? undefined,
      promptVersion: (row.prompt_version as string | null) ?? undefined,
      metricKind: row.metric_kind as string,
      eventCount: Number(row.event_count ?? 0),
      avgValue: Number(row.avg_value ?? 0),
      sumValue: Number(row.sum_value ?? 0),
    }));
  }

  async listProviderErrorRates(projectId: string): Promise<
    Array<{
      errorCategory: string;
      eventCount: number;
    }>
  > {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await this.db()
        .from('ui_model_invocation')
        .select('error_category')
        .eq('project_id', projectId)
        .gte('created_at', since)
        .not('error_category', 'is', null),
    );
    assertNoError('listUiAgentProviderErrors', error);
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const category = String(row.error_category);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()].map(([errorCategory, eventCount]) => ({
      errorCategory,
      eventCount,
    }));
  }

  private async findInvocationId(
    event: ModelInvocationTelemetry,
  ): Promise<string | undefined> {
    const byStage = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_model_invocation')
        .select('invocation_id')
        .eq('stage_execution_id', event.stageExecutionId)
        .maybeSingle(),
    );
    assertNoError('findUiModelInvocationByStage', byStage.error);
    if (byStage.data?.invocation_id) {
      return byStage.data.invocation_id as string;
    }
    if (!event.usage.providerRequestId) return undefined;
    const byProvider = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_model_invocation')
        .select('invocation_id')
        .eq('provider', event.usage.provider)
        .eq('provider_request_id', event.usage.providerRequestId)
        .maybeSingle(),
    );
    assertNoError('findUiModelInvocationByProviderRequest', byProvider.error);
    return (byProvider.data?.invocation_id as string | undefined) ?? undefined;
  }

  async purgeExpiredContent(): Promise<{
    deletedManifests: number;
    deletedEmbeddings: number;
    redactedRuns: number;
  }> {
    const { data, error } = queryResult<
      Array<{
        deleted_manifests: number | string;
        deleted_embeddings: number | string;
        redacted_runs: number | string;
      }>
    >(await this.db().rpc('purge_expired_ui_agent_content'));
    assertNoError('purgeExpiredUiAgentContent', error);
    const row = data?.[0];
    return {
      deletedManifests: Number(row?.deleted_manifests ?? 0),
      deletedEmbeddings: Number(row?.deleted_embeddings ?? 0),
      redactedRuns: Number(row?.redacted_runs ?? 0),
    };
  }
}

function documentRevisionFields(input: {
  projectId: string;
  documentId: string;
  documentKey: string;
  documentHash: string;
  snapshotId?: string;
  stateVector?: string;
  structuralDigest: JsonValue;
  layoutFingerprints?: JsonValue;
  sourceSnapshotCreatedAt?: Date;
}): Record<string, unknown> {
  return {
    project_id: input.projectId,
    document_id: input.documentId,
    document_key: input.documentKey,
    document_hash: input.documentHash,
    snapshot_id: input.snapshotId ?? null,
    state_vector: input.stateVector ?? null,
    structural_digest_json: input.structuralDigest,
    layout_fingerprints_json: input.layoutFingerprints ?? {},
    source_snapshot_created_at:
      input.sourceSnapshotCreatedAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(
  error: { message: string; code?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === '23505' ||
    /duplicate key|unique constraint/i.test(error.message)
  );
}

function mapRevision(row: Record<string, unknown>): UiDocumentRevisionRow {
  return {
    revisionId: row.revision_id as string,
    projectId: row.project_id as string,
    documentId: row.document_id as string,
    documentKey: row.document_key as string,
    documentHash: row.document_hash as string,
    snapshotId: (row.snapshot_id as string | null) ?? undefined,
    stateVector: (row.state_vector as string | null) ?? undefined,
    structuralDigest: JsonValueSchema.parse(row.structural_digest_json),
    layoutFingerprints: JsonValueSchema.parse(
      row.layout_fingerprints_json ?? {},
    ),
    sourceSnapshotCreatedAt: row.source_snapshot_created_at
      ? new Date(row.source_snapshot_created_at as string)
      : undefined,
    createdAt: new Date(row.created_at as string),
  };
}

function mapBaseline(row: Record<string, unknown>): UiAiBaselineRow {
  return {
    documentKey: row.document_key as string,
    projectId: row.project_id as string,
    documentId: row.document_id as string,
    revisionId: (row.revision_id as string | null) ?? undefined,
    runId: (row.run_id as string | null) ?? undefined,
    activityId: (row.activity_id as string | null) ?? undefined,
    documentHash: row.document_hash as string,
    proposalHash: (row.proposal_hash as string | null) ?? undefined,
    reconciledAt: new Date(row.reconciled_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapRun(row: Record<string, unknown>): UiAgentRunRow {
  return {
    runId: row.run_id as string,
    requestId: row.request_id as string,
    activityId: (row.activity_id as string | null) ?? undefined,
    projectId: row.project_id as string,
    documentId: row.document_id as string,
    documentKey: row.document_key as string,
    threadId: (row.thread_id as string | null) ?? undefined,
    actorUserId: row.actor_user_id as string,
    ownerUserId: row.owner_user_id as string,
    visibility: row.visibility as UiVisibility,
    status: row.status as AgentRun['status'],
    intent: row.intent as string,
    baseDocumentHash: row.base_document_hash as string,
    frozenRevisionId: (row.frozen_revision_id as string | null) ?? undefined,
    contextManifestId: (row.context_manifest_id as string | null) ?? undefined,
    messageId: (row.message_id as string | null) ?? undefined,
    modelPresetId: (row.model_preset_id as string | null) ?? undefined,
    mutating: row.mutating !== false,
    result:
      row.result_json == null
        ? undefined
        : JsonValueSchema.parse(row.result_json),
    proposalHash: (row.proposal_hash as string | null) ?? undefined,
    review:
      row.review_json == null
        ? undefined
        : JsonValueSchema.parse(row.review_json),
    errorCode: (row.error_code as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    cancelRequestedAt: row.cancel_requested_at
      ? new Date(row.cancel_requested_at as string)
      : undefined,
    reconciledAt: row.reconciled_at
      ? new Date(row.reconciled_at as string)
      : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    completedAt: row.completed_at
      ? new Date(row.completed_at as string)
      : undefined,
  };
}

function mapStep(row: Record<string, unknown>): UiAgentStepRow {
  return {
    stepId: row.step_id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    stageExecutionId: row.stage_execution_id as string,
    stage: row.stage as AgentStep['stage'],
    attempt: Number(row.attempt),
    idempotencyKey: row.idempotency_key as string,
    status: row.status as AgentStep['status'],
    inputRef: (row.input_ref as string | null) ?? undefined,
    outputRef: (row.output_ref as string | null) ?? undefined,
    usage:
      row.usage_json == null
        ? undefined
        : JsonValueSchema.parse(row.usage_json),
    errorCode: (row.error_code as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    ownerUserId: row.owner_user_id as string,
    visibility: row.visibility as UiVisibility,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    workerStartedAt: row.worker_started_at
      ? new Date(row.worker_started_at as string)
      : undefined,
    completedAt: row.completed_at
      ? new Date(row.completed_at as string)
      : undefined,
  };
}

function mapStageArtifact(
  row: Record<string, unknown>,
): UiAgentStageArtifactRow {
  return {
    artifactId: row.artifact_id as string,
    runId: row.run_id as string,
    stepId: (row.step_id as string | null) ?? undefined,
    projectId: row.project_id as string,
    documentId: row.document_id as string,
    ownerUserId: row.owner_user_id as string,
    visibility: row.visibility as UiVisibility,
    artifactKind: row.artifact_kind as UiAgentStageArtifactRow['artifactKind'],
    contentHash: row.content_hash as string,
    payload: JsonValueSchema.parse(row.payload_json),
    createdAt: new Date(row.created_at as string),
  };
}

function mapAssetRequest(row: Record<string, unknown>): UiAgentAssetRequestRow {
  return {
    requestId: row.request_id as string,
    runId: row.run_id as string,
    stepId: row.step_id as string,
    projectId: row.project_id as string,
    requestKey: row.request_key as string,
    assetRole: row.asset_role as string,
    preferredAssetId: row.preferred_asset_id as string,
    status: row.status as UiAgentAssetRequestRow['status'],
    assetId: (row.asset_id as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
  };
}

function mapManifest(row: Record<string, unknown>): UiContextManifestRow {
  return {
    manifestId: row.manifest_id as string,
    runId: row.run_id as string,
    projectId: row.project_id as string,
    documentId: row.document_id as string,
    threadId: (row.thread_id as string | null) ?? undefined,
    actorUserId: row.actor_user_id as string,
    ownerUserId: row.owner_user_id as string,
    visibility: row.visibility as UiVisibility,
    manifest: ContextManifestSchema.parse(row.manifest_json),
    manifestHash: row.manifest_hash as string,
    createdAt: new Date(row.created_at as string),
  };
}

function assertNoError(
  operation: string,
  error: { message: string; code?: string } | null,
): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

function queryResult<T>(value: unknown): {
  data: T;
  error: { message: string; code?: string } | null;
} {
  return value as {
    data: T;
    error: { message: string; code?: string } | null;
  };
}
