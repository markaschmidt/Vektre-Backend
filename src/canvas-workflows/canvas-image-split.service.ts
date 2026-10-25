import { Injectable, Logger } from '@nestjs/common';
import { AppDataService } from '../integrations/app-data.service.js';
import { SupabaseService } from '../integrations/supabase.js';
import { CanvasAssetOutputService } from './canvas-asset-output.service.js';
import type { CanvasImageSplitJob } from '../generative-model/models/gen-job.model.js';
import {
  CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
  type CanvasCropRegion,
} from '../collaboration-documents/models/canvas-graph.model.js';
import { cropPng, readPngMeta } from './png-crop.js';

/**
 * Deterministic image-split action. Uses a built-in 8-bit PNG cropper
 * (no native deps). Install optional `sharp` later for JPEG/WebP if needed —
 * extend `readDimensions`/`crop` when that dependency is available in deploy.
 */
@Injectable()
export class CanvasImageSplitService {
  private readonly logger = new Logger(CanvasImageSplitService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
    private readonly outputs: CanvasAssetOutputService,
  ) {}

  async run(data: CanvasImageSplitJob): Promise<void> {
    this.logger.log(
      JSON.stringify({
        event: 'canvas_image_split_start',
        requestId: data.requestId,
        runId: data.runId,
        sourceAssetId: data.sourceAssetId,
      }),
    );

    await this.appData.updateRequestStatus(data.requestId, 'processing');
    await this.appData.updateCollaborationActivity(data.activityId, {
      status: 'running',
    });

    try {
      const source = await this.appData.getProjectAsset(data.sourceAssetId);
      if (!source?.objectPath || source.projectId !== data.projectId) {
        throw new Error(`Source asset ${data.sourceAssetId} unavailable`);
      }
      const bucket = source.bucket ?? this.supabase.getStorageBucket();
      const bytes = await this.supabase.downloadObject(
        source.objectPath,
        bucket,
      );

      const meta = readPngMeta(bytes);
      const { width, height } = meta;
      if (width <= 0 || height <= 0) {
        throw new Error('Source image has invalid dimensions');
      }

      const regions = resolveRegions(data.config, width, height);
      const maxOutputs = Math.min(
        data.config.maxOutputs ?? CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
        CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
      );
      if (regions.length > maxOutputs) {
        throw new Error(
          `Split produced ${regions.length} regions; max is ${maxOutputs}`,
        );
      }

      const outputs: Array<Record<string, unknown>> = [];
      for (let i = 0; i < regions.length; i++) {
        const region = regions[i];
        const extract = clampRegion(region, width, height);
        const sliceBytes = cropPng(bytes, extract);
        const assetId = this.outputs.childSliceAssetId(
          data.sourceAssetId,
          data.runId,
          i,
        );
        const materialized = await this.outputs.materializeBytes({
          projectId: data.projectId,
          userId: data.userId,
          assetId,
          assetType: 'image',
          name: `${assetId}.png`,
          mimeType: 'image/png',
          bytes: sliceBytes,
          requestId: data.requestId,
          sourceProvider: 'local',
          metadata: {
            parentAssetId: data.sourceAssetId,
            assetRole: 'image_slice',
            sliceIndex: i,
            region: extract,
            workflowId: data.workflowId,
            nodeId: data.nodeId,
            runId: data.runId,
            canvasOutput: true,
          },
        });
        outputs.push({
          portId: 'slices',
          assetId: materialized.assetId,
          mimeType: 'image/png',
          sliceIndex: i,
          region: extract,
        });
      }

      const result = {
        sourceAssetId: data.sourceAssetId,
        outputs,
        assetIds: outputs.map((o) => o.assetId),
      };

      await this.appData.updateRequestStatus(data.requestId, 'completed', {
        outputRef: `canvas-split:${data.runId}`,
        resultJson: result,
      });
      await this.appData.updateCollaborationActivity(data.activityId, {
        status: 'completed',
        result,
      });

      this.logger.log(
        JSON.stringify({
          event: 'canvas_image_split_succeeded',
          requestId: data.requestId,
          runId: data.runId,
          outputCount: outputs.length,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appData.updateRequestStatus(data.requestId, 'failed', {
        errorMessage: message,
      });
      await this.appData.updateCollaborationActivity(data.activityId, {
        status: 'failed',
        errorMessage: message,
      });
      this.logger.error(
        JSON.stringify({
          event: 'canvas_image_split_failed',
          requestId: data.requestId,
          error: message,
        }),
      );
      throw err;
    }
  }
}

function resolveRegions(
  config: CanvasImageSplitJob['config'],
  width: number,
  height: number,
): CanvasCropRegion[] {
  if (config.mode === 'grid' && config.grid) {
    const { rows, columns } = config.grid;
    const cellW = width / columns;
    const cellH = height / rows;
    const regions: CanvasCropRegion[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        regions.push({
          x: Math.floor(c * cellW),
          y: Math.floor(r * cellH),
          width: Math.floor(cellW),
          height: Math.floor(cellH),
        });
      }
    }
    return regions;
  }
  return config.regions ?? [];
}

function clampRegion(
  region: CanvasCropRegion,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(Math.floor(region.x), width - 1));
  const top = Math.max(0, Math.min(Math.floor(region.y), height - 1));
  const w = Math.max(1, Math.min(Math.floor(region.width), width - left));
  const h = Math.max(1, Math.min(Math.floor(region.height), height - top));
  return { left, top, width: w, height: h };
}
