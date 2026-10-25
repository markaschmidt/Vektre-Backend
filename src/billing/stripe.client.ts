import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type {
  BillingConfig,
  BillingInterval,
} from '../config/billing.config.js';
import { priceIdForPlan } from '../config/billing.config.js';
import type { UserPlan } from '../integrations/app-data.types.js';

@Injectable()
export class StripeClient {
  private readonly logger = new Logger(StripeClient.name);
  private readonly stripe: Stripe | null;

  constructor(private readonly config: ConfigService) {
    const billing = this.billing();
    this.stripe = billing.secretKey ? new Stripe(billing.secretKey) : null;
  }

  private billing(): BillingConfig {
    return this.config.getOrThrow<BillingConfig>('billing');
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    return this.stripe;
  }

  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.billing().webhookSecret;
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return this.requireStripe().webhooks.constructEvent(
      rawBody,
      signature,
      secret,
    );
  }

  async createCustomer(opts: {
    userId: string;
    email?: string;
  }): Promise<Stripe.Customer> {
    return this.requireStripe().customers.create({
      email: opts.email,
      metadata: { vektre_user_id: opts.userId },
    });
  }

  async createTrialSubscription(opts: {
    customerId: string;
    plan: Exclude<UserPlan, 'free'>;
    interval: BillingInterval;
  }): Promise<Stripe.Subscription> {
    const billing = this.billing();
    const price = priceIdForPlan(opts.plan, opts.interval, billing.prices);
    return this.requireStripe().subscriptions.create({
      customer: opts.customerId,
      items: [{ price }],
      trial_period_days: billing.trialDays,
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      trial_settings: {
        end_behavior: { missing_payment_method: 'cancel' },
      },
      metadata: {
        vektre_plan: opts.plan,
        vektre_interval: opts.interval,
      },
    });
  }

  async createCheckoutSession(opts: {
    customerId: string;
    plan: Exclude<UserPlan, 'free'>;
    interval: BillingInterval;
  }): Promise<Stripe.Checkout.Session> {
    const billing = this.billing();
    if (!billing.checkoutSuccessUrl || !billing.checkoutCancelUrl) {
      throw new Error(
        'STRIPE_CHECKOUT_SUCCESS_URL and STRIPE_CHECKOUT_CANCEL_URL are required',
      );
    }
    const price = priceIdForPlan(opts.plan, opts.interval, billing.prices);
    return this.requireStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: opts.customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: billing.checkoutSuccessUrl,
      cancel_url: billing.checkoutCancelUrl,
      metadata: {
        vektre_plan: opts.plan,
        vektre_interval: opts.interval,
      },
      subscription_data: {
        metadata: {
          vektre_plan: opts.plan,
          vektre_interval: opts.interval,
        },
      },
    });
  }

  async createPortalSession(
    customerId: string,
  ): Promise<Stripe.BillingPortal.Session> {
    const billing = this.billing();
    if (!billing.portalReturnUrl) {
      throw new Error('STRIPE_PORTAL_RETURN_URL is required');
    }
    return this.requireStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: billing.portalReturnUrl,
    });
  }

  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    return this.requireStripe().subscriptions.retrieve(subscriptionId);
  }
}
