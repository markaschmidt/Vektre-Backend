import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BILLING_OPS_QUEUE } from '../queues/queue-names.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { BillingController } from './billing.controller.js';
import { BillingWebhookController } from './billing-webhook.controller.js';
import { BillingService } from './billing.service.js';
import { BillingProcessor } from './billing.processor.js';
import { StripeClient } from './stripe.client.js';
import { UsageCreditsService } from './usage-credits.service.js';
import { PromoCodesService } from './promo-codes.service.js';
import { BillingRepository } from './repositories/billing.repository.js';

@Module({
  imports: [
    IntegrationsModule,
    BullModule.registerQueue({ name: BILLING_OPS_QUEUE }),
  ],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingRepository,
    StripeClient,
    UsageCreditsService,
    PromoCodesService,
    BillingService,
    BillingProcessor,
  ],
  exports: [BillingService, UsageCreditsService],
})
export class BillingModule {}
