import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppDataService } from '../integrations/app-data.service.js';
import { requireProjectRole } from '../projects/project-access.js';
import { hasPermission } from '../collaboration/models/collaboration.model.js';
import {
  generateActivityId,
  generateCommentId,
  generateDocId,
  generateSnapshotId,
} from './collaboration-ids.js';
import { CollaborationCommentNotificationsService } from './collaboration-comment-notifications.service.js';
import type {
  CollaborationActivityRow,
  CollaborationDocumentRow,
  CollaborationDocumentType,
  ProjectCommentRow,
  ProjectMemberRole,
} from '../integrations/app-data.types.js';
import { buildDocumentName } from '../collaboration-yjs/document-name.js';
import {
  snapshotObjectPath,
  snapshotVersionObjectPath,
  getCollabBucket,
} from '../collaboration-yjs/collab-persistence.js';
import { SupabaseService } from '../integrations/supabase.js';
import {
  getSurface,
  isCollaborationDocumentType,
} from './models/collaboration-surface.model.js';
import { resolveCollabWsUrl } from './collab-config.js';
import {
  toCollaborationConfigResponse,
  toCollaborationDocumentResponse,
  toProjectSessionResponse,
  toSurfaceConnectionResponse,
  toCommentResponse,
  toSnapshotResponse,
  toCollaborationActivityResponse,
  type CollaborationDocumentResponse,
  type CollaborationConfigResponse,
  type ProjectSessionResponse,
  type SurfaceConnectionResponse,
  type CommentResponse,
  type SnapshotResponse,
  type RestoreSnapshotResponse,
  type CollaborationActivityResponse,
  type DocumentContentResponse,
} from './models/collaboration-documents.model.js';
import type { CreateDocumentDto } from './dto/create-document.dto.js';
import type { UpdateDocumentDto } from './dto/update-document.dto.js';
import type { CreateCommentDto } from './dto/create-comment.dto.js';
import type { CreateReplyDto } from './dto/create-reply.dto.js';
import type { UpdateCommentDto } from './dto/update-comment.dto.js';
import type { CreateActivityDto } from './dto/create-activity.dto.js';
import type { UpdateActivityDto } from './dto/update-activity.dto.js';

@Injectable()
export class CollaborationDocumentsService {
  private readonly logger = new Logger(CollaborationDocumentsService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly commentNotifications: CollaborationCommentNotificationsService,
    private readonly supabase: SupabaseService,
  ) {}

  // ─── Collab config / project session ────────────────────────────────────────

  async getCollaborationConfig(
    projectId: string,
    userId: string,
  ): Promise<CollaborationConfigResponse> {
    const { role } = await requireProjectRole(
      this.appData,
      userId,
      projectId,
      'viewer',
    );
    return toCollaborationConfigResponse({
      projectId,
      role,
      canWrite: hasPermission(role, 'editor'),
      canComment: hasPermission(role, 'commenter'),
      collabWsUrl: resolveCollabWsUrl(),
    });
  }

  async getProjectSession(
    projectId: string,
    userId: string,
  ): Promise<ProjectSessionResponse> {
    const { role } = await requireProjectRole(
      this.appData,
      userId,
      projectId,
      'viewer',
    );
    const activities =
      await this.appData.listActiveCollaborationActivity(projectId);
    const unreconciled =
      await this.appData.listUnreconciledCollaborationActivity(projectId);
    const merged = mergeActivities(activities, unreconciled);
    return toProjectSessionResponse({ projectId, role, activities: merged });
  }

  // ─── Documents ────────────────────────────────────────────────────────────────

  /**
   * Editors calling this repeatedly for the same surface (e.g. every time a
   * legacy local document is opened for cloud comments/collaboration, with no
   * stable external id to key off) must converge on the same document row —
   * otherwise each call mints a brand new Yjs room and two collaborators
   * opening "the same" document end up isolated from each other with no
   * shared presence or edits. Until documents carry an explicit
   * caller-supplied identity, treat each (project, documentType) as an
   * idempotent singleton: reuse the existing non-archived document if one
   * exists instead of always creating a new one.
   */
  async createDocument(
    projectId: string,
    userId: string,
    dto: CreateDocumentDto,
  ): Promise<
    CollaborationDocumentResponse & { connection: SurfaceConnectionResponse }
  > {
    await requireProjectRole(this.appData, userId, projectId, 'editor');

    const existing = await this.findSingletonDocument(
      projectId,
      dto.documentType,
    );
    if (existing) {
      return this.toDocumentWithConnection(existing);
    }

    const documentId = generateDocId();
    const documentKey = buildDocumentName(
      projectId,
      documentId,
      dto.documentType,
    );

    let row: CollaborationDocumentRow;
    try {
      row = await this.appData.createCollaborationDocument({
        documentKey,
        documentId,
        projectId,
        documentType: dto.documentType,
        title: dto.title ?? 'Untitled',
        createdByUserId: userId,
        metadata: dto.metadata,
      });
    } catch (err) {
      // Two concurrent first-opens (e.g. two devices opening the same legacy
      // document within milliseconds of each other) can both pass the check
      // above; the DB's unique index on (project_id, document_type) rejects
      // the loser. Fall back to the winner's row instead of surfacing a 500.
      if (!isDuplicateDocumentError(err)) throw err;
      const fallback = await this.findSingletonDocument(
        projectId,
        dto.documentType,
      );
      if (!fallback) throw err;
      return this.toDocumentWithConnection(fallback);
    }

    this.logger.log(
      `Created ${dto.documentType} document ${documentId} in project ${projectId}`,
    );

    return this.toDocumentWithConnection(row);
  }

  private async findSingletonDocument(
    projectId: string,
    documentType: CollaborationDocumentType,
  ): Promise<CollaborationDocumentRow | undefined> {
    const rows = await this.appData.listCollaborationDocuments(projectId, {
      documentType,
    });
    return rows[0];
  }

  private toDocumentWithConnection(
    row: CollaborationDocumentRow,
  ): CollaborationDocumentResponse & { connection: SurfaceConnectionResponse } {
    return {
      ...toCollaborationDocumentResponse(row),
      connection: toSurfaceConnectionResponse(
        row.projectId,
        row.documentId,
        row.documentType,
        getSurface(row.documentType),
      ),
    };
  }

  async listDocuments(
    projectId: string,
    userId: string,
    documentType?: string,
  ): Promise<CollaborationDocumentResponse[]> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');

    if (documentType && !isCollaborationDocumentType(documentType)) {
      throw new BadRequestException(`Invalid documentType: ${documentType}`);
    }

    const rows = await this.appData.listCollaborationDocuments(projectId, {
      documentType: documentType as CollaborationDocumentType | undefined,
    });
    return rows.map(toCollaborationDocumentResponse);
  }

  async getDocument(
    projectId: string,
    documentId: string,
    userId: string,
  ): Promise<
    CollaborationDocumentResponse & { connection: SurfaceConnectionResponse }
  > {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    const row = await this.requireDocument(projectId, documentId);

    return {
      ...toCollaborationDocumentResponse(row),
      connection: toSurfaceConnectionResponse(
        projectId,
        documentId,
        row.documentType,
        getSurface(row.documentType),
      ),
    };
  }

  /**
   * Reads the latest saved document bytes straight from Supabase Storage —
   * deliberately independent of the Hocuspocus/live-collaboration server.
   * Document *visibility* and *content retrieval* are two separate systems:
   * membership/RLS governs who can see a document exists and read its last
   * saved state (this endpoint, always available whenever the API + Supabase
   * are up), while the collab server only adds real-time co-editing on top.
   * A member must be able to fetch the latest storyboard/canvas/gui content
   * even if the collab websocket is down or misconfigured for their network.
   */
  async getDocumentContent(
    projectId: string,
    documentId: string,
    userId: string,
  ): Promise<DocumentContentResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    const document = await this.requireDocument(projectId, documentId);

    const bucket = getCollabBucket();
    const objectPath = snapshotObjectPath({
      projectId,
      documentType: document.documentType,
      documentId,
    });

    let bytes: Buffer;
    try {
      bytes = await this.supabase.downloadObject(objectPath, bucket);
    } catch (err) {
      if (!isStorageObjectNotFoundError(err)) throw err;
      // A document can exist (registry row created via POST .../documents)
      // with no saved Yjs bytes yet if no one has opened the live editor —
      // that's a legitimate empty-content state, not an error.
      bytes = Buffer.alloc(0);
    }

    return {
      documentId: document.documentId,
      documentType: document.documentType,
      version: document.version,
      hasContent: bytes.byteLength > 0,
      byteLength: bytes.byteLength,
      dataBase64: bytes.toString('base64'),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  async updateDocument(
    projectId: string,
    documentId: string,
    userId: string,
    dto: UpdateDocumentDto,
  ): Promise<CollaborationDocumentResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');
    const existing = await this.requireDocument(projectId, documentId);

    const updated = await this.appData.updateCollaborationDocument(
      existing.documentKey,
      {
        title: dto.title,
        archived: dto.archived,
        metadata: dto.metadata,
      },
    );
    if (!updated) throw new NotFoundException('Document not found');

    this.logger.log(`Updated document ${documentId} in project ${projectId}`);
    return toCollaborationDocumentResponse(updated);
  }

  // ─── Comments ─────────────────────────────────────────────────────────────────

  async listComments(
    projectId: string,
    documentId: string,
    userId: string,
  ): Promise<CommentResponse[]> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    await this.requireDocument(projectId, documentId);

    const rows = await this.appData.listProjectComments(projectId, {
      documentId,
    });
    return rows.map(toCommentResponse);
  }

  async createComment(
    projectId: string,
    documentId: string,
    userId: string,
    dto: CreateCommentDto,
  ): Promise<CommentResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'commenter');
    await this.requireDocument(projectId, documentId);

    const row = await this.appData.createProjectComment({
      commentId: generateCommentId(),
      projectId,
      documentId,
      assetId: dto.assetId,
      authorUserId: userId,
      body: dto.body,
      anchor: dto.anchor,
    });

    await this.notifyMentions(row, dto.mentionedUserIds);
    await this.recordCommentActivity(projectId, documentId, userId, 'comment_created', row);
    return toCommentResponse(row);
  }

  async createReply(
    projectId: string,
    documentId: string,
    commentId: string,
    userId: string,
    dto: CreateReplyDto,
  ): Promise<CommentResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'commenter');
    const parent = await this.requireComment(projectId, documentId, commentId);

    const row = await this.appData.createProjectComment({
      commentId: generateCommentId(),
      projectId,
      documentId,
      assetId: parent.assetId,
      authorUserId: userId,
      parentCommentId: commentId,
      body: dto.body,
      anchor: parent.anchor,
    });

    if (parent.authorUserId !== userId) {
      this.commentNotifications.enqueueReply({
        projectId,
        recipientUserId: parent.authorUserId,
        authorUserId: userId,
        commentId: row.commentId,
        body: row.body,
        documentId,
        assetId: parent.assetId,
        parentCommentId: commentId,
      });
    }
    await this.notifyMentions(row, dto.mentionedUserIds);
    await this.recordCommentActivity(projectId, documentId, userId, 'comment_replied', row, {
      parentCommentId: commentId,
    });

    return toCommentResponse(row);
  }

  async updateComment(
    projectId: string,
    documentId: string,
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentResponse> {
    const { role } = await requireProjectRole(
      this.appData,
      userId,
      projectId,
      'commenter',
    );
    const comment = await this.requireComment(projectId, documentId, commentId);
    this.assertCommentWritable(comment, userId, role);

    const updated = await this.appData.updateProjectComment(commentId, {
      body: dto.body,
    });
    if (!updated) throw new NotFoundException('Comment not found');
    return toCommentResponse(updated);
  }

  async resolveComment(
    projectId: string,
    documentId: string,
    commentId: string,
    userId: string,
    resolved: boolean,
  ): Promise<CommentResponse> {
    const { role } = await requireProjectRole(
      this.appData,
      userId,
      projectId,
      'commenter',
    );
    const comment = await this.requireComment(projectId, documentId, commentId);
    this.assertCommentWritable(comment, userId, role);

    const updated = await this.appData.resolveProjectComment(
      commentId,
      userId,
      resolved,
    );
    if (!updated) throw new NotFoundException('Comment not found');
    await this.recordCommentActivity(projectId, documentId, userId, 'comment_resolved', updated, {
      resolved,
    });
    return toCommentResponse(updated);
  }

  async deleteComment(
    projectId: string,
    documentId: string,
    commentId: string,
    userId: string,
  ): Promise<void> {
    const { role } = await requireProjectRole(
      this.appData,
      userId,
      projectId,
      'commenter',
    );
    const comment = await this.requireComment(projectId, documentId, commentId);
    this.assertCommentWritable(comment, userId, role);

    await this.appData.deleteProjectComment(commentId);
  }

  // ─── Version history ───────────────────────────────────────────────────────

  async listVersions(
    projectId: string,
    documentId: string,
    userId: string,
    limit?: number,
  ): Promise<SnapshotResponse[]> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    const document = await this.requireDocument(projectId, documentId);

    const rows = await this.appData.listCollaborationSnapshots(
      document.documentKey,
      { limit },
    );
    return rows.map(toSnapshotResponse);
  }

  async getVersion(
    projectId: string,
    documentId: string,
    snapshotId: string,
    userId: string,
  ): Promise<SnapshotResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    const document = await this.requireDocument(projectId, documentId);

    const snapshot =
      await this.appData.getCollaborationSnapshotById(snapshotId);
    if (!snapshot || snapshot.documentKey !== document.documentKey) {
      throw new NotFoundException('Version not found');
    }
    return toSnapshotResponse(snapshot);
  }

  /**
   * Restores document storage to a prior snapshot's bytes. Only rewrites
   * Supabase Storage + collaboration_document metadata — clients with the
   * room already open must reconnect for the collab server to reload the
   * restored content into its in-memory Yjs doc.
   */
  async restoreVersion(
    projectId: string,
    documentId: string,
    snapshotId: string,
    userId: string,
  ): Promise<RestoreSnapshotResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');
    const document = await this.requireDocument(projectId, documentId);

    const snapshot =
      await this.appData.getCollaborationSnapshotById(snapshotId);
    if (!snapshot || snapshot.documentKey !== document.documentKey) {
      throw new NotFoundException('Version not found');
    }

    const bucket = getCollabBucket();
    const versionObjectPath = objectPathFromStorageRef(snapshot.storageRef);
    if (!versionObjectPath) {
      throw new BadRequestException(
        'This version has no recoverable storage object',
      );
    }

    const bytes = await this.supabase.downloadObject(versionObjectPath, bucket);
    const latestObjectPath = snapshotObjectPath({
      projectId,
      documentType: document.documentType,
      documentId,
    });
    await this.supabase.uploadObject(
      latestObjectPath,
      bytes,
      'application/octet-stream',
      bucket,
    );

    const restoredSnapshotId = generateSnapshotId();
    const restoredObjectPath = snapshotVersionObjectPath(
      { projectId, documentType: document.documentType, documentId },
      restoredSnapshotId,
    );
    await this.supabase.uploadObject(
      restoredObjectPath,
      bytes,
      'application/octet-stream',
      bucket,
    );

    const updated = await this.appData.updateCollaborationDocument(
      document.documentKey,
      {
        version: document.version + 1,
        updatedByUserId: userId,
      },
    );
    this.logger.log(
      `Restored document ${documentId} in project ${projectId} to snapshot ${snapshotId}`,
    );

    return {
      document: toCollaborationDocumentResponse(updated ?? document),
      restoredFromSnapshotId: snapshotId,
      requiresReconnect: true,
    };
  }

  // ─── Collaboration activity (durable generation/import/sync) ────────────────

  async createActivity(
    projectId: string,
    userId: string,
    dto: CreateActivityDto,
    documentId?: string,
  ): Promise<CollaborationActivityResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');

    let documentType: CollaborationDocumentType | undefined;
    if (documentId) {
      const document = await this.requireDocument(projectId, documentId);
      documentType = document.documentType;
    }

    const row = await this.appData.createCollaborationActivity({
      activityId: generateActivityId(),
      projectId,
      documentId,
      documentType,
      requestId: dto.requestId,
      actorUserId: userId,
      activityType: dto.activityType,
      target: dto.target,
      result: dto.result,
    });

    this.logger.log(
      `Created ${dto.activityType} activity ${row.activityId} for project ${projectId}` +
        (documentId ? ` / document ${documentId}` : ''),
    );
    return toCollaborationActivityResponse(row);
  }

  async listActivityForDocument(
    projectId: string,
    documentId: string,
    userId: string,
  ): Promise<CollaborationActivityResponse[]> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    await this.requireDocument(projectId, documentId);

    const unreconciled =
      await this.appData.listUnreconciledCollaborationActivity(
        projectId,
        documentId,
      );
    const active = (
      await this.appData.listActiveCollaborationActivity(projectId)
    ).filter((row) => row.documentId === documentId);
    return mergeActivities(active, unreconciled).map(
      toCollaborationActivityResponse,
    );
  }

  async listActivityForProject(
    projectId: string,
    userId: string,
  ): Promise<CollaborationActivityResponse[]> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    const active =
      await this.appData.listActiveCollaborationActivity(projectId);
    const unreconciled =
      await this.appData.listUnreconciledCollaborationActivity(projectId);
    return mergeActivities(active, unreconciled).map(
      toCollaborationActivityResponse,
    );
  }

  async updateActivity(
    projectId: string,
    activityId: string,
    userId: string,
    dto: UpdateActivityDto,
  ): Promise<CollaborationActivityResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');
    const activity = await this.requireActivity(projectId, activityId);

    const updated = await this.appData.updateCollaborationActivity(
      activity.activityId,
      {
        status: dto.status,
        result: dto.result,
        errorMessage: dto.errorMessage,
      },
    );
    if (!updated) throw new NotFoundException('Activity not found');
    return toCollaborationActivityResponse(updated);
  }

  /**
   * Pulls the linked request_status (and, if completed, the resulting
   * project_asset by requestId) into the activity row, so any client can
   * poll a single durable source instead of stitching request + asset
   * lookups together on the frontend.
   */
  async syncActivityFromRequest(
    projectId: string,
    activityId: string,
    userId: string,
  ): Promise<CollaborationActivityResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    const activity = await this.requireActivity(projectId, activityId);

    if (!activity.requestId) return toCollaborationActivityResponse(activity);

    const request = await this.appData.getRequestStatus(activity.requestId);
    if (!request) return toCollaborationActivityResponse(activity);

    if (request.status === 'failed' || request.status === 'cancelled') {
      const updated = await this.appData.updateCollaborationActivity(
        activityId,
        {
          status: request.status === 'failed' ? 'failed' : 'cancelled',
          errorMessage: request.errorMessage,
        },
      );
      return toCollaborationActivityResponse(updated ?? activity);
    }

    if (request.status !== 'completed') {
      const updated = await this.appData.updateCollaborationActivity(
        activityId,
        { status: 'running' },
      );
      return toCollaborationActivityResponse(updated ?? activity);
    }

    const asset = await this.appData.getProjectAssetByRequestId(
      projectId,
      activity.requestId,
    );
    const previewAssetId =
      asset?.metadata && typeof asset.metadata.previewAssetId === 'string'
        ? asset.metadata.previewAssetId
        : asset
          ? `${asset.assetId}-preview`
          : undefined;
    const updated = await this.appData.updateCollaborationActivity(activityId, {
      status: 'completed',
      result: {
        ...activity.result,
        ...(asset
          ? {
              assetId: asset.assetId,
              assetStatus: asset.status,
              previewAssetId,
              projectRelativePath:
                typeof asset.metadata?.projectRelativePath === 'string'
                  ? asset.metadata.projectRelativePath
                  : undefined,
            }
          : {}),
        outputRef: request.outputRef,
        ...(request.resultJson ?? {}),
      },
    });
    return toCollaborationActivityResponse(updated ?? activity);
  }

  async reconcileActivity(
    projectId: string,
    activityId: string,
    userId: string,
  ): Promise<CollaborationActivityResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');
    const activity = await this.requireActivity(projectId, activityId);

    if (activity.reconciledAt) {
      return toCollaborationActivityResponse(activity);
    }

    if (activity.status !== 'completed') {
      throw new BadRequestException(
        'Only completed activity can be reconciled',
      );
    }

    const updated = await this.appData.updateCollaborationActivity(activityId, {
      reconciled: true,
    });
    if (!updated) throw new NotFoundException('Activity not found');

    this.logger.log(
      `Activity ${activityId} reconciled into project ${projectId} by ${userId}`,
    );
    return toCollaborationActivityResponse(updated);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async requireDocument(
    projectId: string,
    documentId: string,
  ): Promise<CollaborationDocumentRow> {
    const document = await this.appData.getCollaborationDocumentById(
      projectId,
      documentId,
    );
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  private async requireComment(
    projectId: string,
    documentId: string,
    commentId: string,
  ): Promise<ProjectCommentRow> {
    const comment = await this.appData.getProjectComment(commentId);
    if (
      !comment ||
      comment.projectId !== projectId ||
      comment.documentId !== documentId
    ) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  private async requireActivity(
    projectId: string,
    activityId: string,
  ): Promise<CollaborationActivityRow> {
    const activity = await this.appData.getCollaborationActivity(activityId);
    if (!activity || activity.projectId !== projectId) {
      throw new NotFoundException('Activity not found');
    }
    return activity;
  }

  private assertCommentWritable(
    comment: ProjectCommentRow,
    userId: string,
    role: ProjectMemberRole,
  ): void {
    if (comment.authorUserId === userId) return;
    if (hasPermission(role, 'editor')) return;
    throw new ForbiddenException(
      'Only the comment author or an editor can modify this comment',
    );
  }

  private async notifyMentions(
    comment: ProjectCommentRow,
    mentionedUserIds?: string[],
  ): Promise<void> {
    this.commentNotifications.enqueueMentions({
      projectId: comment.projectId,
      authorUserId: comment.authorUserId,
      commentId: comment.commentId,
      body: comment.body,
      documentId: comment.documentId,
      assetId: comment.assetId,
      parentCommentId: comment.parentCommentId,
      mentionedUserIds,
    });
  }

  private async recordCommentActivity(
    projectId: string,
    documentId: string,
    userId: string,
    activityType: 'comment_created' | 'comment_replied' | 'comment_resolved',
    comment: ProjectCommentRow,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const document = await this.appData.getCollaborationDocumentById(projectId, documentId);
    await this.appData.createCollaborationActivity({
      activityId: generateActivityId(),
      projectId,
      documentId,
      documentType: document?.documentType,
      actorUserId: userId,
      activityType,
      status: 'completed',
      target: {
        commentId: comment.commentId,
        assetId: comment.assetId,
        anchor: comment.anchor,
        ...(extra ?? {}),
      },
      result: {
        commentId: comment.commentId,
        body: comment.body,
      },
    });
  }
}

function isDuplicateDocumentError(err: unknown): boolean {
  return (
    err instanceof Error && err.message.toLowerCase().includes('duplicate key')
  );
}

/**
 * Matches the same "no object at this path" cases the live collab server
 * already tolerates in collab-persistence.ts's loadDocumentSnapshot, so a
 * never-edited document resolves to empty content instead of a 500 here too.
 */
function isStorageObjectNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message;
  return (
    message.includes('not found') ||
    message.includes('Not Found') ||
    message.includes('Object not found')
  );
}

function objectPathFromStorageRef(storageRef: string): string | null {
  const match = /^supabase:\/\/[^/]+\/(.+)$/.exec(storageRef);
  return match ? match[1] : null;
}

function mergeActivities(
  ...groups: CollaborationActivityRow[][]
): CollaborationActivityRow[] {
  const byId = new Map<string, CollaborationActivityRow>();
  for (const group of groups) {
    for (const row of group) byId.set(row.activityId, row);
  }
  return [...byId.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}
