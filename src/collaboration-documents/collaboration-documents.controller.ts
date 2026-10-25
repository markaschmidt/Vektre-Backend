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
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { CollaborationDocumentsService } from './collaboration-documents.service.js';
import { CreateDocumentDto } from './dto/create-document.dto.js';
import { UpdateDocumentDto } from './dto/update-document.dto.js';
import { CreateCommentDto } from './dto/create-comment.dto.js';
import { CreateReplyDto } from './dto/create-reply.dto.js';
import { UpdateCommentDto } from './dto/update-comment.dto.js';
import { CreateActivityDto } from './dto/create-activity.dto.js';
import { UpdateActivityDto } from './dto/update-activity.dto.js';
import {
  CompleteSnapshotPreviewDto,
  CreateSnapshotDto,
  CreateSnapshotPreviewUploadDto,
} from './dto/create-snapshot.dto.js';

@Controller('projects/:projectId')
export class CollaborationDocumentsController {
  constructor(private readonly documents: CollaborationDocumentsService) {}

  // ─── Collab config / project session ────────────────────────────────────────

  /** Frontend calls this before opening any collaborative editor. */
  @Get('collaboration')
  getCollaborationConfig(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.getCollaborationConfig(projectId, user.id);
  }

  /** Room name + recommended awareness schema + current durable activity, for the project session room. */
  @Get('collaboration/session')
  getProjectSession(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.getProjectSession(projectId, user.id);
  }

  // ─── Documents ────────────────────────────────────────────────────────────────

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  createDocument(
    @Param('projectId') projectId: string,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createDocument(projectId, user.id, dto);
  }

  @Get('documents')
  listDocuments(
    @Param('projectId') projectId: string,
    @Query('type') type: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.listDocuments(projectId, user.id, type);
  }

  @Get('documents/:documentId')
  getDocument(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.getDocument(projectId, documentId, user.id);
  }

  /**
   * Returns the latest saved document bytes directly from storage,
   * independent of the live collaboration server — usable even when a
   * client can't reach (or hasn't yet connected to) the Hocuspocus websocket.
   */
  @Get('documents/:documentId/content')
  getDocumentContent(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.getDocumentContent(projectId, documentId, user.id);
  }

  @Patch('documents/:documentId')
  updateDocument(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.updateDocument(projectId, documentId, user.id, dto);
  }

  // ─── Comments ─────────────────────────────────────────────────────────────────

  @Get('documents/:documentId/comments')
  listComments(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.listComments(projectId, documentId, user.id);
  }

  @Post('documents/:documentId/comments')
  @HttpCode(HttpStatus.CREATED)
  createComment(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createComment(projectId, documentId, user.id, dto);
  }

  @Post('documents/:documentId/comments/:commentId/replies')
  @HttpCode(HttpStatus.CREATED)
  createReply(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @Body() dto: CreateReplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createReply(
      projectId,
      documentId,
      commentId,
      user.id,
      dto,
    );
  }

  @Patch('documents/:documentId/comments/:commentId')
  updateComment(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.updateComment(
      projectId,
      documentId,
      commentId,
      user.id,
      dto,
    );
  }

  @Post('documents/:documentId/comments/:commentId/resolve')
  resolveComment(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @Query('resolved') resolvedQuery: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const resolved = resolvedQuery !== 'false';
    return this.documents.resolveComment(
      projectId,
      documentId,
      commentId,
      user.id,
      resolved,
    );
  }

  @Delete('documents/:documentId/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.documents.deleteComment(
      projectId,
      documentId,
      commentId,
      user.id,
    );
  }

  // ─── Version history ───────────────────────────────────────────────────────

  @Post('documents/:documentId/versions')
  @HttpCode(HttpStatus.CREATED)
  createVersion(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: CreateSnapshotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createVersion(
      projectId,
      documentId,
      user.id,
      dto,
    );
  }

  @Get('documents/:documentId/versions')
  listVersions(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.listVersions(
      projectId,
      documentId,
      user.id,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('documents/:documentId/versions/:snapshotId')
  getVersion(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('snapshotId') snapshotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.getVersion(
      projectId,
      documentId,
      snapshotId,
      user.id,
    );
  }

  @Post('documents/:documentId/versions/:snapshotId/preview/upload')
  createVersionPreviewUpload(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('snapshotId') snapshotId: string,
    @Body() dto: CreateSnapshotPreviewUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createVersionPreviewUpload(
      projectId,
      documentId,
      snapshotId,
      user.id,
      dto,
    );
  }

  @Post('documents/:documentId/versions/:snapshotId/preview/complete')
  completeVersionPreview(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('snapshotId') snapshotId: string,
    @Body() dto: CompleteSnapshotPreviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.completeVersionPreview(
      projectId,
      documentId,
      snapshotId,
      user.id,
      dto,
    );
  }

  @Post('documents/:documentId/versions/:snapshotId/restore')
  restoreVersion(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Param('snapshotId') snapshotId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.restoreVersion(
      projectId,
      documentId,
      snapshotId,
      user.id,
    );
  }

  // ─── Collaboration activity (durable generation/import/sync) ────────────────

  @Post('documents/:documentId/activity')
  @HttpCode(HttpStatus.CREATED)
  createDocumentActivity(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createActivity(projectId, user.id, dto, documentId);
  }

  @Get('documents/:documentId/activity')
  listDocumentActivity(
    @Param('projectId') projectId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.listActivityForDocument(
      projectId,
      documentId,
      user.id,
    );
  }

  @Post('activity')
  @HttpCode(HttpStatus.CREATED)
  createProjectActivity(
    @Param('projectId') projectId: string,
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.createActivity(projectId, user.id, dto);
  }

  @Get('activity')
  listProjectActivity(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.listActivityForProject(projectId, user.id);
  }

  @Patch('activity/:activityId')
  updateActivity(
    @Param('projectId') projectId: string,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.updateActivity(projectId, activityId, user.id, dto);
  }

  @Post('activity/:activityId/sync')
  syncActivity(
    @Param('projectId') projectId: string,
    @Param('activityId') activityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.syncActivityFromRequest(
      projectId,
      activityId,
      user.id,
    );
  }

  @Post('activity/:activityId/reconcile')
  reconcileActivity(
    @Param('projectId') projectId: string,
    @Param('activityId') activityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.reconcileActivity(projectId, activityId, user.id);
  }
}
