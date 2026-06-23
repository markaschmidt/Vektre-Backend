import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PROJECT_OPS_QUEUE } from '../queues/queue-names.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsProcessor } from './projects.processor.js';
import { ProjectsService } from './projects.service.js';
import { AssetsService } from './assets.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CollaborationModule } from '../collaboration/collaboration.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: PROJECT_OPS_QUEUE }),
    IntegrationsModule,
    NotificationsModule,
    CollaborationModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsProcessor, AssetsService],
  exports: [AssetsService],
})
export class ProjectsModule {}
