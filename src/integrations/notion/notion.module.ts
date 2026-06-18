import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { NotionService } from './notion.service.js';
import { NotionController } from './notion.controller.js';
import { NotionProcessor } from './notion.processor.js';
import { INTEGRATION_SYNC_QUEUE } from '../../queues/queue-names.js';
import { IntegrationsModule } from '../integrations.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: INTEGRATION_SYNC_QUEUE }),
    IntegrationsModule,
    ConfigModule,
  ],
  controllers: [NotionController],
  providers: [NotionService, NotionProcessor],
  exports: [NotionService],
})
export class NotionModule {}
