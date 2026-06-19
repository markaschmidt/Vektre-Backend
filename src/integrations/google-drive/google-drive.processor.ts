import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { INTEGRATION_SYNC_QUEUE } from '../../queues/queue-names.js';
import { AppDataService } from '../app-data.service.js';
import { GoogleDriveService } from './google-drive.service.js';
import { GoogleDriveTokenService } from './google-drive-token.service.js';
import { ProviderError } from '../provider-error.model.js';
import type { GoogleDriveImportJob } from './google-drive.model.js';

type GoogleDriveSyncJob = {
  userId: string;
  requestId: string;
};

@Processor(INTEGRATION_SYNC_QUEUE, { concurrency: 3 })
export class GoogleDriveProcessor extends WorkerHost {
  private readonly logger = new Logger(GoogleDriveProcessor.name);

  constructor(
    private readonly driveService: GoogleDriveService,
    private readonly driveTokens: GoogleDriveTokenService,
    private readonly appData: AppDataService,
  ) {
    super();
  }

  async process(
    job: Job<GoogleDriveSyncJob | GoogleDriveImportJob>,
  ): Promise<void> {
    this.logger.log(
      JSON.stringify({ event: 'drive_job_start', jobId: job.id, jobName: job.name }),
    );

    switch (job.name) {
      case 'google-drive-sync':
        return this.handleSync(job as Job<GoogleDriveSyncJob>);
      case 'google-drive-import':
        return this.handleImport(job as Job<GoogleDriveImportJob>);
      default:
        throw new Error(`Unknown Google Drive job: ${(job as Job).name as string}`);
    }
  }

  private async handleSync(job: Job<GoogleDriveSyncJob>): Promise<void> {
    const { userId, requestId } = job.data;

    const tokenMeta = await this.driveTokens.getTokenMeta(userId);
    if (!tokenMeta?.accessToken) {
      throw ProviderError.permanent(
        'google-drive',
        'No Google OAuth token for user. User must re-connect Google Drive.',
      );
    }

    await this.appData.updateRequestStatus(requestId, 'processing');

    let nextPageToken: string | undefined;
    let itemCount = 0;

    do {
      const result = await this.driveService.listFiles({
        accessToken: tokenMeta.accessToken,
        userId,
        pageToken: nextPageToken,
      });

      for (const file of result.files) {
        await this.appData.createImportedContent({
          contentId: `drive:${file.id}`,
          userId,
          provider: 'google-drive',
          externalId: file.id,
          title: file.name,
          contentType: file.mimeType,
          importedAt: new Date(),
          metadata: {
            size: file.size,
            modifiedTime: file.modifiedTime,
            webViewLink: file.webViewLink,
          },
        });
        itemCount++;
      }

      nextPageToken = result.nextPageToken;
    } while (nextPageToken);

    await this.appData.upsertProviderSync({
      userId,
      provider: 'google-drive',
      lastSyncedAt: new Date(),
      itemCount,
    });

    await this.appData.updateRequestStatus(requestId, 'completed');

    this.logger.log(
      JSON.stringify({ event: 'google_drive_sync_complete', userId, itemCount }),
    );
  }

  private async handleImport(job: Job<GoogleDriveImportJob>): Promise<void> {
    const { userId, requestId, fileId, fileName, mimeType, exportMimeType } =
      job.data;

    const tokenMeta = await this.driveTokens.getTokenMeta(userId);
    if (!tokenMeta?.accessToken) {
      throw ProviderError.permanent(
        'google-drive',
        'No Google OAuth token for user.',
      );
    }

    await this.appData.updateRequestStatus(requestId, 'processing');

    const resolvedExport =
      exportMimeType ?? this.driveService.getExportMimeType(mimeType);

    let downloadMime: string;
    let buffer: Buffer;

    if (resolvedExport) {
      const result = await this.driveService.exportFile({
        accessToken: tokenMeta.accessToken,
        userId,
        fileId,
        mimeType: resolvedExport,
      });
      buffer = result.buffer;
      downloadMime = result.mimeType;
    } else {
      const result = await this.driveService.downloadFile({
        accessToken: tokenMeta.accessToken,
        userId,
        fileId,
        mimeType,
      });
      buffer = result.buffer;
      downloadMime = result.mimeType;
    }

    const assetId = randomUUID();
    const storageRef = `imports/google-drive/${userId}/${assetId}`;

    // In production: write buffer to SpacetimeDB project_asset_blob chunks.
    this.logger.debug(
      JSON.stringify({
        event: 'google_drive_import_buffer_ready',
        assetId,
        bytes: buffer.length,
        storageRef,
      }),
    );

    await this.appData.createExternalAsset({
      assetId,
      userId,
      requestId,
      provider: 'google-drive',
      assetType: 'document',
      mimeType: downloadMime,
      sizeBytes: buffer.length,
      sourceUrl: `https://drive.google.com/file/d/${fileId}/view`,
      storageRef,
    });

    await this.appData.createImportedContent({
      contentId: `drive:${fileId}:imported`,
      userId,
      provider: 'google-drive',
      externalId: fileId,
      title: fileName,
      contentType: downloadMime,
      importedAt: new Date(),
      storageRef,
    });

    await this.appData.updateRequestStatus(requestId, 'completed', {
      outputRef: storageRef,
    });

    this.logger.log(
      JSON.stringify({ event: 'google_drive_import_complete', userId, fileId, assetId }),
    );
  }
}
