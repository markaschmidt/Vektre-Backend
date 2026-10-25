import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
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
import { runWithJobTrace } from '../../telemetry/bullmq-trace.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { UiContextIndexService } from './ui-context-index.service.js';

@Processor(UI_CONTEXT_INDEX_QUEUE, { concurrency: 4 })
export class UiContextIndexProcessor extends WorkerHost {
  private readonly logger = new Logger(UiContextIndexProcessor.name);

  constructor(
    private readonly indexer: UiContextIndexService,
    @Optional() private readonly telemetry?: TelemetryService,
  ) {
    super();
  }

  async process(job: Job<UiContextIndexJob>): Promise<unknown> {
    return runWithJobTrace(job, this.telemetry, () => this.dispatch(job));
  }

  private async dispatch(job: Job<UiContextIndexJob>): Promise<unknown> {
    const startedAt = Date.now();
    switch (job.name) {
      case JOB_UI_CONTEXT_INDEX_SNAPSHOT: {
        const payload = assertSnapshotJob(job.data);
        const result = await this.indexer.indexSnapshot(payload);
        this.logger.log(
          `Indexed snapshot ${payload.snapshotId} status=${result.status} latencyMs=${
            Date.now() - startedAt
          }`,
        );
        return result;
      }
      case JOB_UI_CONTEXT_INDEX_SOURCE: {
        const payload = assertSourceJob(job.data);
        await this.indexer.indexSource(payload);
        this.logger.log(
          `Indexed ${payload.sourceKind} ${payload.sourceId} latencyMs=${
            Date.now() - startedAt
          }`,
        );
        return { status: 'ready' };
      }
      default:
        throw new Error(`Unknown UI context index job: ${job.name}`);
    }
  }
}

function assertSnapshotJob(value: UiContextIndexJob): UiSnapshotIndexJob {
  if (
    value.kind !== 'snapshot' ||
    !value.projectId ||
    !value.documentId ||
    !value.documentKey ||
    !value.snapshotId ||
    !value.storageRef ||
    !['gui_screen', 'storyboard'].includes(value.documentType)
  ) {
    throw new Error('Invalid UI snapshot index job payload');
  }
  return value;
}

function assertSourceJob(value: UiContextIndexJob): UiSourceIndexJob {
  if (
    value.kind !== 'source' ||
    !value.projectId ||
    !value.sourceId ||
    !value.sourceHash ||
    !['comment', 'memory', 'asset'].includes(value.sourceKind)
  ) {
    throw new Error('Invalid UI source index job payload');
  }
  return value;
}
