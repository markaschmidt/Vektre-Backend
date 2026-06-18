import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  USER_OPS_QUEUE,
  GENERATIVE_MODEL_QUEUE,
  INTEGRATION_SYNC_QUEUE,
  PROJECT_OPS_QUEUE,
} from './queue-names.js';
import { redisConfig } from './redis.config.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: redisConfig(),
      }),
    }),
    BullModule.registerQueue(
      { name: USER_OPS_QUEUE },
      { name: GENERATIVE_MODEL_QUEUE },
      { name: INTEGRATION_SYNC_QUEUE },
      { name: PROJECT_OPS_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
