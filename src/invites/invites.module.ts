import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

@Module({
  imports: [IntegrationsModule, NotificationsModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
