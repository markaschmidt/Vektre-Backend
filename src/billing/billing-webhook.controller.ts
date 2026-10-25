import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import {
  BILLING_OPS_QUEUE,
  JOB_STRIPE_WEBHOOK,
} from '../queues/queue-names.js';
import { defaultJobOptions } from '../queues/job-options.js';
import { StripeClient } from './stripe.client.js';
import type { StripeWebhookJob } from './models/billing.model.js';

@Controller('billing/webhooks')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(
    private readonly stripe: StripeClient,
    @InjectQueue(BILLING_OPS_QUEUE)
    private readonly billingQueue: Queue,
  ) {}

  @Public()
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async handleStripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Raw body required for Stripe webhook');
    }

    let event;
    try {
      event = this.stripe.constructEvent(rawBody, signature);
    } catch (err) {
      this.logger.warn(
        `Stripe signature verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new BadRequestException('Invalid Stripe signature');
    }

    const payload: StripeWebhookJob = {
      eventId: event.id,
      type: event.type,
      payloadJson: JSON.stringify(event),
    };

    await this.billingQueue.add(JOB_STRIPE_WEBHOOK, payload, {
      ...defaultJobOptions,
      jobId: event.id,
    });

    return { received: true };
  }
}
