import type {
  CollaborationActivityRow,
  CollaborationActivityStatus,
  CollaborationActivityType,
  CollaborationDocumentRow,
  CollaborationDocumentType,
  CollaborationSnapshotRow,
  ProjectCommentRow,
  ProjectCommentStatus,
  ProjectMemberRole,
} from '../../integrations/app-data.types.js';
import {
  buildDocumentName,
  buildSessionRoomName,
} from '../../collaboration-yjs/document-name.js';
import {
  listSurfaces,
  type CollaborationSurface,
} from './collaboration-surface.model.js';
import {
  PROJECT_SESSION_AWARENESS_CONTRACT,
  buildSurfaceAwarenessContract,
  type ProjectSessionAwarenessContract,
  type SurfaceAwarenessContract,
} from './collaboration-presence.model.js';

// ─── Documents ────────────────────────────────────────────────────────────────

export interface CollaborationDocumentResponse {
  documentKey: string;
  documentId: string;
  projectId: string;
  documentType: CollaborationDocumentType;
  title: string;
  version: number;
  createdByUserId?: string;
  updatedByUserId?: string;
  archived: boolean;
  archivedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toCollaborationDocumentResponse(
  row: CollaborationDocumentRow,
): CollaborationDocumentResponse {
  return {
    documentKey: row.documentKey,
    documentId: row.documentId,
    projectId: row.projectId,
    documentType: row.documentType,
    title: row.title,
    version: row.version,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    archived: Boolean(row.archivedAt),
    archivedAt: row.archivedAt?.toISOString(),
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Latest saved document bytes (raw Yjs update, base64-encoded), read
 * directly from Supabase Storage. Deliberately decoupled from the live
 * collaboration/Hocuspocus server: whether or not a client can reach the
 * collab websocket, it can always fall back to this endpoint to retrieve
 * the last durably-saved content for a document.
 */
export interface DocumentContentResponse {
  documentId: string;
  documentType: CollaborationDocumentType;
  version: number;
  /** False when the document row exists but no live-editing session has ever saved bytes yet. */
  hasContent: boolean;
  byteLength: number;
  /** Base64-encoded raw Yjs update; apply with Y.applyUpdate on a client-side Y.Doc. */
  dataBase64: string;
  updatedAt: string;
}

// ─── Collab config / project session (frontend editor startup contract) ────

/** Hocuspocus/Yjs provider wiring guidance returned to the desktop client. */
export interface CollaborationProviderConfig {
  /** Use one shared HocuspocusProviderWebsocket per open cloud project. */
  sharedWebsocket: true;
  /** Attach/detach document rooms over the shared socket (Hocuspocus multiplexing). */
  multiplexing: true;
  /** Enable sessionAwareness on HocuspocusProviderWebsocket when connecting to v4 server. */
  sessionAwareness: true;
  /** Stable project-level presence room — connect once per project entry. */
  projectSessionRoomName: string;
}

export interface CollaborationConfigResponse {
  projectId: string;
  role: ProjectMemberRole;
  canWrite: boolean;
  canComment: boolean;
  collabWsUrl: string;
  roomNaming: {
    projectSession: string;
    document: string;
  };
  provider: CollaborationProviderConfig;
  surfaces: CollaborationSurface[];
}

export function toCollaborationConfigResponse(input: {
  projectId: string;
  role: ProjectMemberRole;
  canWrite: boolean;
  canComment: boolean;
  collabWsUrl: string;
}): CollaborationConfigResponse {
  const sessionRoomName = projectSessionRoomName(input.projectId);
  return {
    projectId: input.projectId,
    role: input.role,
    canWrite: input.canWrite,
    canComment: input.canComment,
    collabWsUrl: input.collabWsUrl,
    roomNaming: {
      projectSession: sessionRoomName,
      document: `project:${input.projectId}:doc:{documentType}:{documentId}`,
    },
    provider: {
      sharedWebsocket: true,
      multiplexing: true,
      sessionAwareness: true,
      projectSessionRoomName: sessionRoomName,
    },
    surfaces: listSurfaces(),
  };
}

export function projectSessionRoomName(projectId: string): string {
  return buildSessionRoomName(projectId);
}

export interface ProjectSessionResponse {
  projectId: string;
  sessionRoomName: string;
  role: ProjectMemberRole;
  awarenessContract: ProjectSessionAwarenessContract;
  activeSurfaces: string[];
  activities: CollaborationActivityResponse[];
}

export function toProjectSessionResponse(input: {
  projectId: string;
  role: ProjectMemberRole;
  activities: CollaborationActivityRow[];
}): ProjectSessionResponse {
  return {
    projectId: input.projectId,
    sessionRoomName: projectSessionRoomName(input.projectId),
    role: input.role,
    awarenessContract: PROJECT_SESSION_AWARENESS_CONTRACT,
    activeSurfaces: [
      'dashboard',
      'storyboard',
      'foundry',
      'canvas',
      'gui_screen',
      'repository',
      'settings',
    ],
    activities: input.activities.map(toCollaborationActivityResponse),
  };
}

export interface SurfaceConnectionResponse {
  documentType: CollaborationDocumentType;
  documentName: string;
  awarenessContract: SurfaceAwarenessContract;
  surface: CollaborationSurface;
}

export function toSurfaceConnectionResponse(
  projectId: string,
  documentId: string,
  documentType: CollaborationDocumentType,
  surface: CollaborationSurface,
): SurfaceConnectionResponse {
  return {
    documentType,
    documentName: buildDocumentName(projectId, documentId, documentType),
    awarenessContract: buildSurfaceAwarenessContract(documentType),
    surface,
  };
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export interface CommentResponse {
  commentId: string;
  projectId: string;
  documentId?: string;
  assetId?: string;
  authorUserId: string;
  parentCommentId?: string;
  body: string;
  status: ProjectCommentStatus;
  anchor?: Record<string, unknown>;
  resolvedByUserId?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function toCommentResponse(row: ProjectCommentRow): CommentResponse {
  return {
    commentId: row.commentId,
    projectId: row.projectId,
    documentId: row.documentId,
    assetId: row.assetId,
    authorUserId: row.authorUserId,
    parentCommentId: row.parentCommentId,
    body: row.body,
    status: row.status,
    anchor: row.anchor,
    resolvedByUserId: row.resolvedByUserId,
    resolvedAt: row.resolvedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Version history ─────────────────────────────────────────────────────────

export interface SnapshotResponse {
  snapshotId: string;
  documentKey: string;
  documentId: string;
  byteLength?: number;
  createdByUserId?: string;
  createdAt: string;
}

export function toSnapshotResponse(
  row: CollaborationSnapshotRow,
): SnapshotResponse {
  return {
    snapshotId: row.snapshotId,
    documentKey: row.documentKey,
    documentId: row.documentId,
    byteLength: row.byteLength,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface RestoreSnapshotResponse {
  document: CollaborationDocumentResponse;
  restoredFromSnapshotId: string;
  /**
   * Restoring only rewrites storage — any clients with the document room
   * already open must reconnect to load the restored content, since the
   * live in-memory Yjs doc on the collab server is not mutated in place.
   */
  requiresReconnect: true;
}

// ─── Collaboration activity ───────────────────────────────────────────────────

export interface CollaborationActivityResponse {
  activityId: string;
  projectId: string;
  documentId?: string;
  documentType?: CollaborationDocumentType;
  requestId?: string;
  actorUserId: string;
  activityType: CollaborationActivityType;
  status: CollaborationActivityStatus;
  target?: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorMessage?: string;
  reconciled: boolean;
  reconciledAt?: string;
  workflowId?: string;
  nodeId?: string;
  runId?: string;
  actionKind?: string;
  createdAt: string;
  updatedAt: string;
}

export function toCollaborationActivityResponse(
  row: CollaborationActivityRow,
): CollaborationActivityResponse {
  return {
    activityId: row.activityId,
    projectId: row.projectId,
    documentId: row.documentId,
    documentType: row.documentType,
    requestId: row.requestId,
    actorUserId: row.actorUserId,
    activityType: row.activityType,
    status: row.status,
    target: row.target,
    result: row.result,
    errorMessage: row.errorMessage,
    reconciled: Boolean(row.reconciledAt),
    reconciledAt: row.reconciledAt?.toISOString(),
    workflowId: row.workflowId,
    nodeId: row.nodeId,
    runId: row.runId,
    actionKind: row.actionKind,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
