import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { COLLAB_OPS_QUEUE } from '../queues/queue-names.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CollaborationDocumentsController } from './collaboration-documents.controller.js';
import { CollaborationDocumentsService } from './collaboration-documents.service.js';
import { CollaborationCommentNotificationsService } from './collaboration-comment-notifications.service.js';
import { CollaborationCommentNotificationsProcessor } from './collaboration-comment-notifications.processor.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: COLLAB_OPS_QUEUE }),
    IntegrationsModule,
    NotificationsModule,
  ],
  controllers: [CollaborationDocumentsController],
  providers: [
    CollaborationDocumentsService,
    CollaborationCommentNotificationsService,
    CollaborationCommentNotificationsProcessor,
  ],
  exports: [CollaborationDocumentsService],
})
export class CollaborationDocumentsModule {}
