import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { USER_OPS_QUEUE } from '../queues/queue-names.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { SupabaseService } from '../integrations/supabase.js';
import type { UserOpJobData, UserOpJobName } from './models/user-op-job.model.js';

@Processor(USER_OPS_QUEUE)
export class UserProcessor extends WorkerHost {
  private readonly logger = new Logger(UserProcessor.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
  ) {
    super();
  }

  async process(job: Job<UserOpJobData, void, UserOpJobName>): Promise<void> {
    this.logger.log(`Processing job ${job.id} (${job.name})`);

    switch (job.name) {
      case 'sync-provider-documents':
        return this.handleSyncProvider(job as Job<{
          userId: string;
          provider: string;
          requestId: string;
        }>);
      case 'recalculate-preferences':
        return this.handleRecalculatePreferences(job as Job<{
          userId: string;
          requestId: string;
        }>);
      default:
        throw new Error(`Unknown user-ops job: ${(job as Job).name}`);
    }
  }

  private async handleSyncProvider(
    job: Job<{ userId: string; provider: string; requestId: string }>,
  ): Promise<void> {
    const { userId, provider, requestId } = job.data;

    await this.appData.updateRequestStatus(requestId, 'processing');

    try {
      const providerToken = await this.supabase.getProviderToken(
        userId,
        provider,
      );

      if (!providerToken) {
        this.logger.warn(
          `No provider token for user ${userId} / ${provider}`,
        );
        await this.appData.updateRequestStatus(requestId, 'failed', {
          errorMessage: `No ${provider} token available`,
        });
        return;
      }

      // TODO: dispatch to a provider-specific adapter, e.g.:
      // await this.googleDriveAdapter.syncDocuments(userId, providerToken);

      await this.appData.updateRequestStatus(requestId, 'completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sync failed for ${userId}/${provider}: ${msg}`);
      await this.appData.updateRequestStatus(requestId, 'failed', {
        errorMessage: msg,
      });
      throw err;
    }
  }

  private async handleRecalculatePreferences(
    job: Job<{ userId: string; requestId: string }>,
  ): Promise<void> {
    const { userId, requestId } = job.data;

    await this.appData.updateRequestStatus(requestId, 'processing');

    try {
      // TODO: retrieve profile and compute derived preferences
      const profile = await this.appData.getUserProfile(userId);
      if (profile) {
        await this.appData.updateUserPreferences(
          userId,
          profile.preferences,
        );
      }
      await this.appData.updateRequestStatus(requestId, 'completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.appData.updateRequestStatus(requestId, 'failed', {
        errorMessage: msg,
      });
      throw err;
    }
  }
}
