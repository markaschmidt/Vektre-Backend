import { Injectable } from '@nestjs/common';
import { JsonObjectSchema, type JsonValue } from '@markaschmidt/ui-builder-contracts';
import { SupabaseService } from '../../integrations/supabase.js';
import type {
  CollaborationSnapshotSource,
  UiContextIndexAttemptRow,
  UiRetrievalDocumentInput,
  UiRetrievalResult,
} from './ui-context-index.model.js';

@Injectable()
export class UiContextIndexRepository {
  constructor(private readonly supabase: SupabaseService) {}

  private db() {
    return this.supabase.getAdminClient();
  }

  async getSnapshot(
    documentKey: string,
    snapshotId: string,
  ): Promise<CollaborationSnapshotSource | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('collaboration_snapshot')
        .select(
          'snapshot_id, document_key, state_vector, storage_ref, created_at',
        )
        .eq('document_key', documentKey)
        .eq('snapshot_id', snapshotId)
        .maybeSingle(),
    );
    assertNoError('getUiIndexSnapshot', error);
    return data ? mapSnapshot(data) : null;
  }

  async getLatestSnapshot(
    documentKey: string,
  ): Promise<CollaborationSnapshotSource | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('collaboration_snapshot')
        .select(
          'snapshot_id, document_key, state_vector, storage_ref, created_at',
        )
        .eq('document_key', documentKey)
        .order('created_at', { ascending: false })
        .order('snapshot_id', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    assertNoError('getLatestUiIndexSnapshot', error);
    return data ? mapSnapshot(data) : null;
  }

  async getAttemptBySnapshot(
    snapshotId: string,
  ): Promise<UiContextIndexAttemptRow | null> {
    const { data, error } = queryResult<Record<string, unknown> | null>(
      await this.db()
        .from('ui_context_index_attempt')
        .select('*')
        .eq('snapshot_id', snapshotId)
        .maybeSingle(),
    );
    assertNoError('getUiContextIndexAttempt', error);
    return data ? mapAttempt(data) : null;
  }

  async recordAttempt(input: {
    attemptId: string;
    projectId: string;
    documentId: string;
    documentKey: string;
    snapshotId: string;
    stateVector?: string;
    storageRef: string;
    status: UiContextIndexAttemptRow['status'];
    revisionId?: string;
    documentHash?: string;
    validationIssues: UiContextIndexAttemptRow['validationIssues'];
    errorCode?: string;
    errorMessage?: string;
    startedAt: Date;
  }): Promise<UiContextIndexAttemptRow> {
    const { data, error } = queryResult<Record<string, unknown>>(
      await this.db()
        .from('ui_context_index_attempt')
        .upsert(
          {
            attempt_id: input.attemptId,
            project_id: input.projectId,
            document_id: input.documentId,
            document_key: input.documentKey,
            snapshot_id: input.snapshotId,
            state_vector: input.stateVector ?? null,
            storage_ref: input.storageRef,
            status: input.status,
            revision_id: input.revisionId ?? null,
            document_hash: input.documentHash ?? null,
            validation_issues_json: input.validationIssues,
            error_code: input.errorCode ?? null,
            error_message: input.errorMessage ?? null,
            started_at: input.startedAt.toISOString(),
            completed_at: new Date().toISOString(),
          },
          { onConflict: 'snapshot_id' },
        )
        .select('*')
        .single(),
    );
    assertNoError('recordUiContextIndexAttempt', error);
    return mapAttempt(data);
  }

  async markIndexState(input: {
    projectId: string;
    documentId: string;
    documentKey: string;
    latestSnapshotId: string;
    indexedSnapshotId?: string;
    indexedRevisionId?: string;
    indexedDocumentHash?: string;
    status: 'pending' | 'running' | 'ready' | 'invalid' | 'failed';
    validationIssues?: UiContextIndexAttemptRow['validationIssues'];
    errorCode?: string;
    errorMessage?: string;
    queuedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    indexLagMs?: number;
  }): Promise<void> {
    const { data: existing, error: existingError } = queryResult<Record<
      string,
      unknown
    > | null>(
      await this.db()
        .from('ui_context_index_state')
        .select(
          'indexed_snapshot_id, indexed_revision_id, indexed_document_hash, attempt_count',
        )
        .eq('document_key', input.documentKey)
        .maybeSingle(),
    );
    assertNoError('getUiContextIndexStateForUpdate', existingError);
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_context_index_state')
        .upsert(
          {
            document_key: input.documentKey,
            project_id: input.projectId,
            document_id: input.documentId,
            latest_snapshot_id: input.latestSnapshotId,
            indexed_snapshot_id:
              input.indexedSnapshotId ??
              (existing?.indexed_snapshot_id as string | null) ??
              null,
            indexed_revision_id:
              input.indexedRevisionId ??
              (existing?.indexed_revision_id as string | null) ??
              null,
            indexed_document_hash:
              input.indexedDocumentHash ??
              (existing?.indexed_document_hash as string | null) ??
              null,
            status: input.status,
            validation_issues_json: input.validationIssues ?? [],
            error_code: input.errorCode ?? null,
            error_message: input.errorMessage ?? null,
            queued_at: input.queuedAt?.toISOString() ?? null,
            started_at: input.startedAt?.toISOString() ?? null,
            completed_at: input.completedAt?.toISOString() ?? null,
            index_lag_ms: input.indexLagMs ?? null,
            attempt_count:
              Number(existing?.attempt_count ?? 0) +
              (input.status === 'running' ? 1 : 0),
          },
          { onConflict: 'document_key' },
        ),
    );
    assertNoError('markUiContextIndexState', error);
  }

  async listIndexLag(projectId: string): Promise<
    Array<{
      documentId: string;
      documentKey: string;
      status: string;
      indexLagMs: number | null;
      latestSnapshotId?: string;
      indexedSnapshotId?: string;
    }>
  > {
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await this.db()
        .from('ui_ops_index_lag')
        .select('*')
        .eq('project_id', projectId),
    );
    assertNoError('listUiContextIndexLag', error);
    return (data ?? []).map((row) => ({
      documentId: row.document_id as string,
      documentKey: row.document_key as string,
      status: row.status as string,
      indexLagMs: row.index_lag_ms == null ? null : Number(row.index_lag_ms),
      latestSnapshotId: (row.latest_snapshot_id as string | null) ?? undefined,
      indexedSnapshotId:
        (row.indexed_snapshot_id as string | null) ?? undefined,
    }));
  }

  async upsertRetrievalDocuments(
    documents: UiRetrievalDocumentInput[],
  ): Promise<void> {
    if (documents.length === 0) return;
    const rows = documents.map((document) => ({
      retrieval_id: document.retrievalId,
      project_id: document.projectId,
      document_id: document.documentId ?? null,
      thread_id: document.threadId ?? null,
      owner_user_id: document.ownerUserId,
      visibility: document.visibility,
      source_kind: document.sourceKind,
      source_id: document.sourceId,
      source_hash: document.sourceHash,
      title: document.title,
      content_text: document.contentText,
      metadata_json: document.metadata,
      stale: document.stale ?? false,
    }));
    const { error } = queryResult<null>(
      await this.db().from('ui_retrieval_document').upsert(rows, {
        onConflict: 'project_id,source_kind,source_id,visibility,owner_user_id',
      }),
    );
    assertNoError('upsertUiRetrievalDocuments', error);
  }

  async markRemovedDocumentSourcesStale(input: {
    projectId: string;
    documentId: string;
    sourceKinds: UiRetrievalDocumentInput['sourceKind'][];
    activeSourceIds: string[];
  }): Promise<void> {
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await this.db()
        .from('ui_retrieval_document')
        .select('retrieval_id, source_id')
        .eq('project_id', input.projectId)
        .eq('document_id', input.documentId)
        .in('source_kind', input.sourceKinds)
        .eq('stale', false),
    );
    assertNoError('listUiRetrievalDocumentsForStaleMark', error);
    const active = new Set(input.activeSourceIds);
    const staleIds = (data ?? [])
      .filter((row) => !active.has(row.source_id as string))
      .map((row) => row.retrieval_id as string);
    if (staleIds.length === 0) return;
    const { error: updateError } = queryResult<null>(
      await this.db()
        .from('ui_retrieval_document')
        .update({ stale: true })
        .in('retrieval_id', staleIds),
    );
    assertNoError('markUiRetrievalDocumentsStale', updateError);
  }

  async markSourceStale(input: {
    projectId: string;
    sourceKind: UiRetrievalDocumentInput['sourceKind'];
    sourceId: string;
  }): Promise<void> {
    const { error } = queryResult<null>(
      await this.db()
        .from('ui_retrieval_document')
        .update({ stale: true })
        .eq('project_id', input.projectId)
        .eq('source_kind', input.sourceKind)
        .eq('source_id', input.sourceId),
    );
    assertNoError('markUiRetrievalSourceStale', error);
  }

  async searchText(input: {
    projectId: string;
    documentId: string;
    actorUserId: string;
    includePrivate: boolean;
    query: string;
    limit?: number;
  }): Promise<UiRetrievalResult[]> {
    if (!input.query.trim()) return [];
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await this.db().rpc('search_ui_retrieval_documents', {
        p_project_id: input.projectId,
        p_document_id: input.documentId,
        p_actor_user_id: input.actorUserId,
        p_include_private: input.includePrivate,
        p_query: input.query.trim(),
        p_limit: input.limit ?? 20,
      }),
    );
    assertNoError('searchUiRetrievalDocuments', error);
    return (data ?? []).map(mapRetrievalResult);
  }

  async getExactSources(input: {
    projectId: string;
    documentId: string;
    actorUserId: string;
    includePrivate: boolean;
    references: Array<{
      sourceKind: UiRetrievalDocumentInput['sourceKind'];
      sourceId: string;
    }>;
  }): Promise<UiRetrievalResult[]> {
    if (input.references.length === 0) return [];
    const sourceIds = [
      ...new Set(input.references.map((item) => item.sourceId)),
    ];
    let query = this.db()
      .from('ui_retrieval_document')
      .select('*')
      .eq('project_id', input.projectId)
      .or(
        `document_id.is.null,document_id.eq.${sanitizeFilterValue(input.documentId)}`,
      )
      .in('source_id', sourceIds)
      .eq('stale', false);
    query = input.includePrivate
      ? query.or(
          `visibility.eq.shared,owner_user_id.eq.${sanitizeFilterValue(input.actorUserId)}`,
        )
      : query.eq('visibility', 'shared');
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await query,
    );
    assertNoError('getExactUiRetrievalSources', error);
    const allowed = new Set(
      input.references.map((item) => `${item.sourceKind}:${item.sourceId}`),
    );
    return (data ?? [])
      .map((row) => ({
        ...mapRetrievalResult({ ...row, rank: 1 }),
        documentId: (row.document_id as string | null) ?? undefined,
      }))
      .filter((item) => allowed.has(`${item.sourceKind}:${item.sourceId}`))
      .sort(
        (left, right) =>
          left.sourceKind.localeCompare(right.sourceKind) ||
          left.sourceId.localeCompare(right.sourceId),
      );
  }

  async searchEmbeddings(input: {
    projectId: string;
    documentId: string;
    actorUserId: string;
    includePrivate: boolean;
    embedding: number[];
    limit?: number;
  }): Promise<UiRetrievalResult[]> {
    if (input.embedding.length === 0) return [];
    const vectorResult = queryResult<Array<Record<string, unknown>>>(
      await this.db().rpc('search_ui_artifact_embeddings_pgvector', {
        p_project_id: input.projectId,
        p_document_id: input.documentId,
        p_actor_user_id: input.actorUserId,
        p_include_private: input.includePrivate,
        p_embedding_json: input.embedding,
        p_limit: input.limit ?? 20,
      }),
    );
    if (!vectorResult.error && (vectorResult.data ?? []).length > 0) {
      return vectorResult.data.map((row) => ({
        retrievalId: row.embedding_id as string,
        documentId: (row.document_id as string | null) ?? undefined,
        ownerUserId: row.owner_user_id as string,
        visibility: row.visibility as UiRetrievalResult['visibility'],
        sourceKind: normalizeRetrievalSourceKind(row.source_kind as string),
        sourceId: row.source_id as string,
        sourceHash: row.source_hash as string,
        title: '',
        contentText: '',
        metadata: { retrievalMode: 'pgvector' },
        rank: Number(row.rank),
      }));
    }
    let query = this.db()
      .from('ui_artifact_embedding')
      .select(
        'embedding_id, document_id, owner_user_id, visibility, source_kind, source_id, source_hash, embedding_json',
      )
      .eq('project_id', input.projectId)
      .or(
        `document_id.is.null,document_id.eq.${sanitizeFilterValue(input.documentId)}`,
      )
      .limit(500);
    query = input.includePrivate
      ? query.or(
          `visibility.eq.shared,owner_user_id.eq.${sanitizeFilterValue(input.actorUserId)}`,
        )
      : query.eq('visibility', 'shared');

    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await query,
    );
    assertNoError('searchUiArtifactEmbeddings', error);
    return (data ?? [])
      .map((row) => ({
        row,
        rank: cosineSimilarity(
          input.embedding,
          (row.embedding_json as number[] | null) ?? [],
        ),
      }))
      .filter((candidate) => Number.isFinite(candidate.rank))
      .sort(
        (left, right) =>
          right.rank - left.rank ||
          String(left.row.source_id).localeCompare(String(right.row.source_id)),
      )
      .slice(0, input.limit ?? 20)
      .map(({ row, rank }) => ({
        retrievalId: row.embedding_id as string,
        documentId: (row.document_id as string | null) ?? undefined,
        ownerUserId: row.owner_user_id as string,
        visibility: row.visibility as UiRetrievalResult['visibility'],
        sourceKind: normalizeRetrievalSourceKind(row.source_kind as string),
        sourceId: row.source_id as string,
        sourceHash: row.source_hash as string,
        title: '',
        contentText: '',
        metadata: {},
        rank,
      }));
  }

  async listArtifactRelations(input: {
    projectId: string;
    documentId: string;
    actorUserId: string;
    includePrivate: boolean;
    limit?: number;
  }): Promise<Array<Record<string, JsonValue>>> {
    let query = this.db()
      .from('ui_artifact_relation')
      .select('*')
      .eq('project_id', input.projectId)
      .or(
        `document_id.is.null,document_id.eq.${sanitizeFilterValue(input.documentId)}`,
      )
      .limit(input.limit ?? 100);
    query = input.includePrivate
      ? query.or(
          `visibility.eq.shared,owner_user_id.eq.${sanitizeFilterValue(input.actorUserId)}`,
        )
      : query.eq('visibility', 'shared');
    const { data, error } = queryResult<Array<Record<string, unknown>>>(
      await query,
    );
    assertNoError('listUiArtifactRelations', error);
    return (data ?? []).map((row) => JsonObjectSchema.parse(row));
  }
}

function mapSnapshot(
  row: Record<string, unknown>,
): CollaborationSnapshotSource {
  return {
    snapshotId: row.snapshot_id as string,
    documentKey: row.document_key as string,
    stateVector: (row.state_vector as string | null) ?? undefined,
    storageRef: row.storage_ref as string,
    createdAt: new Date(row.created_at as string),
  };
}

function mapAttempt(row: Record<string, unknown>): UiContextIndexAttemptRow {
  return {
    attemptId: row.attempt_id as string,
    projectId: row.project_id as string,
    documentId: row.document_id as string,
    documentKey: row.document_key as string,
    snapshotId: row.snapshot_id as string,
    status: row.status as UiContextIndexAttemptRow['status'],
    revisionId: (row.revision_id as string | null) ?? undefined,
    documentHash: (row.document_hash as string | null) ?? undefined,
    validationIssues:
      (row.validation_issues_json as UiContextIndexAttemptRow['validationIssues']) ??
      [],
    errorCode: (row.error_code as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    completedAt: new Date(row.completed_at as string),
  };
}

function mapRetrievalResult(row: Record<string, unknown>): UiRetrievalResult {
  return {
    retrievalId: row.retrieval_id as string,
    ownerUserId: row.owner_user_id as string,
    visibility: row.visibility as UiRetrievalResult['visibility'],
    sourceKind: normalizeRetrievalSourceKind(row.source_kind as string),
    sourceId: row.source_id as string,
    sourceHash: row.source_hash as string,
    title: row.title as string,
    contentText: row.content_text as string,
    metadata: JsonObjectSchema.parse(row.metadata_json ?? {}),
    rank: Number(row.rank),
  };
}

function normalizeRetrievalSourceKind(
  value: string,
): UiRetrievalDocumentInput['sourceKind'] {
  const allowed: UiRetrievalDocumentInput['sourceKind'][] = [
    'document',
    'screen',
    'group',
    'component',
    'block',
    'asset',
    'storyboard',
    'comment',
    'artifact',
    'memory',
  ];
  return allowed.includes(value as UiRetrievalDocumentInput['sourceKind'])
    ? (value as UiRetrievalDocumentInput['sourceKind'])
    : 'artifact';
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function sanitizeFilterValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
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
} {
  return value as {
    data: T;
    error: { message: string } | null;
  };
}
