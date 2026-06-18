import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.model.js';
import { SupabaseService } from '../supabase.js';
import { AppDataService } from '../app-data.service.js';
import { GoogleDriveService } from './google-drive.service.js';
import { INTEGRATION_SYNC_QUEUE, JOB_GOOGLE_DRIVE_IMPORT, JOB_GOOGLE_DRIVE_SYNC } from '../../queues/queue-names.js';
import { bullJobId } from '../../queues/bull-job-id.js';
import { defaultJobOptions } from '../../queues/job-options.js';
import { GoogleDriveListFilesDto, GoogleDriveImportFileDto } from './google-drive.dto.js';
import type { GoogleDriveImportJob } from './google-drive.model.js';

@Controller('integrations/google-drive')
export class GoogleDriveController {
  constructor(
    private readonly driveService: GoogleDriveService,
    private readonly supabase: SupabaseService,
    private readonly appData: AppDataService,
    @InjectQueue(INTEGRATION_SYNC_QUEUE)
    private readonly syncQueue: Queue,
  ) {}

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

  private async getAccessTokenOrThrow(userId: string): Promise<string> {
    const tokenMeta = await this.supabase.getProviderTokenWithMeta(userId, 'google');
    if (!tokenMeta?.accessToken) {
      throw new UnauthorizedException(
        'Google Drive is not connected. Please connect your Google account.',
      );
    }
    return tokenMeta.accessToken;
  }
}
