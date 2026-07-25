import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { AppDataService } from '../integrations/app-data.service.js';
import type { RigAnythingConfig } from '../config/riganything.config.js';
import { AssetsService } from '../projects/assets.service.js';
import { ProviderError } from '../integrations/provider-error.model.js';
import { RIGGING_QUEUE } from '../queues/queue-names.js';
import { RigAnythingClient } from './riganything.client.js';
import {
  JOB_RIG_ANYTHING,
  type RigAnythingQueueJob,
  type WorkerRigStatus,
} from './models/rigging-job.model.js';

@Processor(RIGGING_QUEUE, { concurrency: 1 })
export class RiggingProcessor extends WorkerHost {
  private readonly logger = new Logger(RiggingProcessor.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly assets: AssetsService,
    private readonly client: RigAnythingClient,
    private readonly config: ConfigService,
  ) {
    super();
  }

  private cfg(): RigAnythingConfig {
    return this.config.getOrThrow<RigAnythingConfig>('riganything');
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_RIG_ANYTHING) {
      throw new Error(`Unknown rigging job: ${job.name}`);
    }
    await this.handleRigJob(job as Job<RigAnythingQueueJob>);
  }

  private async handleRigJob(job: Job<RigAnythingQueueJob>): Promise<void> {
    const data = job.data;
    const cfg = this.cfg();
    const local = await this.appData.getRiggingJob(data.jobId);
    if (!local) {
      throw new Error(`Rigging job ${data.jobId} missing from database`);
    }
    if (local.status === 'completed') {
      return;
    }
    if (local.status === 'cancelled') {
      return;
    }

    await this.appData.updateRiggingJob(data.jobId, { status: 'processing' });

    try {
      const source = await this.assets.resolveAccessibleAsset(
        data.userId,
        data.sourceAssetId,
      );
      const output = await this.appData.getProjectAsset(data.outputAssetId);
      if (!output?.objectPath) {
        throw new Error('Output asset reservation missing objectPath');
      }

      const inputUrl = await this.assets.createSignedDownloadUrlForAsset(
        source,
        cfg.signedDownloadTtlSec,
      );
      const upload = await this.assets.reserveRiggedAssetUpload(
        data.userId,
        source,
        {
          outputAssetId: data.outputAssetId,
          name: output.name,
        },
      );

      const attempt = job.attemptsMade + 1;
      const idempotencyKey = `${data.workerIdempotencyKey}-a${attempt}`;

      let workerJobId = local.workerJobId;
      let shouldCreate = !workerJobId;
      if (workerJobId) {
        const existing = await this.client.getJob(workerJobId, {
          requestId: data.jobId,
          userId: data.userId,
        });
        if (existing.status === 'completed') {
          await this.assets.markAssetReadyFromStorage(data.outputAssetId);
          await this.appData.updateRiggingJob(data.jobId, {
            status: 'completed',
            errorMessage: null,
            resultJson: {
              ...(local.resultJson ?? {}),
              workerStatus: 'completed',
              outputAssetId: data.outputAssetId,
            },
          });
          return;
        }
        if (existing.status === 'failed') {
          // Restart / expired signed URLs — submit a fresh worker job.
          shouldCreate = true;
          workerJobId = null;
        } else {
          // Still in flight from a previous Nest attempt.
          shouldCreate = false;
        }
      }

      if (shouldCreate) {
        const created = await this.client.createJob(
          {
            inputUrl,
            outputUploadUrl: upload.uploadUrl,
            simplify: data.simplify,
            targetFaceCount: data.targetFaceCount,
          },
          {
            requestId: data.jobId,
            userId: data.userId,
            idempotencyKey,
          },
        );
        workerJobId = created.jobId;
        await this.appData.updateRiggingJob(data.jobId, {
          workerJobId,
          resultJson: {
            ...(local.resultJson ?? {}),
            workerStatus: created.status,
            outputStoragePath: upload.storagePath,
          },
        });
      }

      const terminal = await this.pollWorker(
        workerJobId!,
        data.jobId,
        data.userId,
        cfg,
        local.resultJson ?? {},
      );

      if (terminal.status === 'failed') {
        await this.appData.updateProjectAssetStatus(data.outputAssetId, 'failed');
        await this.appData.updateRiggingJob(data.jobId, {
          status: 'failed',
          errorMessage: terminal.error ?? 'RigAnything failed',
          resultJson: {
            ...(local.resultJson ?? {}),
            workerStatus: 'failed',
          },
        });
        throw new Error(terminal.error ?? 'RigAnything failed');
      }

      await this.assets.markAssetReadyFromStorage(data.outputAssetId);
      await this.appData.updateRiggingJob(data.jobId, {
        status: 'completed',
        errorMessage: null,
        resultJson: {
          ...(local.resultJson ?? {}),
          workerStatus: 'completed',
          outputAssetId: data.outputAssetId,
        },
      });

      this.logger.log(
        JSON.stringify({
          event: 'rigging_job_completed',
          jobId: data.jobId,
          workerJobId,
          outputAssetId: data.outputAssetId,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        err instanceof ProviderError ? err.retryable : /interrupted_by_restart|timed out|5\d\d/.test(message);

      if (!retryable) {
        await this.appData.updateProjectAssetStatus(data.outputAssetId, 'failed');
        await this.appData.updateRiggingJob(data.jobId, {
          status: 'failed',
          errorMessage: message.slice(0, 2000),
        });
      } else {
        await this.appData.updateRiggingJob(data.jobId, {
          status: 'processing',
          errorMessage: message.slice(0, 2000),
        });
      }

      this.logger.error(
        JSON.stringify({
          event: 'rigging_job_failed',
          jobId: data.jobId,
          retryable,
          error: message,
        }),
      );

      // Always rethrow so BullMQ applies attempts/backoff for retryable errors.
      // Permanent failures still rethrow once; heavyJobOptions caps attempts.
      throw err instanceof Error ? err : new Error(message);
    }
  }

  private async pollWorker(
    workerJobId: string,
    requestId: string,
    userId: string,
    cfg: RigAnythingConfig,
    previousResult: Record<string, unknown>,
  ): Promise<{ status: WorkerRigStatus; error?: string | null }> {
    const deadline = Date.now() + cfg.jobTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.client.getJob(workerJobId, {
        requestId,
        userId,
      });

      await this.appData.updateRiggingJob(requestId, {
        resultJson: {
          ...previousResult,
          workerStatus: status.status,
          workerError: status.error ?? null,
        },
      });

      if (status.status === 'completed' || status.status === 'failed') {
        return { status: status.status, error: status.error };
      }

      await sleep(cfg.pollIntervalMs);
    }
    throw ProviderError.retryable(
      'riganything',
      `RigAnything job ${workerJobId} timed out`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
