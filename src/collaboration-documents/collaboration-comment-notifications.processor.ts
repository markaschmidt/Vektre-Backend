import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  COLLAB_OPS_QUEUE,
  JOB_COLLAB_COMMENT_NOTIFY,
} from '../queues/queue-names.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  toCommentNotificationInput,
  type CommentNotificationJob,
} from './models/comment-notification-job.model.js';

@Processor(COLLAB_OPS_QUEUE, { concurrency: 20 })
export class CollaborationCommentNotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(
    CollaborationCommentNotificationsProcessor.name,
  );

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<CommentNotificationJob>): Promise<void> {
    if (job.name !== JOB_COLLAB_COMMENT_NOTIFY) {
      throw new Error(`Unknown collab job: ${job.name}`);
    }

    const payload = job.data;
    switch (payload.kind) {
      case 'mention': {
        const input = toCommentNotificationInput(payload);
        if (input) await this.notifications.notifyCommentMention(input);
        break;
      }
      case 'reply': {
        const input = toCommentNotificationInput(payload);
        if (input) await this.notifications.notifyCommentReply(input);
        break;
      }
      case 'created':
      case 'resolved':
        this.logger.debug(
          `Processed comment ${payload.kind} activity for ${payload.commentId}`,
        );
        break;
      default:
        break;
    }
  }
}
