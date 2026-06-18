import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { GoogleDriveService } from './google-drive.service.js';
import { GoogleDriveController } from './google-drive.controller.js';
import { GoogleDriveProcessor } from './google-drive.processor.js';
import { INTEGRATION_SYNC_QUEUE } from '../../queues/queue-names.js';
import { IntegrationsModule } from '../integrations.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: INTEGRATION_SYNC_QUEUE }),
    IntegrationsModule,
    ConfigModule,
  ],
  controllers: [GoogleDriveController],
  providers: [GoogleDriveService, GoogleDriveProcessor],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
