import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { MESH2MOTION_QUEUE } from '../queues/queue-names.js';
import { mesh2MotionConfig } from '../config/mesh2motion.config.js';
import { Mesh2MotionClient } from './mesh2motion.client.js';
import { Mesh2MotionController } from './mesh2motion.controller.js';
import { Mesh2MotionProcessor } from './mesh2motion.processor.js';
import { Mesh2MotionService } from './mesh2motion.service.js';

@Module({
  imports: [
    ConfigModule.forFeature(mesh2MotionConfig),
    BullModule.registerQueue({ name: MESH2MOTION_QUEUE }),
    IntegrationsModule,
    ProjectsModule,
  ],
  controllers: [Mesh2MotionController],
  providers: [Mesh2MotionService, Mesh2MotionProcessor, Mesh2MotionClient],
  exports: [Mesh2MotionService, Mesh2MotionClient],
})
export class Mesh2MotionModule {}
