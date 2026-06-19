import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.model.js';
import { NotionService } from './notion.service.js';
import { AppDataService } from '../app-data.service.js';
import { ProviderCredentialService } from '../provider-credential.service.js';
import {
  INTEGRATION_SYNC_QUEUE,
  JOB_NOTION_IMPORT_PAGE,
  JOB_NOTION_EXPORT_PAGE,
} from '../../queues/queue-names.js';
import { bullJobId } from '../../queues/bull-job-id.js';
import { defaultJobOptions } from '../../queues/job-options.js';
import {
  NotionSearchDto,
  NotionOAuthExchangeDto,
  NotionExportPageDto,
} from './notion.dto.js';
import type { NotionPageImportJob } from './notion.model.js';

@Controller('integrations/notion')
export class NotionController {
  constructor(
    private readonly notion: NotionService,
    private readonly appData: AppDataService,
    private readonly credentials: ProviderCredentialService,
    @InjectQueue(INTEGRATION_SYNC_QUEUE)
    private readonly syncQueue: Queue,
  ) {}

  /**
   * POST /integrations/notion/oauth/exchange
   * Exchange a Notion OAuth code for an access token.
   * Requires the caller's Supabase JWT so tokens are stored for the signed-in user.
   */
  @Post('oauth/exchange')
  async exchangeOAuth(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: NotionOAuthExchangeDto,
  ) {
    const tokenResponse = await this.notion.exchangeOAuthCode({
      code: dto.code,
      redirectUri: dto.redirectUri,
    });

    await this.credentials.save({
      userId: user.id,
      provider: 'notion',
      accessToken: tokenResponse.access_token,
    });

    return {
      workspaceId: tokenResponse.workspace_id,
      workspaceName: tokenResponse.workspace_name,
      connected: true,
    };
  }

  /**
   * POST /integrations/notion/search
   * Search pages and databases in the user's connected workspace.
   */
  @Post('search')
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: NotionSearchDto,
  ) {
    const token = await this.getTokenOrThrow(user.id);
    return this.notion.search({
      accessToken: token,
      query: dto.query,
      filter: dto.filter,
      userId: user.id,
    });
  }

  /**
   * GET /integrations/notion/pages/:pageId/blocks
   * Retrieve block children for a Notion page.
   */
  @Get('pages/:pageId/blocks')
  async getPageBlocks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('pageId') pageId: string,
  ) {
    const token = await this.getTokenOrThrow(user.id);
    return this.notion.getPageBlocks({
      accessToken: token,
      pageId,
      userId: user.id,
    });
  }

  /**
   * POST /integrations/notion/pages/export
   * Import (read) a Notion page into SpacetimeDB via a background job.
   */
  @Post('pages/import')
  @HttpCode(HttpStatus.ACCEPTED)
  async importPage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { pageId: string; pageTitle?: string },
  ) {
    await this.getTokenOrThrow(user.id);

    const requestId = randomUUID();
    const jobId = bullJobId('notion-import', user.id, dto.pageId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId: user.id,
      type: 'notion-import-page',
      status: 'queued',
    });

    const payload: NotionPageImportJob = {
      requestId,
      userId: user.id,
      pageId: dto.pageId,
      pageTitle: dto.pageTitle ?? 'Untitled',
    };

    await this.syncQueue.add(JOB_NOTION_IMPORT_PAGE, payload, {
      ...defaultJobOptions,
      jobId,
    });

    return { requestId, status: 'queued', pageId: dto.pageId };
  }

  /**
   * POST /integrations/notion/pages/export
   * Export a Notion page to durable storage via a background job.
   */
  @Post('pages/export')
  @HttpCode(HttpStatus.ACCEPTED)
  async exportPage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: NotionExportPageDto,
  ) {
    await this.getTokenOrThrow(user.id);

    const requestId = randomUUID();
    const jobId = bullJobId('notion-export', user.id, dto.pageId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId: user.id,
      type: 'notion-export-page',
      status: 'queued',
    });

    const payload: NotionPageImportJob = {
      requestId,
      userId: user.id,
      pageId: dto.pageId,
      pageTitle: '',
    };

    await this.syncQueue.add(JOB_NOTION_EXPORT_PAGE, payload, {
      ...defaultJobOptions,
      jobId,
    });

    return { requestId, status: 'queued', pageId: dto.pageId };
  }

  private async getTokenOrThrow(userId: string): Promise<string> {
    const stored = await this.credentials.get(userId, 'notion');
    if (!stored?.accessToken) {
      throw new UnauthorizedException(
        'Notion is not connected. Complete OAuth via POST /integrations/notion/oauth/exchange.',
      );
    }
    return stored.accessToken;
  }
}
