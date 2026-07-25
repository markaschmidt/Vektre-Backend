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
import { CanvasWorkflowsService } from './canvas-workflows.service.js';
import {
  RunCanvasActionBatchDto,
  RunCanvasActionDto,
} from './dto/run-canvas-action.dto.js';

@Controller('projects/:projectId/documents/:documentId/canvas')
export class CanvasWorkflowsController {
  constructor(private readonly workflows: CanvasWorkflowsService) {}

  /**
   * Machine-readable catalog of node kinds, ports, and action constraints.
   * Also the contract a future AI workflow planner should target.
   */
  @Get('capabilities')
  getCapabilities(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflows.getCapabilities(projectId, documentId, user.id);
  }

  /**
   * Idempotent action run. Retries with the same runId return the existing activity.
   */
  @Post('actions/run')
  @HttpCode(HttpStatus.ACCEPTED)
  runAction(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: RunCanvasActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflows.runAction(projectId, documentId, user.id, dto);
  }

  /**
   * Fan-out multiple independent action runs (parallel BullMQ jobs).
   * Each entry uses its own runId for idempotency; failures are isolated.
   */
  @Post('actions/run-batch')
  @HttpCode(HttpStatus.ACCEPTED)
  runActionBatch(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: RunCanvasActionBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workflows.runActionBatch(
      projectId,
      documentId,
      user.id,
      dto.actions,
    );
  }
}
