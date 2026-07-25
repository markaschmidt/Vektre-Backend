import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { CreateMesh2MotionJobDto } from './dto/create-mesh2motion-job.dto.js';
import { Mesh2MotionService } from './mesh2motion.service.js';

@Controller('mesh2motion')
export class Mesh2MotionController {
  constructor(private readonly mesh2motion: Mesh2MotionService) {}

  /**
   * GET /mesh2motion/health
   * Liveness check against the animator VPS (server-side only).
   */
  @Get('health')
  health() {
    return this.mesh2motion.health();
  }

  /**
   * GET /mesh2motion/skeletons
   * Proxy animator skeleton types + available animation clip names.
   */
  @Get('skeletons')
  listSkeletons(@CurrentUser() _user: AuthenticatedUser) {
    return this.mesh2motion.listSkeletons();
  }

  /**
   * POST /mesh2motion/jobs
   * Enqueue a Mesh2Motion archetype rig+animate job for an existing GLB asset.
   */
  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMesh2MotionJobDto,
  ) {
    return this.mesh2motion.createJob(user.id, dto);
  }

  /**
   * GET /mesh2motion/jobs/:jobId
   * Poll durable Nest status (does not depend on the Mesh2Motion VPS for authz).
   */
  @Get('jobs/:jobId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
  ) {
    return this.mesh2motion.getJob(user.id, jobId);
  }
}
