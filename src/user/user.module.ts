import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';
import { UserProcessor } from './user.processor.js';
import { USER_OPS_QUEUE } from '../queues/queue-names.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: USER_OPS_QUEUE }),
    IntegrationsModule,
  ],
  controllers: [UserController],
  providers: [UserService, UserProcessor],
})
export class UserModule {}
