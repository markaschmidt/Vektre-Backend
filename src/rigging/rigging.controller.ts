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
import { CreateRiggingJobDto } from './dto/create-rigging-job.dto.js';
import { RiggingService } from './rigging.service.js';

@Controller('rigging')
export class RiggingController {
  constructor(private readonly rigging: RiggingService) {}

  /**
   * POST /rigging/jobs
   * Enqueue a RigAnything job for an existing storage-backed GLB.
   */
  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRiggingJobDto,
  ) {
    return this.rigging.createJob(user.id, dto);
  }

  /**
   * GET /rigging/jobs/:jobId
   * Poll durable Nest status (does not depend on RunPod for authz).
   */
  @Get('jobs/:jobId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
  ) {
    return this.rigging.getJob(user.id, jobId);
  }
}
