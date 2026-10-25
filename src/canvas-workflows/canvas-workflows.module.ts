import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GENERATIVE_MODEL_QUEUE } from '../queues/queue-names.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { GenerativeModelModule } from '../generative-model/generative-model.module.js';
import { CanvasWorkflowsController } from './canvas-workflows.controller.js';
import { CanvasWorkflowsService } from './canvas-workflows.service.js';
import { CanvasAssetOutputService } from './canvas-asset-output.service.js';
import { CanvasImageSplitService } from './canvas-image-split.service.js';
import { ConceptArtActionHandler } from './handlers/concept-art.handler.js';
import { ImageEditActionHandler } from './handlers/image-edit.handler.js';
import { Model3dActionHandler } from './handlers/model-3d.handler.js';
import { ImageSplitActionHandler } from './handlers/image-split.handler.js';
import { CANVAS_ACTION_HANDLERS } from './canvas-action.interface.js';
import { StorageQuotaModule } from '../storage-quota/storage-quota.module.js';
import { UiContextIndexQueueModule } from '../ui-agent/indexer/ui-context-index-queue.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: GENERATIVE_MODEL_QUEUE }),
    IntegrationsModule,
    ProjectsModule,
    StorageQuotaModule,
    UiContextIndexQueueModule,
    forwardRef(() => GenerativeModelModule),
  ],
  controllers: [CanvasWorkflowsController],
  providers: [
    CanvasWorkflowsService,
    CanvasAssetOutputService,
    CanvasImageSplitService,
    ConceptArtActionHandler,
    ImageEditActionHandler,
    Model3dActionHandler,
    ImageSplitActionHandler,
    {
      provide: CANVAS_ACTION_HANDLERS,
      useFactory: (
        conceptArt: ConceptArtActionHandler,
        imageEdit: ImageEditActionHandler,
        model3d: Model3dActionHandler,
        imageSplit: ImageSplitActionHandler,
      ) => [conceptArt, imageEdit, model3d, imageSplit],
      inject: [
        ConceptArtActionHandler,
        ImageEditActionHandler,
        Model3dActionHandler,
        ImageSplitActionHandler,
      ],
    },
  ],
  exports: [
    CanvasWorkflowsService,
    CanvasAssetOutputService,
    CanvasImageSplitService,
  ],
})
export class CanvasWorkflowsModule {}
