import { registerAs } from '@nestjs/config';
import type { UserPlan } from '../integrations/app-data.types.js';

export type BillingInterval = 'month' | 'year';

export interface BillingPriceMap {
  professional: { month: string; year: string };
  studio: { month: string; year: string };
  enterprise: { month: string; year: string };
}

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  trialDays: number;
  portalReturnUrl: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  prices: BillingPriceMap;
  /** Included usage credits per billing period, in USD cents. */
  periodCreditsCents: Record<UserPlan, number>;
}

const PAID_PLANS = ['professional', 'studio', 'enterprise'] as const;

/**
 * Stripe / billing configuration. Registered under the `billing` namespace.
 * Secret and price IDs are optional at process start so unit tests can boot
 * without Stripe; StripeClient / webhook handlers fail clearly when unset.
 */
export const billingConfig = registerAs('billing', (): BillingConfig => {
  const trialDays = Number.parseInt(process.env.BILLING_TRIAL_DAYS ?? '30', 10);

  return {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim() ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '',
    trialDays: Number.isFinite(trialDays) && trialDays > 0 ? trialDays : 30,
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL?.trim() ?? '',
    checkoutSuccessUrl: process.env.STRIPE_CHECKOUT_SUCCESS_URL?.trim() ?? '',
    checkoutCancelUrl: process.env.STRIPE_CHECKOUT_CANCEL_URL?.trim() ?? '',
    prices: {
      professional: {
        month: process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY?.trim() ?? '',
        year: process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY?.trim() ?? '',
      },
      studio: {
        month: process.env.STRIPE_PRICE_STUDIO_MONTHLY?.trim() ?? '',
        year: process.env.STRIPE_PRICE_STUDIO_YEARLY?.trim() ?? '',
      },
      enterprise: {
        month: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY?.trim() ?? '',
        year: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY?.trim() ?? '',
      },
    },
    periodCreditsCents: {
      free: 1_000,
      professional: 3_000,
      studio: 6_000,
      enterprise: 100_000,
    },
  };
});

export function isPaidPlan(plan: string): plan is (typeof PAID_PLANS)[number] {
  return (PAID_PLANS as readonly string[]).includes(plan);
}

export function resolvePlanFromPriceId(
  priceId: string,
  prices: BillingPriceMap,
): { plan: Exclude<UserPlan, 'free'>; interval: BillingInterval } | null {
  for (const plan of PAID_PLANS) {
    if (prices[plan].month && prices[plan].month === priceId) {
      return { plan, interval: 'month' };
    }
    if (prices[plan].year && prices[plan].year === priceId) {
      return { plan, interval: 'year' };
    }
  }
  return null;
}

export function priceIdForPlan(
  plan: Exclude<UserPlan, 'free'>,
  interval: BillingInterval,
  prices: BillingPriceMap,
): string {
  const id = prices[plan][interval];
  if (!id) {
    throw new Error(
      `Missing Stripe price id for plan=${plan} interval=${interval}`,
    );
  }
  return id;
}
