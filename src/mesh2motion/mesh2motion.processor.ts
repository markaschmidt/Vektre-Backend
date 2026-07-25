import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { AppDataService } from '../integrations/app-data.service.js';
import type { Mesh2MotionConfig } from '../config/mesh2motion.config.js';
import { AssetsService } from '../projects/assets.service.js';
import { outboundBinary } from '../integrations/outbound-http.js';
import { ProviderError } from '../integrations/provider-error.model.js';
import { MESH2MOTION_QUEUE } from '../queues/queue-names.js';
import { Mesh2MotionClient } from './mesh2motion.client.js';
import {
  JOB_MESH2MOTION,
  type Mesh2MotionQueueJob,
  type WorkerMesh2MotionStatus,
} from './models/mesh2motion-job.model.js';

@Processor(MESH2MOTION_QUEUE, { concurrency: 1 })
export class Mesh2MotionProcessor extends WorkerHost {
  private readonly logger = new Logger(Mesh2MotionProcessor.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly assets: AssetsService,
    private readonly client: Mesh2MotionClient,
    private readonly config: ConfigService,
  ) {
    super();
  }

  private cfg(): Mesh2MotionConfig {
    return this.config.getOrThrow<Mesh2MotionConfig>('mesh2motion');
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_MESH2MOTION) {
      throw new Error(`Unknown mesh2motion job: ${job.name}`);
    }
    await this.handleJob(job as Job<Mesh2MotionQueueJob>);
  }

  private async handleJob(job: Job<Mesh2MotionQueueJob>): Promise<void> {
    const data = job.data;
    const cfg = this.cfg();
    const local = await this.appData.getMesh2MotionJob(data.jobId);
    if (!local) {
      throw new Error(`Mesh2Motion job ${data.jobId} missing from database`);
    }
    if (local.status === 'completed') {
      return;
    }
    if (local.status === 'cancelled') {
      return;
    }

    await this.appData.updateMesh2MotionJob(data.jobId, {
      status: 'processing',
    });

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
      const upload = await this.assets.reserveMesh2MotionAssetUpload(
        data.userId,
        source,
        {
          outputAssetId: data.outputAssetId,
          name: output.name,
          skeletonType: data.skeletonType,
        },
      );

      let workerJobId = local.workerJobId;
      let shouldCreate = !workerJobId;

      if (workerJobId) {
        const existing = await this.client.getJob(workerJobId, {
          requestId: data.jobId,
          userId: data.userId,
        });
        if (existing.status === 'completed') {
          await this.finalizeOutput(
            workerJobId,
            data,
            upload.uploadUrl,
            local.resultJson ?? {},
          );
          return;
        }
        if (existing.status === 'failed') {
          shouldCreate = true;
          workerJobId = null;
        } else {
          shouldCreate = false;
        }
      }

      if (shouldCreate) {
        const sourceBytes = await outboundBinary({
          provider: 'animator',
          url: inputUrl,
          timeoutMs: Math.max(cfg.requestTimeoutMs, 120_000),
          requestId: data.jobId,
          userId: data.userId,
        });

        const animations =
          data.animationNames && data.animationNames.length > 0
            ? data.animationNames
            : 'all';

        const opts = data.workerOptions ?? {};
        const animatorOptions: Parameters<Mesh2MotionClient['createJob']>[2] = {
          skeleton_type: data.skeletonType,
          animations,
        };
        if (opts.boneNaming) {
          animatorOptions.bone_naming = opts.boneNaming;
        }
        if (opts.mirror !== undefined) {
          animatorOptions.mirror = opts.mirror;
        }
        if (opts.exportContents) {
          animatorOptions.export_contents = opts.exportContents;
        }
        if (opts.headWeightCorrection !== undefined) {
          animatorOptions.head_weight_correction = opts.headWeightCorrection;
        }
        if (opts.handSkeleton) {
          animatorOptions.hand_skeleton = opts.handSkeleton;
        }
        if (opts.boneOverrides) {
          animatorOptions.bone_overrides = opts.boneOverrides;
        }

        const created = await this.client.createJob(
          sourceBytes,
          source.name || 'model.glb',
          animatorOptions,
          {
            requestId: data.jobId,
            userId: data.userId,
          },
        );
        workerJobId = created.jobId;
        await this.appData.updateMesh2MotionJob(data.jobId, {
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
        await this.appData.updateProjectAssetStatus(
          data.outputAssetId,
          'failed',
        );
        await this.appData.updateMesh2MotionJob(data.jobId, {
          status: 'failed',
          errorMessage: terminal.error ?? 'Animator failed',
          resultJson: {
            ...(local.resultJson ?? {}),
            workerStatus: 'failed',
          },
        });
        throw new Error(terminal.error ?? 'Animator failed');
      }

      await this.finalizeOutput(
        workerJobId!,
        data,
        upload.uploadUrl,
        local.resultJson ?? {},
        terminal,
      );

      this.logger.log(
        JSON.stringify({
          event: 'mesh2motion_job_completed',
          jobId: data.jobId,
          workerJobId,
          outputAssetId: data.outputAssetId,
          skeletonType: data.skeletonType,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        err instanceof ProviderError
          ? err.retryable
          : /interrupted_by_restart|timed out|5\d\d/.test(message);

      if (!retryable) {
        await this.appData.updateProjectAssetStatus(
          data.outputAssetId,
          'failed',
        );
        await this.appData.updateMesh2MotionJob(data.jobId, {
          status: 'failed',
          errorMessage: message.slice(0, 2000),
        });
      } else {
        await this.appData.updateMesh2MotionJob(data.jobId, {
          status: 'processing',
          errorMessage: message.slice(0, 2000),
        });
      }

      this.logger.error(
        JSON.stringify({
          event: 'mesh2motion_job_failed',
          jobId: data.jobId,
          retryable,
          error: message,
        }),
      );

      throw err instanceof Error ? err : new Error(message);
    }
  }

  private async finalizeOutput(
    workerJobId: string,
    data: Mesh2MotionQueueJob,
    uploadUrl: string,
    previousResult: Record<string, unknown>,
    terminal?: { boneCount?: number; durationMs?: number },
  ): Promise<void> {
    const resultBytes = await this.client.downloadResult(workerJobId, {
      requestId: data.jobId,
      userId: data.userId,
    });
    await this.client.uploadToSignedUrl(uploadUrl, resultBytes);
    await this.assets.markAssetReadyFromStorage(data.outputAssetId, {
      sizeBytes: resultBytes.byteLength,
    });
    await this.appData.updateMesh2MotionJob(data.jobId, {
      status: 'completed',
      errorMessage: null,
      resultJson: {
        ...previousResult,
        workerStatus: 'completed',
        outputAssetId: data.outputAssetId,
        resultSizeBytes: resultBytes.byteLength,
        boneCount: terminal?.boneCount,
        durationMs: terminal?.durationMs,
      },
    });
  }

  private async pollWorker(
    workerJobId: string,
    requestId: string,
    userId: string,
    cfg: Mesh2MotionConfig,
    previousResult: Record<string, unknown>,
  ): Promise<{
    status: WorkerMesh2MotionStatus;
    error?: string | null;
    boneCount?: number;
    durationMs?: number;
  }> {
    const deadline = Date.now() + cfg.jobTimeoutMs;
    while (Date.now() < deadline) {
      const status = await this.client.getJob(workerJobId, {
        requestId,
        userId,
      });

      await this.appData.updateMesh2MotionJob(requestId, {
        resultJson: {
          ...previousResult,
          workerStatus: status.status,
          workerRawStatus: status.rawStatus,
          workerError: status.error ?? null,
          boneCount: status.boneCount,
          durationMs: status.durationMs,
        },
      });

      if (status.status === 'completed' || status.status === 'failed') {
        return {
          status: status.status,
          error: status.error,
          boneCount: status.boneCount,
          durationMs: status.durationMs,
        };
      }

      await sleep(cfg.pollIntervalMs);
    }
    throw ProviderError.retryable(
      'animator',
      `Animator job ${workerJobId} timed out`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
