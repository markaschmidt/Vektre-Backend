import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { GenerativeModelController } from './generative-model.controller.js';
import { GenerativeModelService } from './generative-model.service.js';
import { GenerativeModelProcessor } from './generative-model.processor.js';
import { OpenAiProviderAdapter } from './providers/openai.provider.js';
import { OllamaProviderAdapter } from './providers/ollama.provider.js';
import { MODEL_PROVIDER_ADAPTERS } from './providers/model-provider.interface.js';
import { GENERATIVE_MODEL_QUEUE } from '../queues/queue-names.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ReplicateProviderAdapter } from '../integrations/replicate.provider.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { CanvasWorkflowsModule } from '../canvas-workflows/canvas-workflows.module.js';
import { GenerationCostEstimator } from './cost/generation-cost.estimator.js';
import { GenerationCostService } from './cost/generation-cost.service.js';
import { ProjectGenerationCostsFacade } from './cost/project-generation-costs.facade.js';
import { ProjectGenerationCostsController } from './cost/project-generation-costs.controller.js';
import { BillingModule } from '../billing/billing.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: GENERATIVE_MODEL_QUEUE }),
    IntegrationsModule,
    ConfigModule,
    ProjectsModule,
    forwardRef(() => CanvasWorkflowsModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [GenerativeModelController, ProjectGenerationCostsController],
  providers: [
    GenerativeModelService,
    GenerativeModelProcessor,
    ReplicateProviderAdapter,
    OpenAiProviderAdapter,
    OllamaProviderAdapter,
    GenerationCostEstimator,
    GenerationCostService,
    ProjectGenerationCostsFacade,
    {
      provide: MODEL_PROVIDER_ADAPTERS,
      useFactory: (openai: OpenAiProviderAdapter) => {
        const map = new Map();
        map.set('openai', openai);
        return map;
      },
      inject: [OpenAiProviderAdapter],
    },
  ],
  exports: [
    GenerativeModelService,
    GenerationCostService,
    ProjectGenerationCostsFacade,
  ],
})
export class GenerativeModelModule {}
