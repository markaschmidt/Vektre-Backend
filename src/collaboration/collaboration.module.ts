import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CollaborationController } from './collaboration.controller.js';
import { CollaborationService } from './collaboration.service.js';

@Module({
  imports: [IntegrationsModule, NotificationsModule],
  controllers: [CollaborationController],
  providers: [CollaborationService],
  exports: [CollaborationService],
})
export class CollaborationModule {}
