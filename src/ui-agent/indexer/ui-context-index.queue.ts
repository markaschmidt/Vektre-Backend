import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { canonicalSha256 } from '@markaschmidt/ui-builder-contracts';
import type { Queue } from 'bullmq';
import { AppDataService } from '../../integrations/app-data.service.js';
import { bullJobId } from '../../queues/bull-job-id.js';
import {
  JOB_UI_CONTEXT_INDEX_SNAPSHOT,
  JOB_UI_CONTEXT_INDEX_SOURCE,
  UI_CONTEXT_INDEX_QUEUE,
} from '../../queues/queue-names.js';
import type {
  UiContextIndexJob,
  UiSnapshotIndexJob,
  UiSourceIndexJob,
} from '../../queues/ui-context-index.jobs.js';
import { tracedJobData } from '../../telemetry/bullmq-trace.js';

@Injectable()
export class UiContextIndexQueue {
  private readonly logger = new Logger(UiContextIndexQueue.name);

  constructor(
    @InjectQueue(UI_CONTEXT_INDEX_QUEUE)
    private readonly queue: Queue<UiContextIndexJob>,
    private readonly appData: AppDataService,
  ) {}

  async enqueueSnapshot(payload: UiSnapshotIndexJob): Promise<boolean> {
    return this.enqueue(
      JOB_UI_CONTEXT_INDEX_SNAPSHOT,
      payload,
      bullJobId(
        'ui-context',
        payload.documentType,
        payload.projectId,
        payload.documentId,
        payload.snapshotId,
      ),
    );
  }

  async enqueueSource(payload: UiSourceIndexJob): Promise<boolean> {
    return this.enqueue(
      JOB_UI_CONTEXT_INDEX_SOURCE,
      payload,
      bullJobId(
        'ui-context',
        payload.sourceKind,
        payload.projectId,
        payload.sourceId,
        payload.sourceHash,
      ),
    );
  }

  async enqueueAsset(projectId: string, assetId: string): Promise<boolean> {
    try {
      const asset = await this.appData.getProjectAsset(assetId);
      return this.enqueueSource({
        kind: 'source',
        projectId,
        sourceKind: 'asset',
        sourceId: assetId,
        sourceHash: canonicalSha256(
          !asset || asset.projectId !== projectId
            ? { assetId, status: 'deleted' }
            : {
                assetId,
                name: asset.name,
                assetType: asset.assetType,
                mimeType: asset.mimeType ?? null,
                checksum: asset.checksum ?? null,
                status: asset.status,
                metadata: asset.metadata ?? {},
                updatedAt: asset.updatedAt.toISOString(),
              },
        ),
      });
    } catch (error) {
      this.logger.error(
        `Failed to load asset ${assetId} for context indexing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async enqueue(
    jobName:
      | typeof JOB_UI_CONTEXT_INDEX_SNAPSHOT
      | typeof JOB_UI_CONTEXT_INDEX_SOURCE,
    payload: UiContextIndexJob,
    jobId: string,
  ): Promise<boolean> {
    try {
      await this.queue.add(jobName, tracedJobData(payload), {
        jobId,
        attempts: 4,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        removeOnFail: { age: 604_800, count: 10_000 },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ${jobName} (${jobId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
