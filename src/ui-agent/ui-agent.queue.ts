import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { bullJobId } from '../queues/bull-job-id.js';
import {
  JOB_UI_AGENT_TRANSITION,
  JOB_UI_AGENT_ASSET_RESUME,
  UI_AGENT_QUEUE,
} from '../queues/queue-names.js';
import { tracedJobData } from '../telemetry/bullmq-trace.js';
import type {
  UiAgentAssetResumeJob,
  UiAgentJob,
  UiAgentTransitionJob,
} from './models/ui-agent-job.model.js';

@Injectable()
export class UiAgentQueue {
  constructor(
    @InjectQueue(UI_AGENT_QUEUE)
    private readonly queue: Queue<UiAgentJob>,
  ) {}

  async enqueueTransition(payload: UiAgentTransitionJob): Promise<void> {
    await this.queue.add(JOB_UI_AGENT_TRANSITION, tracedJobData(payload), {
      jobId: bullJobId('ui-agent', payload.runId, payload.stageExecutionId),
      attempts: 4,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: { age: 86_400, count: 5_000 },
      removeOnFail: { age: 604_800, count: 10_000 },
    });
  }

  async enqueueAssetResume(payload: UiAgentAssetResumeJob): Promise<void> {
    await this.queue.add(JOB_UI_AGENT_ASSET_RESUME, tracedJobData(payload), {
      jobId: bullJobId(
        'ui-agent-assets',
        payload.runId,
        payload.sourceStageExecutionId,
      ),
      attempts: 120,
      backoff: { type: 'fixed', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 5_000 },
      removeOnFail: { age: 604_800, count: 10_000 },
    });
  }
}
