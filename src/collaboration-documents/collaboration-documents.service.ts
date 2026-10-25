import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
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
  CollaborationSnapshotRow,
  ProjectCommentRow,
  ProjectMemberRole,
} from '../integrations/app-data.types.js';
import { buildDocumentName } from '../collaboration-yjs/document-name.js';
import {
  snapshotObjectPath,
  snapshotVersionObjectPath,
  snapshotPreviewObjectPath,
  legacyFoundrySnapshotObjectPath,
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
  type SnapshotPreviewUploadResponse,
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
import type {
  CompleteSnapshotPreviewDto,
  CreateSnapshotDto,
  CreateSnapshotPreviewUploadDto,
  SnapshotPreviewMimeType,
} from './dto/create-snapshot.dto.js';
import { canonicalSha256 } from '@markaschmidt/ui-builder-contracts';
import { UiContextIndexQueue } from '../ui-agent/indexer/ui-context-index.queue.js';
import { correlationAttributes } from '../telemetry/otel-attributes.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';

@Injectable()
export class CollaborationDocumentsService {
  private readonly logger = new Logger(CollaborationDocumentsService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly commentNotifications: CollaborationCommentNotificationsService,
    private readonly supabase: SupabaseService,
    private readonly contextIndexQueue: UiContextIndexQueue,
    @Optional() private readonly telemetry?: TelemetryService,
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
   * A member must be able to fetch the latest storyboard/foundry/canvas/gui
   * content even if the collab websocket is down or misconfigured for their network.
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
      if (
        isStorageObjectNotFoundError(err) &&
        document.documentType === 'foundry'
      ) {
        try {
          bytes = await this.supabase.downloadObject(
            legacyFoundrySnapshotObjectPath({ projectId, documentId }),
            bucket,
          );
        } catch (legacyErr) {
          if (!isStorageObjectNotFoundError(legacyErr)) throw legacyErr;
          bytes = Buffer.alloc(0);
        }
      } else if (isStorageObjectNotFoundError(err)) {
        // A document can exist (registry row created via POST .../documents)
        // with no saved Yjs bytes yet if no one has opened the live editor —
        // that's a legitimate empty-content state, not an error.
        bytes = Buffer.alloc(0);
      } else {
        throw err;
      }
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

    this.notifyMentions(row, dto.mentionedUserIds);
    await this.recordCommentActivity(
      projectId,
      documentId,
      userId,
      'comment_created',
      row,
    );
    await this.enqueueCommentIndex(row, documentId);
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
    this.notifyMentions(row, dto.mentionedUserIds);
    await this.recordCommentActivity(
      projectId,
      documentId,
      userId,
      'comment_replied',
      row,
      {
        parentCommentId: commentId,
      },
    );

    await this.enqueueCommentIndex(row, documentId);
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
    await this.enqueueCommentIndex(updated, documentId);
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
    await this.recordCommentActivity(
      projectId,
      documentId,
      userId,
      'comment_resolved',
      updated,
      {
        resolved,
      },
    );
    await this.enqueueCommentIndex(updated, documentId);
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
    await this.contextIndexQueue.enqueueSource({
      kind: 'source',
      projectId,
      documentId,
      sourceKind: 'comment',
      sourceId: commentId,
      sourceHash: canonicalSha256({
        commentId,
        status: 'deleted',
      }),
    });
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
    return Promise.all(rows.map((row) => this.toSnapshotResponseWithPreview(row)));
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
    return this.toSnapshotResponseWithPreview(snapshot);
  }

  /**
   * Named restore point from the current persisted latest.yjs bytes.
   * Does not rewrite live storage or the in-memory collab room.
   */
  async createVersion(
    projectId: string,
    documentId: string,
    userId: string,
    dto: CreateSnapshotDto,
  ): Promise<SnapshotResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');
    const document = await this.requireDocument(projectId, documentId);
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Snapshot name is required');
    }

    const bytes = await this.downloadLatestYjsBytes(projectId, document);
    if (bytes.byteLength === 0) {
      throw new BadRequestException(
        'Document has no persisted content to snapshot',
      );
    }

    const snapshotId = generateSnapshotId();
    const bucket = getCollabBucket();
    const versionObjectPath = snapshotVersionObjectPath(
      { projectId, documentType: document.documentType, documentId },
      snapshotId,
    );
    await this.supabase.uploadObject(
      versionObjectPath,
      bytes,
      'application/octet-stream',
      bucket,
    );
    const row = await this.appData.createCollaborationSnapshot({
      snapshotId,
      documentKey: document.documentKey,
      documentId: document.documentId,
      storageRef: `supabase://${bucket}/${versionObjectPath}`,
      byteLength: bytes.byteLength,
      createdByUserId: userId,
      name,
    });
    return this.toSnapshotResponseWithPreview(row);
  }

  /**
   * Reserve a signed PUT for a screenshot on this snapshot. Bytes go to the
   * collaboration-snapshots bucket, not project-assets / the repository.
   */
  async createVersionPreviewUpload(
    projectId: string,
    documentId: string,
    snapshotId: string,
    userId: string,
    dto: CreateSnapshotPreviewUploadDto,
  ): Promise<SnapshotPreviewUploadResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');
    const snapshot = await this.requireDocumentSnapshot(
      projectId,
      documentId,
      snapshotId,
    );
    const document = await this.requireDocument(projectId, documentId);
    const extension = previewExtension(dto.contentType);
    const bucket = getCollabBucket();
    const objectPath = snapshotPreviewObjectPath(
      {
        projectId,
        documentType: document.documentType,
        documentId,
      },
      snapshot.snapshotId,
      extension,
    );
    if (snapshot.previewStorageRef) {
      const previous = objectPathFromStorageRef(snapshot.previewStorageRef);
      if (previous && previous !== objectPath) {
        await this.supabase.deleteObject(previous, bucket).catch(() => undefined);
      }
    }
    const signed = await this.supabase.createSignedUploadUrl(objectPath, bucket, {
      upsert: true,
    });
    await this.appData.updateCollaborationSnapshotPreview({
      snapshotId: snapshot.snapshotId,
      previewStorageRef: `supabase://${bucket}/${objectPath}`,
      previewContentType: dto.contentType,
      previewByteLength: null,
    });
    return {
      snapshotId: snapshot.snapshotId,
      uploadUrl: signed.signedUrl,
      token: signed.token,
      path: signed.path,
      contentType: dto.contentType,
      expiresInSeconds: 7200,
    };
  }

  async completeVersionPreview(
    projectId: string,
    documentId: string,
    snapshotId: string,
    userId: string,
    dto: CompleteSnapshotPreviewDto,
  ): Promise<SnapshotResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'editor');
    const snapshot = await this.requireDocumentSnapshot(
      projectId,
      documentId,
      snapshotId,
    );
    const objectPath = snapshot.previewStorageRef
      ? objectPathFromStorageRef(snapshot.previewStorageRef)
      : null;
    if (!objectPath) {
      throw new BadRequestException('No preview upload has been reserved');
    }
    const exists = await this.supabase.objectExists(
      objectPath,
      getCollabBucket(),
    );
    if (!exists) {
      throw new BadRequestException('Preview bytes were not found in storage');
    }
    const updated = await this.appData.updateCollaborationSnapshotPreview({
      snapshotId: snapshot.snapshotId,
      previewByteLength: dto.byteLength ?? snapshot.previewByteLength,
    });
    return this.toSnapshotResponseWithPreview(updated ?? snapshot);
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
    const restoredStorageRef = `supabase://${bucket}/${restoredObjectPath}`;
    const { error: restoredSnapshotError } = await this.supabase
      .getAdminClient()
      .from('collaboration_snapshot')
      .insert({
        snapshot_id: restoredSnapshotId,
        document_key: document.documentKey,
        document_id: document.documentId,
        state_vector: snapshot.stateVector ?? null,
        storage_ref: restoredStorageRef,
        byte_length: bytes.byteLength,
        created_by_user_id: userId,
        created_at: new Date().toISOString(),
      });
    if (restoredSnapshotError) {
      throw new Error(
        `Restored collaboration snapshot insert failed: ${restoredSnapshotError.message}`,
      );
    }

    const updated = await this.appData.updateCollaborationDocument(
      document.documentKey,
      {
        version: document.version + 1,
        updatedByUserId: userId,
      },
    );
    if (
      document.documentType === 'gui_screen' ||
      document.documentType === 'storyboard'
    ) {
      await this.contextIndexQueue.enqueueSnapshot({
        kind: 'snapshot',
        projectId,
        documentId,
        documentKey: document.documentKey,
        documentType: document.documentType,
        snapshotId: restoredSnapshotId,
        stateVector: snapshot.stateVector ?? '',
        storageRef: restoredStorageRef,
      });
    }
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
    // Canvas action processors may already have written a rich result
    // (including multi-output `outputs[]`). Merge without dropping those fields.
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
        ...(activity.result?.outputs
          ? { outputs: activity.result.outputs }
          : {}),
        ...(activity.workflowId
          ? {
              workflowId: activity.workflowId,
              nodeId: activity.nodeId,
              runId: activity.runId,
              actionKind: activity.actionKind,
            }
          : {}),
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
    this.telemetry?.addAttributes(
      correlationAttributes({
        projectId,
        activityId,
        documentId: updated.documentId,
        requestId: updated.requestId,
      }),
    );
    return toCollaborationActivityResponse(updated);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async enqueueCommentIndex(
    comment: ProjectCommentRow,
    documentId: string,
  ): Promise<void> {
    await this.contextIndexQueue.enqueueSource({
      kind: 'source',
      projectId: comment.projectId,
      documentId,
      sourceKind: 'comment',
      sourceId: comment.commentId,
      sourceHash: canonicalSha256({
        commentId: comment.commentId,
        body: comment.body,
        status: comment.status,
        anchor: comment.anchor ?? null,
        parentCommentId: comment.parentCommentId ?? null,
        updatedAt: comment.updatedAt.toISOString(),
      }),
    });
  }

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

  private async requireDocumentSnapshot(
    projectId: string,
    documentId: string,
    snapshotId: string,
  ): Promise<CollaborationSnapshotRow> {
    const document = await this.requireDocument(projectId, documentId);
    const snapshot =
      await this.appData.getCollaborationSnapshotById(snapshotId);
    if (!snapshot || snapshot.documentKey !== document.documentKey) {
      throw new NotFoundException('Version not found');
    }
    return snapshot;
  }

  private async downloadLatestYjsBytes(
    projectId: string,
    document: CollaborationDocumentRow,
  ): Promise<Buffer> {
    const bucket = getCollabBucket();
    const objectPath = snapshotObjectPath({
      projectId,
      documentType: document.documentType,
      documentId: document.documentId,
    });
    try {
      return await this.supabase.downloadObject(objectPath, bucket);
    } catch (err) {
      if (
        isStorageObjectNotFoundError(err) &&
        document.documentType === 'foundry'
      ) {
        try {
          return await this.supabase.downloadObject(
            legacyFoundrySnapshotObjectPath({
              projectId,
              documentId: document.documentId,
            }),
            bucket,
          );
        } catch (legacyErr) {
          if (isStorageObjectNotFoundError(legacyErr)) return Buffer.alloc(0);
          throw legacyErr;
        }
      }
      if (isStorageObjectNotFoundError(err)) return Buffer.alloc(0);
      throw err;
    }
  }

  private async toSnapshotResponseWithPreview(
    row: CollaborationSnapshotRow,
  ): Promise<SnapshotResponse> {
    const objectPath = row.previewStorageRef
      ? objectPathFromStorageRef(row.previewStorageRef)
      : null;
    if (!objectPath || row.previewByteLength == null) {
      return toSnapshotResponse(row);
    }
    try {
      const previewUrl = await this.supabase.createSignedDownloadUrl(
        objectPath,
        3600,
        getCollabBucket(),
      );
      return toSnapshotResponse(row, { previewUrl });
    } catch {
      return toSnapshotResponse(row);
    }
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

  private notifyMentions(
    comment: ProjectCommentRow,
    mentionedUserIds?: string[],
  ): void {
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
    const document = await this.appData.getCollaborationDocumentById(
      projectId,
      documentId,
    );
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

function previewExtension(contentType: SnapshotPreviewMimeType): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/webp') return 'webp';
  return 'png';
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
