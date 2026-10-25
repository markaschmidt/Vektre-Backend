import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { GenerativeModelModule } from '../generative-model/generative-model.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { UI_AGENT_QUEUE } from '../queues/queue-names.js';
import { UiContextRepository } from './repositories/ui-context.repository.js';
import { UiConversationRepository } from './repositories/ui-conversation.repository.js';
import { UiMemoryRepository } from './repositories/ui-memory.repository.js';
import { UiAgentController } from './ui-agent.controller.js';
import { UiAgentService } from './ui-agent.service.js';
import { UiContextAssembler } from './indexer/ui-context-assembler.js';
import { UiContextFreshnessService } from './indexer/ui-context-freshness.service.js';
import { UiContextIndexProcessor } from './indexer/ui-context-index.processor.js';
import { UiContextIndexQueueModule } from './indexer/ui-context-index-queue.module.js';
import { UiContextIndexRepository } from './indexer/ui-context-index.repository.js';
import { UiContextIndexService } from './indexer/ui-context-index.service.js';
import { UiAgentQueue } from './ui-agent.queue.js';
import { UiAiClient } from './ui-ai.client.js';
import { UiAgentWorkflowService } from './ui-agent-workflow.service.js';
import { UiAgentProcessor } from './ui-agent.processor.js';
import { UiAgentQualityService } from './observability/ui-agent-quality.service.js';
import { UiAgentOperationsService } from './observability/ui-agent-operations.service.js';
import { UiAgentOperationsController } from './observability/ui-agent-operations.controller.js';

@Module({
  imports: [
    IntegrationsModule,
    UiContextIndexQueueModule,
    BullModule.registerQueue({ name: UI_AGENT_QUEUE }),
    BillingModule,
    GenerativeModelModule,
    ProjectsModule,
  ],
  controllers: [UiAgentController, UiAgentOperationsController],
  providers: [
    UiAgentService,
    UiConversationRepository,
    UiMemoryRepository,
    UiContextRepository,
    UiContextIndexRepository,
    UiContextIndexService,
    UiContextIndexProcessor,
    UiContextFreshnessService,
    UiContextAssembler,
    UiAgentQueue,
    UiAiClient,
    UiAgentWorkflowService,
    UiAgentProcessor,
    UiAgentQualityService,
    UiAgentOperationsService,
  ],
  exports: [
    UiAgentService,
    UiConversationRepository,
    UiMemoryRepository,
    UiContextRepository,
    UiContextIndexService,
    UiContextFreshnessService,
    UiContextAssembler,
    UiAgentQualityService,
  ],
})
export class UiAgentModule {}
