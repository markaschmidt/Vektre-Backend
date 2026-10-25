import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  USER_OPS_QUEUE,
  GENERATIVE_MODEL_QUEUE,
  INTEGRATION_SYNC_QUEUE,
  PROJECT_OPS_QUEUE,
  COLLAB_OPS_QUEUE,
  RIGGING_QUEUE,
  MESH2MOTION_QUEUE,
  BILLING_OPS_QUEUE,
  ORG_INTEGRATION_OPS_QUEUE,
  UI_CONTEXT_INDEX_QUEUE,
  UI_AGENT_QUEUE,
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
      { name: COLLAB_OPS_QUEUE },
      { name: RIGGING_QUEUE },
      { name: MESH2MOTION_QUEUE },
      { name: BILLING_OPS_QUEUE },
      { name: ORG_INTEGRATION_OPS_QUEUE },
      { name: UI_CONTEXT_INDEX_QUEUE },
      { name: UI_AGENT_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
