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
  | 'comment_reply'
  /** Sent to a specific user when invited by email */
  | 'invite_received'
  /** Sent to the inviter when someone accepts their code invite */
  | 'invite_accepted'
  /** Sent to the project owner when a member leaves voluntarily */
  | 'project_member_left'
  /** Sent to all members when the project owner deletes the project */
  | 'project_deleted';

export type NotificationStatusFilter = 'all' | 'unread';

/**
 * Why a user lost access to a project. Shared by in-app notifications and API errors
 * so the client can handle both `GET /notifications` and failed project requests
 * with the same branching logic.
 */
export type ProjectAccessLossReason = 'removed' | 'deleted';

export const PROJECT_ACCESS_LOSS_ERROR_CODES = {
  removed: 'PROJECT_ACCESS_REVOKED',
  deleted: 'PROJECT_DELETED',
} as const satisfies Record<ProjectAccessLossReason, string>;

export const PROJECT_ACCESS_LOSS_NOTIFICATION_TYPES: Record<
  ProjectAccessLossReason,
  NotificationType
> = {
  removed: 'project_removed',
  deleted: 'project_deleted',
};

export function notificationTypeForAccessLoss(
  reason: ProjectAccessLossReason,
): NotificationType {
  return PROJECT_ACCESS_LOSS_NOTIFICATION_TYPES[reason];
}

export function accessLossReasonFromNotification(
  type: NotificationType,
): ProjectAccessLossReason | null {
  switch (type) {
    case 'project_removed':
      return 'removed';
    case 'project_deleted':
      return 'deleted';
    default:
      return null;
  }
}

export function projectAccessLossMetadata(input: {
  reason: ProjectAccessLossReason;
  previousRole?: ProjectMemberRole;
}): Record<string, unknown> {
  return {
    reason: input.reason,
    ...(input.previousRole ? { previousRole: input.previousRole } : {}),
  };
}

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
