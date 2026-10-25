import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  JsonValueSchema,
  canonicalSha256,
  type ContractValidationIssue,
  type JsonValue,
} from '@markaschmidt/ui-builder-contracts';
import * as Y from 'yjs';
import { AppDataService } from '../../integrations/app-data.service.js';
import { SupabaseService } from '../../integrations/supabase.js';
import type {
  UiSnapshotIndexJob,
  UiSourceIndexJob,
} from '../../queues/ui-context-index.jobs.js';
import type { UiDocumentRevisionRow } from '../models/ui-agent.model.js';
import { UiContextRepository } from '../repositories/ui-context.repository.js';
import { UiMemoryRepository } from '../repositories/ui-memory.repository.js';
import { generateUiAgentId } from '../ui-agent.ids.js';
import {
  UiSnapshotValidationError,
  decodeYjsJson,
  extractUiDocumentFromYjs,
} from './ui-document-extractor.js';
import type {
  CollaborationSnapshotSource,
  UiRetrievalDocumentInput,
} from './ui-context-index.model.js';
import { UiContextIndexRepository } from './ui-context-index.repository.js';

export interface UiSnapshotIndexResult {
  status: 'ready' | 'invalid';
  revision?: UiDocumentRevisionRow;
  validationIssues: ContractValidationIssue[];
}

@Injectable()
export class UiContextIndexService {
  private readonly logger = new Logger(UiContextIndexService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly appData: AppDataService,
    private readonly index: UiContextIndexRepository,
    private readonly context: UiContextRepository,
    private readonly memories: UiMemoryRepository,
  ) {}

  async indexSnapshot(job: UiSnapshotIndexJob): Promise<UiSnapshotIndexResult> {
    const priorAttempt = await this.index.getAttemptBySnapshot(job.snapshotId);
    if (priorAttempt?.status === 'valid' && priorAttempt.revisionId) {
      const revision = await this.context.getDocumentRevision(
        priorAttempt.revisionId,
      );
      return {
        status: 'ready',
        revision: revision ?? undefined,
        validationIssues: [],
      };
    }
    if (priorAttempt?.status === 'invalid') {
      return {
        status: 'invalid',
        validationIssues: priorAttempt.validationIssues,
      };
    }

    const snapshot = await this.index.getSnapshot(
      job.documentKey,
      job.snapshotId,
    );
    if (!snapshot) throw new NotFoundException('Snapshot not found');
    const startedAt = new Date();
    await this.index.markIndexState({
      projectId: job.projectId,
      documentId: job.documentId,
      documentKey: job.documentKey,
      latestSnapshotId: snapshot.snapshotId,
      status: 'running',
      startedAt,
    });

    try {
      if (job.documentType === 'storyboard') {
        await this.indexStoryboardSnapshot(job, snapshot, startedAt);
        return { status: 'ready', validationIssues: [] };
      }
      const bytes = await this.downloadSnapshot(snapshot.storageRef);
      const baseline = await this.context.getBaseline(job.documentKey);
      const baselineRevision = baseline?.revisionId
        ? await this.context.getDocumentRevision(baseline.revisionId)
        : null;
      const extraction = extractUiDocumentFromYjs({
        bytes,
        projectId: job.projectId,
        documentId: job.documentId,
        baselineDigest: baselineRevision?.structuralDigest,
      });
      const revision = await this.context.upsertDocumentRevision({
        revisionId: generateUiAgentId('uirev'),
        projectId: job.projectId,
        documentId: job.documentId,
        documentKey: job.documentKey,
        documentHash: extraction.documentHash,
        snapshotId: snapshot.snapshotId,
        stateVector: snapshot.stateVector,
        structuralDigest: extraction.structuralDigest,
        layoutFingerprints: extraction.layoutFingerprints,
        sourceSnapshotCreatedAt: snapshot.createdAt,
      });
      await this.index.upsertRetrievalDocuments(extraction.retrievalDocuments);
      await this.index.markRemovedDocumentSourcesStale({
        projectId: job.projectId,
        documentId: job.documentId,
        sourceKinds: ['document', 'screen', 'group', 'component', 'block'],
        activeSourceIds: extraction.retrievalDocuments.map(
          (document) => document.sourceId,
        ),
      });
      await Promise.all(
        extraction.assetIds.map((assetId) =>
          this.context.upsertArtifactRelation({
            relationId: `uirel_${canonicalSha256({
              projectId: job.projectId,
              sourceKind: 'document',
              sourceId: job.documentId,
              relationKind: 'references',
              targetKind: 'asset',
              targetId: assetId,
            }).slice(0, 40)}`,
            projectId: job.projectId,
            documentId: job.documentId,
            ownerUserId: 'system',
            visibility: 'shared',
            sourceKind: 'document',
            sourceId: job.documentId,
            sourceHash: extraction.documentHash,
            relationKind: 'references',
            targetKind: 'asset',
            targetId: assetId,
            metadata: { snapshotId: snapshot.snapshotId },
          }),
        ),
      );
      await this.reindexDocumentComments(job.projectId, job.documentId);
      await this.index.recordAttempt({
        attemptId: indexAttemptId(snapshot.snapshotId),
        projectId: job.projectId,
        documentId: job.documentId,
        documentKey: job.documentKey,
        snapshotId: snapshot.snapshotId,
        stateVector: snapshot.stateVector,
        storageRef: snapshot.storageRef,
        status: 'valid',
        revisionId: revision.revisionId,
        documentHash: extraction.documentHash,
        validationIssues: [],
        startedAt,
      });
      await this.index.markIndexState({
        projectId: job.projectId,
        documentId: job.documentId,
        documentKey: job.documentKey,
        latestSnapshotId: snapshot.snapshotId,
        indexedSnapshotId: snapshot.snapshotId,
        indexedRevisionId: revision.revisionId,
        indexedDocumentHash: revision.documentHash,
        status: 'ready',
        completedAt: new Date(),
        indexLagMs: Math.max(0, Date.now() - snapshot.createdAt.getTime()),
      });
      return { status: 'ready', revision, validationIssues: [] };
    } catch (error) {
      if (error instanceof UiSnapshotValidationError) {
        await this.recordInvalid(job, snapshot, startedAt, error.issues);
        return { status: 'invalid', validationIssues: error.issues };
      }
      await this.recordFailure(job, snapshot, startedAt, error);
      throw error;
    }
  }

  async indexSource(job: UiSourceIndexJob): Promise<void> {
    switch (job.sourceKind) {
      case 'comment':
        await this.indexComment(job);
        return;
      case 'memory':
        await this.indexMemory(job);
        return;
      case 'asset':
        await this.indexAsset(job);
    }
  }

  private async indexComment(job: UiSourceIndexJob): Promise<void> {
    const comment = await this.appData.getProjectComment(job.sourceId);
    if (
      !comment ||
      comment.projectId !== job.projectId ||
      comment.status !== 'open'
    ) {
      await this.index.markSourceStale({
        projectId: job.projectId,
        sourceKind: 'comment',
        sourceId: job.sourceId,
      });
      return;
    }
    const latestRevision = job.documentId
      ? await this.latestRevisionForDocument(job.projectId, job.documentId)
      : null;
    const anchorId = comment.anchor
      ? stringField(comment.anchor, ['componentId', 'groupId', 'blockId'])
      : undefined;
    const layout = latestRevision?.layoutFingerprints;
    const anchorStale =
      Boolean(anchorId) && (!isRecord(layout) || !(anchorId! in layout));
    await this.index.upsertRetrievalDocuments([
      {
        retrievalId: retrievalId(job.projectId, 'comment', comment.commentId),
        projectId: job.projectId,
        documentId: comment.documentId,
        ownerUserId: comment.authorUserId,
        visibility: 'shared',
        sourceKind: 'comment',
        sourceId: comment.commentId,
        sourceHash: job.sourceHash,
        title: comment.parentCommentId ? 'Comment reply' : 'Comment',
        contentText: comment.body,
        metadata: {
          authorUserId: comment.authorUserId,
          parentCommentId: comment.parentCommentId ?? null,
          anchor: JsonValueSchema.parse(comment.anchor ?? {}),
          anchorStale,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
        },
      },
    ]);
  }

  private async indexMemory(job: UiSourceIndexJob): Promise<void> {
    const memory = await this.memories.getMemoryById(
      job.projectId,
      job.sourceId,
    );
    if (!memory || memory.status !== 'accepted') {
      await this.index.markSourceStale({
        projectId: job.projectId,
        sourceKind: 'memory',
        sourceId: job.sourceId,
      });
      return;
    }
    await this.index.upsertRetrievalDocuments([
      {
        retrievalId: retrievalId(job.projectId, 'memory', memory.memoryId),
        projectId: job.projectId,
        documentId: memory.documentId,
        threadId: memory.threadId,
        ownerUserId: memory.ownerUserId,
        visibility: memory.visibility,
        sourceKind: 'memory',
        sourceId: memory.memoryId,
        sourceHash: job.sourceHash,
        title: `${memory.kind.replaceAll('_', ' ')} memory`,
        contentText: memory.text,
        metadata: {
          kind: memory.kind,
          scope: memory.scope,
          scopeId: memory.scopeId ?? null,
          pinned: memory.pinned,
          effectiveRevision: memory.effectiveRevision ?? null,
        },
      },
    ]);
  }

  private async indexAsset(job: UiSourceIndexJob): Promise<void> {
    const asset = await this.appData.getProjectAsset(job.sourceId);
    if (
      !asset ||
      asset.projectId !== job.projectId ||
      asset.status !== 'ready'
    ) {
      await this.index.markSourceStale({
        projectId: job.projectId,
        sourceKind: 'asset',
        sourceId: job.sourceId,
      });
      return;
    }
    const caption =
      stringField(asset.metadata, [
        'caption',
        'visionCaption',
        'description',
      ]) ?? '';
    await this.index.upsertRetrievalDocuments([
      {
        retrievalId: retrievalId(job.projectId, 'asset', asset.assetId),
        projectId: job.projectId,
        ownerUserId: asset.ownerUserId ?? asset.uploadedByUserId,
        visibility: 'shared',
        sourceKind: 'asset',
        sourceId: asset.assetId,
        sourceHash: job.sourceHash,
        title: asset.name,
        contentText: [asset.name, asset.assetType, asset.mimeType, caption]
          .filter(Boolean)
          .join(' '),
        metadata: {
          assetType: asset.assetType,
          mimeType: asset.mimeType ?? null,
          status: asset.status,
          captionKind: caption ? 'text_caption' : null,
          checksum: asset.checksum ?? null,
        },
      },
    ]);
  }

  private async indexStoryboardSnapshot(
    job: UiSnapshotIndexJob,
    snapshot: CollaborationSnapshotSource,
    startedAt: Date,
  ): Promise<void> {
    const bytes = await this.downloadSnapshot(snapshot.storageRef);
    const yDocument = new Y.Doc();
    Y.applyUpdate(yDocument, bytes);
    const json = JsonValueSchema.parse(decodeYjsJson(yDocument));
    const documents = storyboardRetrievalDocuments(
      json,
      job.projectId,
      job.documentId,
    );
    await this.index.upsertRetrievalDocuments(documents);
    await this.index.markRemovedDocumentSourcesStale({
      projectId: job.projectId,
      documentId: job.documentId,
      sourceKinds: ['storyboard'],
      activeSourceIds: documents.map((document) => document.sourceId),
    });
    await this.index.recordAttempt({
      attemptId: indexAttemptId(snapshot.snapshotId),
      projectId: job.projectId,
      documentId: job.documentId,
      documentKey: job.documentKey,
      snapshotId: snapshot.snapshotId,
      stateVector: snapshot.stateVector,
      storageRef: snapshot.storageRef,
      status: 'valid',
      documentHash: canonicalSha256(json),
      validationIssues: [],
      startedAt,
    });
    await this.index.markIndexState({
      projectId: job.projectId,
      documentId: job.documentId,
      documentKey: job.documentKey,
      latestSnapshotId: snapshot.snapshotId,
      indexedSnapshotId: snapshot.snapshotId,
      indexedDocumentHash: canonicalSha256(json),
      status: 'ready',
      completedAt: new Date(),
      indexLagMs: Math.max(0, Date.now() - snapshot.createdAt.getTime()),
    });
  }

  private async latestRevisionForDocument(
    projectId: string,
    documentId: string,
  ): Promise<UiDocumentRevisionRow | null> {
    const document = await this.appData.getCollaborationDocumentById(
      projectId,
      documentId,
    );
    if (!document) return null;
    return this.context.getLatestDocumentRevision(document.documentKey);
  }

  private async reindexDocumentComments(
    projectId: string,
    documentId: string,
  ): Promise<void> {
    const comments = await this.appData.listProjectComments(projectId, {
      documentId,
    });
    await Promise.all(
      comments.map((comment) =>
        this.indexComment({
          kind: 'source',
          projectId,
          documentId,
          sourceKind: 'comment',
          sourceId: comment.commentId,
          sourceHash: canonicalSha256({
            commentId: comment.commentId,
            body: comment.body,
            status: comment.status,
            anchor: comment.anchor ?? null,
            updatedAt: comment.updatedAt.toISOString(),
          }),
        }),
      ),
    );
  }

  private async downloadSnapshot(storageRef: string): Promise<Uint8Array> {
    const parsed = parseStorageRef(storageRef);
    const bytes = await this.supabase.downloadObject(
      parsed.objectPath,
      parsed.bucket,
    );
    return new Uint8Array(bytes);
  }

  private async recordInvalid(
    job: UiSnapshotIndexJob,
    snapshot: CollaborationSnapshotSource,
    startedAt: Date,
    issues: ContractValidationIssue[],
  ): Promise<void> {
    await this.index.recordAttempt({
      attemptId: indexAttemptId(snapshot.snapshotId),
      projectId: job.projectId,
      documentId: job.documentId,
      documentKey: job.documentKey,
      snapshotId: snapshot.snapshotId,
      stateVector: snapshot.stateVector,
      storageRef: snapshot.storageRef,
      status: 'invalid',
      validationIssues: issues,
      errorCode: 'invalid_document',
      errorMessage: 'Persisted document failed contract validation',
      startedAt,
    });
    await this.index.markIndexState({
      projectId: job.projectId,
      documentId: job.documentId,
      documentKey: job.documentKey,
      latestSnapshotId: snapshot.snapshotId,
      status: 'invalid',
      validationIssues: issues,
      errorCode: 'invalid_document',
      errorMessage: 'Persisted document failed contract validation',
      completedAt: new Date(),
    });
  }

  private async recordFailure(
    job: UiSnapshotIndexJob,
    snapshot: CollaborationSnapshotSource,
    startedAt: Date,
    error: unknown,
  ): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown index failure';
    this.logger.error(
      `UI context index failed for ${snapshot.snapshotId}: ${errorMessage}`,
    );
    await this.index.recordAttempt({
      attemptId: indexAttemptId(snapshot.snapshotId),
      projectId: job.projectId,
      documentId: job.documentId,
      documentKey: job.documentKey,
      snapshotId: snapshot.snapshotId,
      stateVector: snapshot.stateVector,
      storageRef: snapshot.storageRef,
      status: 'failed',
      validationIssues: [],
      errorCode: 'index_failed',
      errorMessage,
      startedAt,
    });
    await this.index.markIndexState({
      projectId: job.projectId,
      documentId: job.documentId,
      documentKey: job.documentKey,
      latestSnapshotId: snapshot.snapshotId,
      status: 'failed',
      errorCode: 'index_failed',
      errorMessage,
      completedAt: new Date(),
    });
  }
}

function parseStorageRef(storageRef: string): {
  bucket: string;
  objectPath: string;
} {
  const match = /^supabase:\/\/([^/]+)\/(.+)$/.exec(storageRef);
  if (!match?.[1] || !match[2]) {
    throw new Error('Snapshot storage reference is invalid');
  }
  return { bucket: match[1], objectPath: match[2] };
}

function indexAttemptId(snapshotId: string): string {
  return `uiidx_${canonicalSha256(snapshotId).slice(0, 40)}`;
}

function retrievalId(
  projectId: string,
  sourceKind: string,
  sourceId: string,
): string {
  return `uiretr_${canonicalSha256({
    projectId,
    sourceKind,
    sourceId,
  }).slice(0, 40)}`;
}

function storyboardRetrievalDocuments(
  value: JsonValue,
  projectId: string,
  documentId: string,
): UiRetrievalDocumentInput[] {
  const sections = collectStoryboardSections(value);
  if (sections.length === 0) {
    sections.push({
      id: documentId,
      title: 'Storyboard',
      content: JSON.stringify(value),
    });
  }
  return sections.map((section) => ({
    retrievalId: retrievalId(projectId, 'storyboard', section.id),
    projectId,
    documentId,
    ownerUserId: 'system',
    visibility: 'shared',
    sourceKind: 'storyboard',
    sourceId: section.id,
    sourceHash: canonicalSha256(section.content),
    title: section.title,
    contentText: section.content.slice(0, 100_000),
    metadata: { headerBlockId: section.id },
  }));
}

function collectStoryboardSections(
  value: JsonValue,
): Array<{ id: string; title: string; content: string }> {
  const sections: Array<{ id: string; title: string; content: string }> = [];
  const visit = (candidate: JsonValue, depth: number): void => {
    if (depth > 12 || sections.length >= 2_000) return;
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (!isRecord(candidate)) return;
    const id = stringField(candidate, ['headerBlockId', 'blockId', 'id']);
    const title = stringField(candidate, ['title', 'heading', 'name']);
    if (id && title) {
      sections.push({ id, title, content: JSON.stringify(candidate) });
    }
    Object.values(candidate).forEach((entry) => visit(entry, depth + 1));
  };
  visit(value, 0);
  return [
    ...new Map(sections.map((section) => [section.id, section])).values(),
  ].sort((left, right) => left.id.localeCompare(right.id));
}

function stringField(
  value: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    if (typeof value[key] === 'string') return value[key];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
