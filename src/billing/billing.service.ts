import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BillingConfig,
  BillingInterval,
} from '../config/billing.config.js';
import {
  isPaidPlan,
  resolvePlanFromPriceId,
} from '../config/billing.config.js';
import type { UserPlan } from '../integrations/app-data.types.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { BillingRepository } from './repositories/billing.repository.js';
import { StripeClient } from './stripe.client.js';
import { UsageCreditsService } from './usage-credits.service.js';
import {
  currentPeriodKey,
  type BillingSummaryApi,
  type BillingUsageApi,
} from './models/billing.model.js';
import type Stripe from 'stripe';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly repo: BillingRepository,
    private readonly stripe: StripeClient,
    private readonly credits: UsageCreditsService,
    private readonly appData: AppDataService,
    private readonly config: ConfigService,
  ) {}

  private billing(): BillingConfig {
    return this.config.getOrThrow<BillingConfig>('billing');
  }

  /**
   * Called from UserService after onboarding completes. Free → local grant;
   * paid → Stripe customer + trial subscription (no payment method).
   */
  async startOnboardingEntitlement(
    userId: string,
    plan: UserPlan,
    email?: string,
  ): Promise<void> {
    await this.repo.updateUserPlan(userId, plan);

    if (plan === 'free') {
      await this.credits.grantPeriodCredits({
        userId,
        plan: 'free',
        reason: 'grant_plan',
      });
      return;
    }

    if (!isPaidPlan(plan)) {
      throw new BadRequestException(`Unsupported plan: ${plan}`);
    }

    const billing = this.billing();
    if (!billing.secretKey) {
      this.logger.warn(
        `STRIPE_SECRET_KEY unset — granting trial credits locally for ${userId}`,
      );
      await this.credits.grantPeriodCredits({
        userId,
        plan,
        reason: 'grant_trial',
      });
      return;
    }

    const customerId = await this.ensureStripeCustomer(userId, email);
    const subscription = await this.stripe.createTrialSubscription({
      customerId,
      plan,
      interval: 'month',
    });
    await this.persistSubscriptionFromStripe(userId, subscription);
    await this.credits.grantPeriodCredits({
      userId,
      plan,
      reason: 'grant_trial',
      refType: 'stripe_subscription',
      refId: subscription.id,
    });
  }

  async getSummary(userId: string): Promise<BillingSummaryApi> {
    const profile = await this.appData.getUserProfile(userId);
    const sub = await this.repo.getSubscriptionForUser(userId);
    const usage = await this.credits.getUsageSummary(userId);
    const billing = this.billing();
    const plan: UserPlan =
      (sub && ['trialing', 'active', 'past_due'].includes(sub.status)
        ? sub.plan
        : null) ??
      profile?.plan ??
      'free';

    return {
      plan,
      status: sub?.status ?? (plan === 'free' ? 'none' : 'none'),
      interval: sub?.interval ?? null,
      trial_ends_at: sub?.trialEndsAt?.toISOString() ?? null,
      current_period_end: sub?.currentPeriodEnd?.toISOString() ?? null,
      cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
      credit_balance_cents: usage.balance_cents,
      period_key: usage.period_key,
      period_granted_cents: usage.granted_cents,
      period_consumed_cents: usage.consumed_cents,
      checkout_available: Boolean(
        billing.secretKey && billing.checkoutSuccessUrl,
      ),
      portal_available: Boolean(billing.secretKey && billing.portalReturnUrl),
    };
  }

  async getUsage(userId: string): Promise<BillingUsageApi> {
    return this.credits.getUsageSummary(userId);
  }

  async createCheckoutSession(
    userId: string,
    plan: UserPlan,
    interval: BillingInterval,
    email?: string,
  ): Promise<{ url: string }> {
    if (!isPaidPlan(plan)) {
      throw new BadRequestException('Checkout requires a paid plan');
    }
    try {
      const customerId = await this.ensureStripeCustomer(userId, email);
      const session = await this.stripe.createCheckoutSession({
        customerId,
        plan,
        interval,
      });
      if (!session.url) {
        throw new ServiceUnavailableException(
          'Stripe Checkout returned no URL',
        );
      }
      return { url: session.url };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `checkout failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Unable to create Checkout session',
      );
    }
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const customer = await this.repo.getCustomer(userId);
    if (!customer) {
      throw new BadRequestException(
        'No billing customer — complete onboarding first',
      );
    }
    try {
      const session = await this.stripe.createPortalSession(
        customer.stripeCustomerId,
      );
      return { url: session.url };
    } catch (err) {
      this.logger.error(
        `portal failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException('Unable to create Portal session');
    }
  }

  async handleStripeEvent(event: Stripe.Event): Promise<void> {
    const claimed = await this.repo.claimWebhookEvent(event.id);
    if (!claimed) {
      this.logger.debug(`Skipping already-processed event ${event.id}`);
      return;
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await this.syncSubscriptionEvent(sub);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        await this.onInvoicePaid(invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        this.logger.warn(
          `Payment failed for customer=${invoice.customer} invoice=${invoice.id}`,
        );
        break;
      }
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription && typeof session.subscription === 'string') {
          const sub = await this.stripe.retrieveSubscription(
            session.subscription,
          );
          await this.syncSubscriptionEvent(sub);
        }
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event type ${event.type}`);
    }
  }

  private async ensureStripeCustomer(
    userId: string,
    email?: string,
  ): Promise<string> {
    const existing = await this.repo.getCustomer(userId);
    if (existing) return existing.stripeCustomerId;

    const customer = await this.stripe.createCustomer({ userId, email });
    await this.repo.upsertCustomer(userId, customer.id);
    return customer.id;
  }

  private async persistSubscriptionFromStripe(
    userId: string,
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const priceId = subscription.items.data[0]?.price?.id ?? '';
    const mapped = resolvePlanFromPriceId(priceId, this.billing().prices);
    const plan =
      mapped?.plan ??
      (subscription.metadata?.vektre_plan as
        | Exclude<UserPlan, 'free'>
        | undefined);
    const interval =
      mapped?.interval ??
      (subscription.metadata?.vektre_interval as BillingInterval | undefined) ??
      'month';

    if (!plan || !isPaidPlan(plan)) {
      this.logger.warn(
        `Could not map Stripe price ${priceId} for subscription ${subscription.id}`,
      );
      return;
    }

    const trialEndsAt = subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null;
    const periodEnd = (
      subscription as Stripe.Subscription & {
        current_period_end?: number;
      }
    ).current_period_end;
    const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;

    await this.repo.upsertSubscription({
      stripeSubscriptionId: subscription.id,
      userId,
      plan,
      interval,
      status: subscription.status,
      trialEndsAt,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      stripePriceId: priceId || null,
    });

    if (['active', 'trialing'].includes(subscription.status)) {
      await this.repo.updateUserPlan(userId, plan);
    } else if (
      ['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status)
    ) {
      await this.repo.updateUserPlan(userId, 'free');
    }
  }

  private async syncSubscriptionEvent(
    subscription: Stripe.Subscription,
  ): Promise<void> {
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;
    const customer = await this.repo.getCustomerByStripeId(customerId);
    if (!customer) {
      const userId = subscription.metadata?.vektre_user_id;
      if (!userId) {
        this.logger.warn(
          `No billing_customer for Stripe customer ${customerId}`,
        );
        return;
      }
      await this.repo.upsertCustomer(userId, customerId);
      await this.persistSubscriptionFromStripe(userId, subscription);
      return;
    }
    await this.persistSubscriptionFromStripe(customer.userId, subscription);
  }

  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;
    if (!customerId) return;

    const customer = await this.repo.getCustomerByStripeId(customerId);
    if (!customer) return;

    const sub = await this.repo.getSubscriptionForUser(customer.userId);
    if (!sub || !['active', 'trialing'].includes(sub.status)) return;

    // Skip $0 trial invoices for duplicate grants; still grant on paid renewals.
    if (
      (invoice.amount_paid ?? 0) <= 0 &&
      invoice.billing_reason === 'subscription_create'
    ) {
      return;
    }

    await this.credits.grantPeriodCredits({
      userId: customer.userId,
      plan: sub.plan,
      reason: 'grant_plan',
      periodKey: currentPeriodKey(),
      refType: 'stripe_invoice',
      refId: invoice.id ?? `inv_${Date.now()}`,
    });
  }
}
