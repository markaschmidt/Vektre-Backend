import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { RIGGING_QUEUE } from '../queues/queue-names.js';
import { rigAnythingConfig } from '../config/riganything.config.js';
import { RigAnythingClient } from './riganything.client.js';
import { RiggingController } from './rigging.controller.js';
import { RiggingProcessor } from './rigging.processor.js';
import { RiggingService } from './rigging.service.js';

@Module({
  imports: [
    ConfigModule.forFeature(rigAnythingConfig),
    BullModule.registerQueue({ name: RIGGING_QUEUE }),
    IntegrationsModule,
    ProjectsModule,
  ],
  controllers: [RiggingController],
  providers: [RiggingService, RiggingProcessor, RigAnythingClient],
  exports: [RiggingService, RigAnythingClient],
})
export class RiggingModule {}
