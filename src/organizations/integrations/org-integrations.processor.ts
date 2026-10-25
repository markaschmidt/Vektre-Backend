import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AppDataService } from '../../integrations/app-data.service.js';
import {
  JOB_ORG_INTEGRATION_VALIDATE,
  ORG_INTEGRATION_OPS_QUEUE,
} from '../../queues/queue-names.js';
import {
  OrgIntegrationsService,
  type ValidateOrgIntegrationJob,
} from './org-integrations.service.js';

@Processor(ORG_INTEGRATION_OPS_QUEUE, { concurrency: 5 })
export class OrgIntegrationsProcessor extends WorkerHost {
  private readonly logger = new Logger(OrgIntegrationsProcessor.name);

  constructor(
    private readonly integrations: OrgIntegrationsService,
    private readonly appData: AppDataService,
  ) {
    super();
  }

  async process(job: Job<ValidateOrgIntegrationJob>): Promise<void> {
    if (job.name !== JOB_ORG_INTEGRATION_VALIDATE) {
      throw new Error(`Unknown organization integration job: ${job.name}`);
    }

    try {
      await this.appData.updateRequestStatus(job.data.requestId, 'processing');
      await this.integrations.processValidation(job.data);
      await this.appData.updateRequestStatus(job.data.requestId, 'completed', {
        outputRef: `organization:${job.data.organizationId}:integration:${job.data.provider}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.appData.updateRequestStatus(job.data.requestId, 'failed', {
        errorMessage: message,
      });
      this.logger.warn(
        `Organization integration validation failed: ${message}`,
      );
      throw error;
    }
  }
}
