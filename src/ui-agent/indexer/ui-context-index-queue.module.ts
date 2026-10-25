import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { UI_CONTEXT_INDEX_QUEUE } from '../../queues/queue-names.js';
import { UiContextIndexQueue } from './ui-context-index.queue.js';
import { IntegrationsModule } from '../../integrations/integrations.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: UI_CONTEXT_INDEX_QUEUE }),
    IntegrationsModule,
  ],
  providers: [UiContextIndexQueue],
  exports: [UiContextIndexQueue],
})
export class UiContextIndexQueueModule {}
