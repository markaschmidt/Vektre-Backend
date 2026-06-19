import type {
  ProjectMemberRole,
  UserProfileRow,
} from '../../integrations/app-data.types.js';
import { buildDisplayName } from '../../user/user-profile.helpers.js';

export type NotificationType =
  | 'project_invitation'
  | 'project_removed'
  | 'project_role_promoted'
  | 'project_role_demoted'
  | 'project_role_changed'
  | 'comment_mention'
  | 'comment_reply';

export type NotificationStatusFilter = 'all' | 'unread';

export type CommentNotificationTargetType = 'project' | 'asset' | 'document';

export interface NotificationActorSummary {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface NotificationRow {
  notificationId: string;
  userId: string;
  type: NotificationType;
  actorUserId?: string;
  projectId?: string;
  assetId?: string;
  documentId?: string;
  commentId?: string;
  parentCommentId?: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationResponse {
  notificationId: string;
  type: NotificationType;
  actorUserId?: string;
  actor?: NotificationActorSummary;
  projectId?: string;
  assetId?: string;
  documentId?: string;
  commentId?: string;
  parentCommentId?: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  actorUserId?: string;
  projectId?: string;
  assetId?: string;
  documentId?: string;
  commentId?: string;
  parentCommentId?: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface ListNotificationsInput {
  status?: NotificationStatusFilter;
  limit?: number;
  before?: Date;
}

export interface ProjectRoleChangeNotificationInput {
  projectId: string;
  projectName: string;
  userId: string;
  actorUserId: string;
  previousRole?: ProjectMemberRole;
  newRole: ProjectMemberRole;
}

export interface CommentNotificationInput {
  projectId: string;
  recipientUserId: string;
  authorUserId: string;
  commentId: string;
  body: string;
  targetType: CommentNotificationTargetType;
  targetId?: string;
  parentCommentId?: string;
}

export function toNotificationActorSummary(
  userId: string,
  profile: UserProfileRow | null | undefined,
): NotificationActorSummary {
  const displayName = buildDisplayName(
    profile?.displayName ?? undefined,
    profile?.preferences?.firstName,
    profile?.preferences?.lastName,
  );

  return {
    userId,
    ...(displayName ? { displayName } : {}),
    ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
  };
}

export function toNotificationResponse(
  row: NotificationRow,
  actor?: NotificationActorSummary,
): NotificationResponse {
  return {
    notificationId: row.notificationId,
    type: row.type,
    actorUserId: row.actorUserId,
    actor,
    projectId: row.projectId,
    assetId: row.assetId,
    documentId: row.documentId,
    commentId: row.commentId,
    parentCommentId: row.parentCommentId,
    title: row.title,
    body: row.body,
    metadata: row.metadata,
    readAt: row.readAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
