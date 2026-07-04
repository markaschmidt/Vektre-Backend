import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CollaborationDocumentsController } from './collaboration-documents.controller.js';
import { CollaborationDocumentsService } from './collaboration-documents.service.js';

@Module({
  imports: [IntegrationsModule, NotificationsModule],
  controllers: [CollaborationDocumentsController],
  providers: [CollaborationDocumentsService],
  exports: [CollaborationDocumentsService],
})
export class CollaborationDocumentsModule {}
