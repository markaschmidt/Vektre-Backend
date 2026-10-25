import type { CommentNotificationInput } from '../../notifications/models/notification.model.js';

export type CommentNotificationKind =
  | 'mention'
  | 'reply'
  | 'created'
  | 'resolved';

export interface CommentNotificationJob {
  kind: CommentNotificationKind;
  projectId: string;
  authorUserId: string;
  commentId: string;
  body: string;
  documentId?: string;
  assetId?: string;
  parentCommentId?: string;
  recipientUserId?: string;
  mentionedUserIds?: string[];
  resolved?: boolean;
}

export function toCommentNotificationInput(
  job: CommentNotificationJob,
): CommentNotificationInput | null {
  if (job.kind === 'mention' || job.kind === 'reply') {
    if (!job.recipientUserId) return null;
    return {
      projectId: job.projectId,
      recipientUserId: job.recipientUserId,
      authorUserId: job.authorUserId,
      commentId: job.commentId,
      body: job.body,
      targetType: job.documentId
        ? 'document'
        : job.assetId
          ? 'asset'
          : 'project',
      targetId: job.documentId ?? job.assetId ?? job.projectId,
      parentCommentId: job.parentCommentId,
    };
  }
  return null;
}
