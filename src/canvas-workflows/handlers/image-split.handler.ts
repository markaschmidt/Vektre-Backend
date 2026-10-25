import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type {
  CanvasActionHandler,
  CanvasActionRunContext,
} from '../canvas-action.interface.js';
import {
  CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
  type ImageSplitConfig,
} from '../../collaboration-documents/models/canvas-graph.model.js';
import {
  GENERATIVE_MODEL_QUEUE,
  JOB_CANVAS_IMAGE_SPLIT,
} from '../../queues/queue-names.js';
import { heavyJobOptions } from '../../queues/job-options.js';
import { tracedJobData } from '../../telemetry/bullmq-trace.js';
import { bullJobId } from '../../queues/bull-job-id.js';
import { AppDataService } from '../../integrations/app-data.service.js';
import type { CanvasImageSplitJob } from '../../generative-model/models/gen-job.model.js';

@Injectable()
export class ImageSplitActionHandler implements CanvasActionHandler {
  readonly kind = 'image_split' as const;

  constructor(
    @InjectQueue(GENERATIVE_MODEL_QUEUE)
    private readonly genQueue: Queue,
    private readonly appData: AppDataService,
  ) {}

  async validate(ctx: CanvasActionRunContext): Promise<void> {
    const sourceAssetId = ctx.inputs.assets[0]?.assetId;
    if (!sourceAssetId) {
      throw new BadRequestException(
        'image_split requires an image asset input',
      );
    }
    const asset = await this.appData.getProjectAsset(sourceAssetId);
    if (!asset || asset.projectId !== ctx.projectId) {
      throw new BadRequestException(
        `Source asset ${sourceAssetId} not found in this project`,
      );
    }
    if (!asset.objectPath) {
      throw new BadRequestException(
        `Source asset ${sourceAssetId} has no bytes available`,
      );
    }
    if (asset.mimeType && asset.mimeType !== 'image/png') {
      throw new BadRequestException(
        `image_split currently requires image/png (got ${asset.mimeType})`,
      );
    }

    const config = normalizeSplitConfig(ctx.config);
    const estimated = estimateOutputCount(config);
    const maxOutputs = Math.min(
      config.maxOutputs ?? CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
      CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
    );
    if (estimated <= 0) {
      throw new BadRequestException(
        'image_split config produced zero output regions',
      );
    }
    if (estimated > maxOutputs) {
      throw new BadRequestException(
        `image_split would create ${estimated} outputs; max is ${maxOutputs}`,
      );
    }
  }

  async enqueue(ctx: CanvasActionRunContext): Promise<void> {
    const sourceAssetId = ctx.inputs.assets[0].assetId;
    const config = normalizeSplitConfig(ctx.config);
    const jobId = bullJobId('canvas-split', ctx.userId, ctx.requestId);

    await this.appData.createRequestStatus({
      requestId: ctx.requestId,
      userId: ctx.userId,
      type: 'canvas-image-split',
      status: 'queued',
    });

    const payload: CanvasImageSplitJob = {
      requestId: ctx.requestId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      nodeId: ctx.nodeId,
      runId: ctx.runId,
      activityId: ctx.activityId,
      sourceAssetId,
      config,
    };

    await this.genQueue.add(JOB_CANVAS_IMAGE_SPLIT, tracedJobData(payload), {
      ...heavyJobOptions,
      jobId,
    });
  }
}

export function normalizeSplitConfig(
  raw: Record<string, unknown>,
): ImageSplitConfig {
  const mode = raw.mode === 'grid' ? 'grid' : 'regions';
  const maxOutputs =
    typeof raw.maxOutputs === 'number' ? raw.maxOutputs : undefined;

  if (mode === 'grid') {
    const gridRaw = (raw.grid as Record<string, unknown> | undefined) ?? {};
    const rows = Number(gridRaw.rows ?? 1);
    const columns = Number(gridRaw.columns ?? 1);
    if (
      !Number.isInteger(rows) ||
      rows < 1 ||
      !Number.isInteger(columns) ||
      columns < 1
    ) {
      throw new BadRequestException(
        'image_split grid requires positive integer rows/columns',
      );
    }
    return { mode, grid: { rows, columns }, maxOutputs };
  }

  const regionsRaw = Array.isArray(raw.regions) ? raw.regions : [];
  const regions = regionsRaw.map((r, index) => {
    const region = r as Record<string, unknown>;
    const x = Number(region.x);
    const y = Number(region.y);
    const width = Number(region.width);
    const height = Number(region.height);
    if (
      ![x, y, width, height].every((n) => Number.isFinite(n)) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new BadRequestException(
        `image_split region[${index}] must have finite x/y and positive width/height`,
      );
    }
    return { x, y, width, height };
  });
  return { mode: 'regions', regions, maxOutputs };
}

export function estimateOutputCount(config: ImageSplitConfig): number {
  if (config.mode === 'grid' && config.grid) {
    return config.grid.rows * config.grid.columns;
  }
  return config.regions?.length ?? 0;
}
