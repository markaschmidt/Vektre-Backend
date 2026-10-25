import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AppendUiMessageDto, ListUiMessagesDto } from './dto/message.dto.js';
import {
  AcceptUiMemoryDto,
  CreateUiMemoryDto,
  ListUiMemoryDto,
  SupersedeUiMemoryDto,
} from './dto/memory.dto.js';
import {
  CreateUiThreadDto,
  ListUiThreadsDto,
  UpdateUiThreadDto,
} from './dto/thread.dto.js';
import { UiAgentService } from './ui-agent.service.js';
import { ReconcileUiAgentRunDto, ReviewUiAgentRunDto } from './dto/run.dto.js';

@Controller('projects/:projectId/documents/:documentId/ui-agent')
export class UiAgentController {
  @Get('capabilities')
  getCapabilities(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.getCapabilities(projectId, documentId, user.id);
  }

  constructor(private readonly uiAgent: UiAgentService) {}

  @Get('threads')
  listThreads(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListUiThreadsDto,
  ) {
    return this.uiAgent.listThreads(projectId, documentId, user.id, dto);
  }

  @Post('threads')
  @HttpCode(HttpStatus.CREATED)
  createThread(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUiThreadDto,
  ) {
    return this.uiAgent.createThread(projectId, documentId, user.id, dto);
  }

  @Get('threads/:threadId')
  getThread(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.getThread(projectId, documentId, user.id, threadId);
  }

  @Patch('threads/:threadId')
  updateThread(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUiThreadDto,
  ) {
    return this.uiAgent.updateThread(
      projectId,
      documentId,
      user.id,
      threadId,
      dto,
    );
  }

  @Post('threads/:threadId/publish')
  publishThread(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.publishThread(projectId, documentId, user.id, threadId);
  }

  @Delete('threads/:threadId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteThread(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.uiAgent.deletePrivateThread(
      projectId,
      documentId,
      user.id,
      threadId,
    );
  }

  @Get('threads/:threadId/export')
  exportThread(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.exportPrivateThread(
      projectId,
      documentId,
      user.id,
      threadId,
    );
  }

  @Get('threads/:threadId/messages')
  listMessages(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListUiMessagesDto,
  ) {
    return this.uiAgent.listMessages(
      projectId,
      documentId,
      user.id,
      threadId,
      dto.limit,
      dto.cursor,
    );
  }

  @Post('threads/:threadId/messages')
  async appendMessage(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('threadId') threadId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AppendUiMessageDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.uiAgent.appendMessage(
      projectId,
      documentId,
      user.id,
      threadId,
      dto,
    );
    response.status(
      dto.execute === true ? HttpStatus.ACCEPTED : HttpStatus.CREATED,
    );
    return result;
  }

  @Get('memories')
  listMemory(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListUiMemoryDto,
  ) {
    return this.uiAgent.listMemory(projectId, documentId, user.id, dto);
  }

  @Post('memories')
  @HttpCode(HttpStatus.CREATED)
  createMemory(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUiMemoryDto,
  ) {
    return this.uiAgent.createMemory(projectId, documentId, user.id, dto);
  }

  @Post('memories/:memoryId/accept')
  acceptMemory(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptUiMemoryDto,
  ) {
    return this.uiAgent.acceptMemory(
      projectId,
      documentId,
      user.id,
      memoryId,
      dto.effectiveRevision,
    );
  }

  @Post('memories/:memoryId/reject')
  rejectMemory(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.rejectMemory(projectId, documentId, user.id, memoryId);
  }

  @Post('memories/:memoryId/publish')
  publishMemory(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.publishMemory(projectId, documentId, user.id, memoryId);
  }

  @Post('memories/:memoryId/supersede')
  supersedeMemory(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('memoryId') memoryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SupersedeUiMemoryDto,
  ) {
    return this.uiAgent.supersedeMemory(
      projectId,
      documentId,
      user.id,
      memoryId,
      dto.replacementMemoryId,
    );
  }

  @Get('runs/:runId/context')
  getContextManifest(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.getContextManifest(
      projectId,
      documentId,
      user.id,
      runId,
    );
  }

  @Get('runs/:runId')
  getRun(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.getRun(projectId, documentId, user.id, runId);
  }

  @Post('runs/:runId/cancel')
  cancelRun(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uiAgent.cancelRun(projectId, documentId, user.id, runId);
  }

  @Post('runs/:runId/review')
  reviewRun(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewUiAgentRunDto,
  ) {
    return this.uiAgent.reviewRun(projectId, documentId, user.id, runId, dto);
  }

  @Post('runs/:runId/reconcile')
  reconcileRun(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('runId') runId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReconcileUiAgentRunDto,
  ) {
    return this.uiAgent.reconcileRun(
      projectId,
      documentId,
      user.id,
      runId,
      dto,
    );
  }
}
