import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  COLLAB_OPS_QUEUE,
  JOB_COLLAB_COMMENT_NOTIFY,
} from '../queues/queue-names.js';
import { defaultJobOptions } from '../queues/job-options.js';
import type { CommentNotificationJob } from './models/comment-notification-job.model.js';

@Injectable()
export class CollaborationCommentNotificationsService {
  private readonly logger = new Logger(
    CollaborationCommentNotificationsService.name,
  );

  constructor(
    @InjectQueue(COLLAB_OPS_QUEUE)
    private readonly collabQueue: Queue<CommentNotificationJob>,
  ) {}

  enqueue(job: CommentNotificationJob): void {
    const jobId = `collab-comment-${job.kind}-${job.commentId}-${randomUUID()}`;
    void this.collabQueue
      .add(JOB_COLLAB_COMMENT_NOTIFY, job, {
        ...defaultJobOptions,
        jobId,
      })
      .catch((err) => {
        this.logger.error(
          `Failed to enqueue comment notification ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  enqueueMentions(input: {
    projectId: string;
    authorUserId: string;
    commentId: string;
    body: string;
    documentId?: string;
    assetId?: string;
    parentCommentId?: string;
    mentionedUserIds?: string[];
  }): void {
    if (!input.mentionedUserIds || input.mentionedUserIds.length === 0) return;
    const uniqueRecipients = [...new Set(input.mentionedUserIds)].filter(
      (id) => id !== input.authorUserId,
    );
    for (const recipientUserId of uniqueRecipients) {
      this.enqueue({
        kind: 'mention',
        projectId: input.projectId,
        authorUserId: input.authorUserId,
        commentId: input.commentId,
        body: input.body,
        documentId: input.documentId,
        assetId: input.assetId,
        parentCommentId: input.parentCommentId,
        recipientUserId,
      });
    }
  }

  enqueueReply(input: {
    projectId: string;
    authorUserId: string;
    recipientUserId: string;
    commentId: string;
    body: string;
    documentId?: string;
    assetId?: string;
    parentCommentId?: string;
  }): void {
    if (input.recipientUserId === input.authorUserId) return;
    this.enqueue({
      kind: 'reply',
      ...input,
    });
  }
}
