import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './repositories/notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [IntegrationsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsRepository],
  exports: [NotificationsService],
})
export class NotificationsModule {}
