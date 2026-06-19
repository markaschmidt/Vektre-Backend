import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { INTEGRATION_SYNC_QUEUE } from '../../queues/queue-names.js';
import { AppDataService } from '../app-data.service.js';
import { ProviderCredentialService } from '../provider-credential.service.js';
import { NotionService } from './notion.service.js';
import type { NotionPageImportJob } from './notion.model.js';

@Processor(INTEGRATION_SYNC_QUEUE, { concurrency: 3 })
export class NotionProcessor extends WorkerHost {
  private readonly logger = new Logger(NotionProcessor.name);

  constructor(
    private readonly notion: NotionService,
    private readonly appData: AppDataService,
    private readonly credentials: ProviderCredentialService,
  ) {
    super();
  }

  async process(job: Job<NotionPageImportJob>): Promise<void> {
    this.logger.log(
      JSON.stringify({ event: 'notion_job_start', jobId: job.id, jobName: job.name }),
    );

    switch (job.name) {
      case 'notion-import-page':
        return this.handleImportPage(job);
      case 'notion-export-page':
        return this.handleExportPage(job);
      default:
        throw new Error(`Unknown Notion job: ${(job as Job).name as string}`);
    }
  }

  private async handleImportPage(job: Job<NotionPageImportJob>): Promise<void> {
    const { requestId, userId, pageId, pageTitle } = job.data;

    await this.appData.updateRequestStatus(requestId, 'processing');

    const token = await this.requireNotionToken(userId);

    const blocks = await this.notion.getPageBlocks({
      accessToken: token,
      pageId,
      userId,
    });

    const contentId = `notion:${pageId}`;
    await this.appData.createImportedContent({
      contentId,
      userId,
      provider: 'notion',
      externalId: pageId,
      title: pageTitle,
      contentType: 'notion/page',
      importedAt: new Date(),
      metadata: { blockCount: blocks.length },
    });

    await this.appData.updateRequestStatus(requestId, 'completed', {
      outputRef: contentId,
    });

    this.logger.log(
      JSON.stringify({
        event: 'notion_import_complete',
        requestId,
        userId,
        pageId,
        blockCount: blocks.length,
      }),
    );
  }

  private async handleExportPage(job: Job<NotionPageImportJob>): Promise<void> {
    const { requestId, userId, pageId } = job.data;

    await this.appData.updateRequestStatus(requestId, 'processing');

    const token = await this.requireNotionToken(userId);

    const blocks = await this.notion.getPageBlocks({
      accessToken: token,
      pageId,
      userId,
    });

    const assetId = randomUUID();
    const storageRef = `exports/notion/${userId}/${assetId}.json`;

    await this.appData.createExternalAsset({
      assetId,
      userId,
      requestId,
      provider: 'notion',
      assetType: 'document',
      mimeType: 'application/json',
      sourceUrl: `https://notion.so/${pageId.replaceAll('-', '')}`,
      storageRef,
    });

    await this.appData.updateRequestStatus(requestId, 'completed', {
      outputRef: storageRef,
    });

    this.logger.log(
      JSON.stringify({
        event: 'notion_export_complete',
        requestId,
        userId,
        pageId,
        blockCount: blocks.length,
      }),
    );
  }

  private async requireNotionToken(userId: string): Promise<string> {
    const stored = await this.credentials.get(userId, 'notion');
    if (!stored?.accessToken) {
      throw new Error(`No Notion OAuth token for user ${userId}`);
    }
    return stored.accessToken;
  }
}
