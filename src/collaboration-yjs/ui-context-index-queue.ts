import { Queue } from 'bullmq';
import { bullJobId } from '../queues/bull-job-id.js';
import {
  JOB_UI_CONTEXT_INDEX_SNAPSHOT,
  UI_CONTEXT_INDEX_QUEUE,
} from '../queues/queue-names.js';
import { redisConfig } from '../queues/redis.config.js';
import type { UiSnapshotIndexJob } from '../queues/ui-context-index.jobs.js';
import { tracedJobData } from '../telemetry/bullmq-trace.js';

let queue: Queue<UiSnapshotIndexJob> | null = null;

function getQueue(): Queue<UiSnapshotIndexJob> | null {
  if (!process.env.REDIS_HOST) return null;
  queue ??= new Queue<UiSnapshotIndexJob>(UI_CONTEXT_INDEX_QUEUE, {
    connection: redisConfig(),
  });
  return queue;
}

export async function enqueueUiSnapshotIndexJob(
  payload: UiSnapshotIndexJob,
): Promise<boolean> {
  const indexQueue = getQueue();
  if (!indexQueue) return false;
  await indexQueue.add(
    JOB_UI_CONTEXT_INDEX_SNAPSHOT,
    tracedJobData(payload),
    {
    jobId: bullJobId(
      'ui-context',
      payload.documentType,
      payload.projectId,
      payload.documentId,
      payload.snapshotId,
    ),
    attempts: 4,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 604_800, count: 10_000 },
  });
  return true;
}
