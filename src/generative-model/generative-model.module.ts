import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    BullModule.registerQueue({ name: GENERATIVE_MODEL_QUEUE }),
    IntegrationsModule,
    ConfigModule,
  ],
  controllers: [GenerativeModelController],
  providers: [
    GenerativeModelService,
    GenerativeModelProcessor,
    ReplicateProviderAdapter,
    OpenAiProviderAdapter,
    OllamaProviderAdapter,
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
})
export class GenerativeModelModule {}
