import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type Stripe from 'stripe';
import {
  BILLING_OPS_QUEUE,
  JOB_STRIPE_WEBHOOK,
} from '../queues/queue-names.js';
import { BillingService } from './billing.service.js';
import type { StripeWebhookJob } from './models/billing.model.js';

@Processor(BILLING_OPS_QUEUE, { concurrency: 2 })
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(private readonly billing: BillingService) {
    super();
  }

  async process(job: Job<StripeWebhookJob>): Promise<void> {
    switch (job.name) {
      case JOB_STRIPE_WEBHOOK: {
        const event = JSON.parse(job.data.payloadJson) as Stripe.Event;
        this.logger.log(
          `Processing Stripe event ${event.id} type=${event.type}`,
        );
        await this.billing.handleStripeEvent(event);
        return;
      }
      default:
        throw new Error(`Unknown billing job: ${job.name}`);
    }
  }
}
