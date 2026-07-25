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
import type { Mesh2MotionConfig } from '../config/mesh2motion.config.js';
import { AssetsService } from '../projects/assets.service.js';
import { heavyJobOptions } from '../queues/job-options.js';
import { bullJobId } from '../queues/bull-job-id.js';
import { MESH2MOTION_QUEUE } from '../queues/queue-names.js';
import {
  CreateMesh2MotionJobDto,
  resolveMesh2MotionAnimations,
  resolveMesh2MotionWorkerOptions,
} from './dto/create-mesh2motion-job.dto.js';
import { Mesh2MotionClient } from './mesh2motion.client.js';
import {
  JOB_MESH2MOTION,
  type CreateMesh2MotionJobResponse,
  type Mesh2MotionJobStatusResponse,
  type Mesh2MotionQueueJob,
  type Mesh2MotionSkeletonType,
} from './models/mesh2motion-job.model.js';

const GLB_MIME_HINTS = [
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream',
];

@Injectable()
export class Mesh2MotionService {
  private readonly logger = new Logger(Mesh2MotionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly appData: AppDataService,
    private readonly assets: AssetsService,
    private readonly client: Mesh2MotionClient,
    @InjectQueue(MESH2MOTION_QUEUE) private readonly queue: Queue,
  ) {}

  private cfg(): Mesh2MotionConfig {
    return this.config.getOrThrow<Mesh2MotionConfig>('mesh2motion');
  }

  async createJob(
    userId: string,
    dto: CreateMesh2MotionJobDto,
  ): Promise<CreateMesh2MotionJobResponse> {
    const cfg = this.cfg();
    if (!cfg.enabled) {
      throw new ServiceUnavailableException(
        'Mesh2Motion is not configured on this server',
      );
    }

    const skeletonType = dto.skeletonType;
    const animationNames = resolveMesh2MotionAnimations(dto);
    const workerOptions = resolveMesh2MotionWorkerOptions(dto);

    if (dto.clientRequestId) {
      const existing = await this.appData.getMesh2MotionJobByIdempotencyKey(
        `client:${userId}:${dto.clientRequestId}`,
      );
      if (existing) {
        return {
          jobId: existing.jobId,
          assetId: existing.sourceAssetId,
          outputAssetId: existing.outputAssetId,
          skeletonType: existing.skeletonType as Mesh2MotionSkeletonType,
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

    const reserved = await this.assets.reserveMesh2MotionAssetUpload(
      userId,
      source,
      { skeletonType },
    );
    const jobId = randomUUID();
    const clientKey = dto.clientRequestId
      ? `client:${userId}:${dto.clientRequestId}`
      : null;
    const workerIdempotencyKey = `m2m-${jobId}`;

    await this.appData.createMesh2MotionJob({
      jobId,
      userId,
      projectId: source.projectId,
      localProjectId: source.localProjectId,
      sourceAssetId: source.assetId,
      outputAssetId: reserved.assetId,
      workerJobId: null,
      idempotencyKey: clientKey,
      status: 'queued',
      skeletonType,
      animationNames,
      errorMessage: null,
      resultJson: {
        outputStoragePath: reserved.storagePath,
        outputBucket: reserved.bucket,
        skeletonType,
        animationNames,
        workerOptions,
      },
    });

    const payload: Mesh2MotionQueueJob = {
      jobId,
      userId,
      sourceAssetId: source.assetId,
      outputAssetId: reserved.assetId,
      skeletonType,
      animationNames,
      workerOptions,
      workerIdempotencyKey,
      enqueuedAt: new Date().toISOString(),
    };

    await this.queue.add(JOB_MESH2MOTION, payload, {
      ...heavyJobOptions,
      jobId: bullJobId('m2m', userId, jobId),
    });

    this.logger.log(
      JSON.stringify({
        event: 'mesh2motion_job_enqueued',
        jobId,
        userId,
        sourceAssetId: source.assetId,
        outputAssetId: reserved.assetId,
        skeletonType,
      }),
    );

    return {
      jobId,
      assetId: source.assetId,
      outputAssetId: reserved.assetId,
      skeletonType,
      status: 'queued',
    };
  }

  async getJob(
    userId: string,
    jobId: string,
  ): Promise<Mesh2MotionJobStatusResponse> {
    const job = await this.appData.getMesh2MotionJob(jobId);
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Mesh2Motion job not found');
    }

    let animatedAssetUrl: string | null = null;
    if (job.status === 'completed') {
      const output = await this.appData.getProjectAsset(job.outputAssetId);
      if (output?.objectPath) {
        animatedAssetUrl = await this.assets.createSignedDownloadUrlForAsset(
          output,
          60 * 60,
        );
      }
    }

    const workerStatus =
      typeof job.resultJson?.['workerStatus'] === 'string'
        ? (job.resultJson['workerStatus'] as string)
        : null;

    return {
      jobId: job.jobId,
      status:
        (workerStatus as Mesh2MotionJobStatusResponse['status']) ?? job.status,
      error: job.errorMessage ?? null,
      sourceAssetId: job.sourceAssetId,
      outputAssetId: job.outputAssetId,
      projectId: job.projectId,
      localProjectId: job.localProjectId,
      animatedAssetUrl,
      skeletonType: job.skeletonType as Mesh2MotionSkeletonType,
      animationNames: job.animationNames ?? null,
    };
  }

  async listSkeletons() {
    const cfg = this.cfg();
    if (!cfg.enabled) {
      throw new ServiceUnavailableException(
        'Animator is not configured on this server',
      );
    }
    return this.client.listSkeletons();
  }

  async health(): Promise<{ ok: boolean; animatorUrl: string }> {
    const cfg = this.cfg();
    if (!cfg.enabled) {
      return { ok: false, animatorUrl: '' };
    }
    const ok = await this.client.health();
    return { ok, animatorUrl: cfg.url };
  }
}
