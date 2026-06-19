import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.model.js';
import { AppDataService } from '../app-data.service.js';
import { GoogleDriveService } from './google-drive.service.js';
import { INTEGRATION_SYNC_QUEUE, JOB_GOOGLE_DRIVE_IMPORT, JOB_GOOGLE_DRIVE_SYNC } from '../../queues/queue-names.js';
import { bullJobId } from '../../queues/bull-job-id.js';
import { defaultJobOptions } from '../../queues/job-options.js';
import { GoogleDriveListFilesDto, GoogleDriveImportFileDto, GoogleDriveExportDto, GoogleDriveConnectDto } from './google-drive.dto.js';
import type { GoogleDriveImportJob } from './google-drive.model.js';
import { ProviderError } from '../provider-error.model.js';
import { AssetsService } from '../../projects/assets.service.js';
import { GoogleDriveTokenService } from './google-drive-token.service.js';

@Controller('integrations/google-drive')
export class GoogleDriveController {
  constructor(
    private readonly driveService: GoogleDriveService,
    private readonly appData: AppDataService,
    private readonly assets: AssetsService,
    private readonly driveTokens: GoogleDriveTokenService,
    @InjectQueue(INTEGRATION_SYNC_QUEUE)
    private readonly syncQueue: Queue,
  ) {}

  /**
   * POST /integrations/google-drive/connect
   * Persist Google OAuth tokens from the Supabase browser session so server-side
   * Drive calls (/about, /export, etc.) can authenticate.
   */
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GoogleDriveConnectDto,
  ) {
    await this.driveTokens.saveTokens(user.id, {
      accessToken: dto.accessToken,
      refreshToken: dto.refreshToken,
      expiresAt: dto.expiresAt,
    });

    try {
      return await this.driveService.getAbout({
        accessToken: dto.accessToken,
        userId: user.id,
      });
    } catch (err) {
      throw mapDriveProviderError(err);
    }
  }

  /**
   * GET /integrations/google-drive/about
   * Return the authenticated Google Drive user info.
   */
  @Get('about')
  async getAbout(@CurrentUser() user: AuthenticatedUser) {
    const token = await this.getAccessTokenOrThrow(user.id);
    return this.driveService.getAbout({ accessToken: token, userId: user.id });
  }

  /**
   * GET /integrations/google-drive/files
   * List files in the user's Google Drive.
   */
  @Get('files')
  async listFiles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GoogleDriveListFilesDto,
  ) {
    const token = await this.getAccessTokenOrThrow(user.id);
    return this.driveService.listFiles({
      accessToken: token,
      userId: user.id,
      pageToken: query.pageToken,
      query: query.query,
    });
  }

  /**
   * POST /integrations/google-drive/files/:fileId/import
   * Queue a download/export and record the result in SpacetimeDB.
   * Returns 202 with requestId for status polling.
   */
  @Post('files/:fileId/import')
  @HttpCode(HttpStatus.ACCEPTED)
  async importFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId') fileId: string,
    @Body() dto: GoogleDriveImportFileDto,
  ) {
    const token = await this.getAccessTokenOrThrow(user.id);

    // Fetch file metadata to populate the job
    const file = await this.driveService.getFile({
      accessToken: token,
      userId: user.id,
      fileId,
    });

    const requestId = randomUUID();
    const jobId = bullJobId('drive-import', user.id, fileId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId: user.id,
      type: 'google-drive-import',
      status: 'queued',
    });

    const payload: GoogleDriveImportJob = {
      requestId,
      userId: user.id,
      fileId,
      fileName: file.name,
      mimeType: file.mimeType,
      exportMimeType: dto.mimeType,
    };

    await this.syncQueue.add(JOB_GOOGLE_DRIVE_IMPORT, payload, {
      ...defaultJobOptions,
      jobId,
    });

    return { requestId, status: 'queued', fileId, fileName: file.name };
  }

  /**
   * POST /integrations/google-drive/sync
   * Trigger a full metadata sync of the user's Drive into SpacetimeDB.
   */
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(@CurrentUser() user: AuthenticatedUser) {
    const requestId = randomUUID();
    const jobId = bullJobId('drive-sync', user.id, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId: user.id,
      type: 'google-drive-sync',
      status: 'queued',
    });

    await this.syncQueue.add(
      JOB_GOOGLE_DRIVE_SYNC,
      { userId: user.id, requestId },
      { ...defaultJobOptions, jobId },
    );

    return { requestId, status: 'queued' };
  }

  /**
   * POST /integrations/google-drive/export
   * Upload content from Vektre into the user's Google Drive.
   * Supports markdown/text, inline binary (base64), and project assets (e.g. 3D models).
   */
  @Post('export')
  @HttpCode(HttpStatus.OK)
  async exportToDrive(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GoogleDriveExportDto,
  ) {
    const token = await this.getAccessTokenOrThrow(user.id);
    const exportInput = await this.resolveExportInput(user.id, dto);

    try {
      return await this.driveService.exportToDrive({
        accessToken: token,
        userId: user.id,
        ...exportInput,
        folderId: dto.folderId,
        fileId: dto.fileId,
      });
    } catch (err) {
      throw mapDriveProviderError(err);
    }
  }

  private async resolveExportInput(
    userId: string,
    dto: GoogleDriveExportDto,
  ): Promise<{
    fileName: string;
    mimeType: string;
    content: Buffer | string;
    contentMimeType: string;
  }> {
    const textContent = dto.markdown ?? dto.content;
    const modes = [textContent, dto.contentBase64, dto.assetId].filter(
      (value) => value != null && String(value).length > 0,
    );
    if (modes.length !== 1) {
      throw new BadRequestException(
        'Provide exactly one export source: markdown/content, contentBase64, or assetId',
      );
    }

    if (dto.assetId) {
      if (!dto.projectId) {
        throw new BadRequestException('projectId is required when exporting assetId');
      }

      const asset = await this.assets.getAssetBytes(userId, dto.projectId, dto.assetId);
      const mimeType = dto.mimeType ?? asset.mimeType ?? 'application/octet-stream';
      return {
        fileName: dto.fileName ?? dto.title ?? asset.name ?? 'export',
        mimeType,
        content: Buffer.from(asset.dataBase64, 'base64'),
        contentMimeType: mimeType,
      };
    }

    if (dto.contentBase64) {
      const mimeType = dto.mimeType ?? 'application/octet-stream';
      const fileName = dto.fileName ?? dto.title;
      if (!fileName?.trim()) {
        throw new BadRequestException('fileName or title is required for binary export');
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(dto.contentBase64, 'base64');
      } catch {
        throw new BadRequestException('contentBase64 must be valid base64');
      }
      if (buffer.byteLength === 0) {
        throw new BadRequestException('contentBase64 decoded to empty content');
      }

      return {
        fileName: fileName.trim(),
        mimeType,
        content: buffer,
        contentMimeType: mimeType,
      };
    }

    if (!textContent?.trim()) {
      throw new BadRequestException('markdown or content is required');
    }

    const fileName = dto.fileName ?? dto.title;
    if (!fileName?.trim()) {
      throw new BadRequestException('fileName or title is required');
    }

    const targetMimeType = this.driveService.resolveExportTargetMimeType(dto.mimeType);
    return {
      fileName: fileName.trim(),
      mimeType: targetMimeType,
      content: textContent,
      contentMimeType:
        targetMimeType === 'application/vnd.google-apps.document'
          ? 'text/markdown'
          : 'text/markdown',
    };
  }

  private async getAccessTokenOrThrow(userId: string): Promise<string> {
    const tokenMeta = await this.driveTokens.getTokenMeta(userId);
    if (!tokenMeta?.accessToken) {
      throw new UnauthorizedException(
        'Google Drive is not connected. Complete Google sign-in, then POST /integrations/google-drive/connect with session.provider_token.',
      );
    }
    return tokenMeta.accessToken;
  }
}

function mapDriveProviderError(err: unknown): Error {
  if (!(err instanceof ProviderError)) return err as Error;

  if (err.statusCode === 401) {
    return new UnauthorizedException(
      'Google Drive authorization failed. Please reconnect your Google account.',
    );
  }
  if (err.statusCode === 403) {
    return new ForbiddenException(
      'Google Drive denied access. Ensure Drive scope is granted and try reconnecting Google.',
    );
  }
  if (err.statusCode === 400) {
    return new BadRequestException(err.message);
  }

  return new BadGatewayException(err.message);
}
