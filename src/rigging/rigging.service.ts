import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import type { RigAnythingConfig } from '../config/riganything.config.js';
import { AssetsService } from '../projects/assets.service.js';
import { heavyJobOptions } from '../queues/job-options.js';
import { bullJobId } from '../queues/bull-job-id.js';
import { RIGGING_QUEUE } from '../queues/queue-names.js';
import { CreateRiggingJobDto } from './dto/create-rigging-job.dto.js';
import {
  JOB_RIG_ANYTHING,
  type CreateRiggingJobResponse,
  type RigAnythingQueueJob,
  type RiggingJobStatusResponse,
} from './models/rigging-job.model.js';

const GLB_MIME_HINTS = [
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream',
];

@Injectable()
export class RiggingService {
  private readonly logger = new Logger(RiggingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly appData: AppDataService,
    private readonly assets: AssetsService,
    @InjectQueue(RIGGING_QUEUE) private readonly queue: Queue,
  ) {}

  private cfg(): RigAnythingConfig {
    return this.config.getOrThrow<RigAnythingConfig>('riganything');
  }

  async createJob(
    userId: string,
    dto: CreateRiggingJobDto,
  ): Promise<CreateRiggingJobResponse> {
    const cfg = this.cfg();
    if (!cfg.enabled) {
      throw new ServiceUnavailableException(
        'RigAnything is not configured on this server',
      );
    }

    const simplify = dto.simplify ?? true;
    const targetFaceCount = dto.targetFaceCount ?? 8192;

    if (dto.clientRequestId) {
      const existing = await this.appData.getRiggingJobByIdempotencyKey(
        `client:${userId}:${dto.clientRequestId}`,
      );
      if (existing) {
        return {
          jobId: existing.jobId,
          assetId: existing.sourceAssetId,
          outputAssetId: existing.outputAssetId,
          status: existing.status,
        };
      }
    }

    const source = await this.assets.resolveAccessibleAsset(userId, dto.assetId);
    if (source.status !== 'ready' && source.status !== 'active') {
      throw new BadRequestException('Source asset is not ready');
    }
    if (!source.objectPath) {
      throw new BadRequestException('Source asset has no stored bytes');
    }
    const nameLooksGlb = source.name.toLowerCase().endsWith('.glb');
    const mimeOk =
      !source.mimeType ||
      GLB_MIME_HINTS.includes(source.mimeType) ||
      source.mimeType.includes('gltf');
    if (!nameLooksGlb && !mimeOk) {
      throw new BadRequestException('Source asset must be a GLB model');
    }

    const reserved = await this.assets.reserveRiggedAssetUpload(userId, source);
    const jobId = randomUUID();
    const clientKey = dto.clientRequestId
      ? `client:${userId}:${dto.clientRequestId}`
      : null;
    const workerIdempotencyKey = `rig-${jobId}`;

    await this.appData.createRiggingJob({
      jobId,
      userId,
      projectId: source.projectId,
      localProjectId: source.localProjectId,
      sourceAssetId: source.assetId,
      outputAssetId: reserved.assetId,
      workerJobId: null,
      idempotencyKey: clientKey,
      status: 'queued',
      simplify,
      targetFaceCount,
      errorMessage: null,
      resultJson: {
        outputStoragePath: reserved.storagePath,
        outputBucket: reserved.bucket,
      },
    });

    const payload: RigAnythingQueueJob = {
      jobId,
      userId,
      sourceAssetId: source.assetId,
      outputAssetId: reserved.assetId,
      simplify,
      targetFaceCount,
      workerIdempotencyKey,
      enqueuedAt: new Date().toISOString(),
    };

    await this.queue.add(JOB_RIG_ANYTHING, payload, {
      ...heavyJobOptions,
      jobId: bullJobId('rig', userId, jobId),
      // Serialize GPU work: one active Nest processor job at a time is set on
      // the processor; also keep attempts limited via heavyJobOptions.
    });

    this.logger.log(
      JSON.stringify({
        event: 'rigging_job_enqueued',
        jobId,
        userId,
        sourceAssetId: source.assetId,
        outputAssetId: reserved.assetId,
      }),
    );

    return {
      jobId,
      assetId: source.assetId,
      outputAssetId: reserved.assetId,
      status: 'queued',
    };
  }

  async getJob(
    userId: string,
    jobId: string,
  ): Promise<RiggingJobStatusResponse> {
    const job = await this.appData.getRiggingJob(jobId);
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Rigging job not found');
    }

    let riggedAssetUrl: string | null = null;
    if (job.status === 'completed') {
      const output = await this.appData.getProjectAsset(job.outputAssetId);
      if (output?.objectPath) {
        riggedAssetUrl = await this.assets.createSignedDownloadUrlForAsset(
          output,
          60 * 60,
        );
      }
    }

    // Prefer Nest durable status; surface worker detail from result_json when present.
    const workerStatus =
      typeof job.resultJson?.['workerStatus'] === 'string'
        ? (job.resultJson['workerStatus'] as string)
        : null;

    return {
      jobId: job.jobId,
      status: (workerStatus as RiggingJobStatusResponse['status']) ?? job.status,
      error: job.errorMessage ?? null,
      sourceAssetId: job.sourceAssetId,
      outputAssetId: job.outputAssetId,
      projectId: job.projectId,
      localProjectId: job.localProjectId,
      riggedAssetUrl,
      simplify: job.simplify,
      targetFaceCount: job.targetFaceCount,
    };
  }
}
