import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  JOB_UI_AGENT_TRANSITION,
  JOB_UI_AGENT_ASSET_RESUME,
  UI_AGENT_QUEUE,
} from '../queues/queue-names.js';
import { runWithJobTrace } from '../telemetry/bullmq-trace.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import type { UiAgentJob } from './models/ui-agent-job.model.js';
import { UiAgentJobSchema } from './schemas/ui-agent-job.schema.js';
import { UiAgentWorkflowService } from './ui-agent-workflow.service.js';

@Processor(UI_AGENT_QUEUE, { concurrency: 4 })
export class UiAgentProcessor extends WorkerHost {
  constructor(
    private readonly workflow: UiAgentWorkflowService,
    @Optional() private readonly telemetry?: TelemetryService,
  ) {
    super();
  }

  async process(job: Job<UiAgentJob>): Promise<void> {
    await runWithJobTrace(job, this.telemetry, async () => {
      const data = UiAgentJobSchema.parse(job.data);
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      if (job.name === JOB_UI_AGENT_TRANSITION && data.kind === 'transition') {
        await this.workflow.processTransition(data, finalAttempt);
        return;
      }
      if (
        job.name === JOB_UI_AGENT_ASSET_RESUME &&
        data.kind === 'asset_resume'
      ) {
        await this.workflow.processAssetResume(data, finalAttempt);
        return;
      }
      throw new Error(`Unknown UI-agent job: ${job.name}`);
    });
  }
}
