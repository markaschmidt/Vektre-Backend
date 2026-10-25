import type { UserPlan } from '../../integrations/app-data.types.js';
import type { BillingInterval } from '../../config/billing.config.js';

export type CreditLedgerReason =
  | 'grant_plan'
  | 'grant_promo'
  | 'grant_trial'
  | 'consume_generation'
  | 'adjust';

export interface BillingCustomerRow {
  userId: string;
  stripeCustomerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingSubscriptionRow {
  stripeSubscriptionId: string;
  userId: string;
  plan: Exclude<UserPlan, 'free'>;
  interval: BillingInterval;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripePriceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageCreditLedgerRow {
  id: string;
  userId: string;
  deltaCents: number;
  balanceAfterCents: number;
  reason: CreditLedgerReason;
  refType: string | null;
  refId: string | null;
  periodKey: string;
  createdAt: Date;
}

export interface CreditPromoCodeRow {
  code: string;
  creditCents: number;
  maxRedemptions: number | null;
  redeemedCount: number;
  expiresAt: Date | null;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface BillingSummaryApi {
  plan: UserPlan;
  status: string;
  interval: BillingInterval | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  credit_balance_cents: number;
  period_key: string;
  period_granted_cents: number;
  period_consumed_cents: number;
  checkout_available: boolean;
  portal_available: boolean;
}

export interface BillingUsageApi {
  period_key: string;
  balance_cents: number;
  granted_cents: number;
  consumed_cents: number;
  entries: Array<{
    id: string;
    delta_cents: number;
    balance_after_cents: number;
    reason: CreditLedgerReason;
    ref_type: string | null;
    ref_id: string | null;
    created_at: string;
  }>;
}

export interface StripeWebhookJob {
  eventId: string;
  type: string;
  payloadJson: string;
}

export function currentPeriodKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
