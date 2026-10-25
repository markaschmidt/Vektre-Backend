import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../integrations/supabase.js';
import type { UserPlan } from '../../integrations/app-data.types.js';
import type { BillingInterval } from '../../config/billing.config.js';
import type {
  BillingCustomerRow,
  BillingSubscriptionRow,
  CreditLedgerReason,
  CreditPromoCodeRow,
  UsageCreditLedgerRow,
} from '../models/billing.model.js';

@Injectable()
export class BillingRepository {
  private readonly logger = new Logger(BillingRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  private db() {
    return this.supabase.getAdminClient();
  }

  async getCustomer(userId: string): Promise<BillingCustomerRow | null> {
    const { data, error } = await this.db()
      .from('billing_customer')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`getCustomer failed: ${error.message}`);
    return data ? mapCustomer(data) : null;
  }

  async getCustomerByStripeId(
    stripeCustomerId: string,
  ): Promise<BillingCustomerRow | null> {
    const { data, error } = await this.db()
      .from('billing_customer')
      .select('*')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();
    if (error)
      throw new Error(`getCustomerByStripeId failed: ${error.message}`);
    return data ? mapCustomer(data) : null;
  }

  async upsertCustomer(
    userId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db().from('billing_customer').upsert({
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
      updated_at: now,
      created_at: now,
    });
    if (error) throw new Error(`upsertCustomer failed: ${error.message}`);
  }

  async getSubscriptionForUser(
    userId: string,
  ): Promise<BillingSubscriptionRow | null> {
    const { data, error } = await this.db()
      .from('billing_subscription')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error)
      throw new Error(`getSubscriptionForUser failed: ${error.message}`);
    return data ? mapSubscription(data) : null;
  }

  async upsertSubscription(row: {
    stripeSubscriptionId: string;
    userId: string;
    plan: Exclude<UserPlan, 'free'>;
    interval: BillingInterval;
    status: string;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
    stripePriceId?: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db()
      .from('billing_subscription')
      .upsert({
        stripe_subscription_id: row.stripeSubscriptionId,
        user_id: row.userId,
        plan: row.plan,
        interval: row.interval,
        status: row.status,
        trial_ends_at: row.trialEndsAt?.toISOString() ?? null,
        current_period_end: row.currentPeriodEnd?.toISOString() ?? null,
        cancel_at_period_end: row.cancelAtPeriodEnd ?? false,
        stripe_price_id: row.stripePriceId ?? null,
        updated_at: now,
        created_at: now,
      });
    if (error) throw new Error(`upsertSubscription failed: ${error.message}`);
  }

  async getCreditBalance(userId: string): Promise<number> {
    const { data, error } = await this.db()
      .from('usage_credit_ledger')
      .select('balance_after_cents')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`getCreditBalance failed: ${error.message}`);
    return (data?.balance_after_cents as number | undefined) ?? 0;
  }

  async listLedgerForPeriod(
    userId: string,
    periodKey: string,
  ): Promise<UsageCreditLedgerRow[]> {
    const { data, error } = await this.db()
      .from('usage_credit_ledger')
      .select('*')
      .eq('user_id', userId)
      .eq('period_key', periodKey)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`listLedgerForPeriod failed: ${error.message}`);
    return (data ?? []).map(mapLedger);
  }

  async findLedgerByRef(
    userId: string,
    reason: CreditLedgerReason,
    refId: string,
  ): Promise<UsageCreditLedgerRow | null> {
    const { data, error } = await this.db()
      .from('usage_credit_ledger')
      .select('*')
      .eq('user_id', userId)
      .eq('reason', reason)
      .eq('ref_id', refId)
      .maybeSingle();
    if (error) throw new Error(`findLedgerByRef failed: ${error.message}`);
    return data ? mapLedger(data) : null;
  }

  async appendLedgerEntry(input: {
    userId: string;
    deltaCents: number;
    reason: CreditLedgerReason;
    periodKey: string;
    refType?: string | null;
    refId?: string | null;
  }): Promise<UsageCreditLedgerRow> {
    const balance = await this.getCreditBalance(input.userId);
    const balanceAfter = balance + input.deltaCents;
    const id = `ucl_${randomUUID()}`;
    const row = {
      id,
      user_id: input.userId,
      delta_cents: input.deltaCents,
      balance_after_cents: balanceAfter,
      reason: input.reason,
      ref_type: input.refType ?? null,
      ref_id: input.refId ?? null,
      period_key: input.periodKey,
      created_at: new Date().toISOString(),
    };
    const { data, error } = await this.db()
      .from('usage_credit_ledger')
      .insert(row)
      .select('*')
      .single();
    if (error) {
      // Unique consume_generation race → return existing
      if (error.code === '23505' && input.refId) {
        const existing = await this.findLedgerByRef(
          input.userId,
          input.reason,
          input.refId,
        );
        if (existing) return existing;
      }
      throw new Error(`appendLedgerEntry failed: ${error.message}`);
    }
    this.logger.debug(
      `ledger ${input.reason} user=${input.userId} delta=${input.deltaCents}`,
    );
    return mapLedger(data);
  }

  async getPromoCode(code: string): Promise<CreditPromoCodeRow | null> {
    const { data, error } = await this.db()
      .from('credit_promo_code')
      .select('*')
      .eq('code', code.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(`getPromoCode failed: ${error.message}`);
    return data ? mapPromo(data) : null;
  }

  async hasPromoRedemption(code: string, userId: string): Promise<boolean> {
    const { data, error } = await this.db()
      .from('credit_promo_redemption')
      .select('code')
      .eq('code', code.toUpperCase())
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`hasPromoRedemption failed: ${error.message}`);
    return !!data;
  }

  async redeemPromo(input: {
    code: string;
    userId: string;
    creditCents: number;
  }): Promise<void> {
    const code = input.code.toUpperCase();
    const { error: redError } = await this.db()
      .from('credit_promo_redemption')
      .insert({
        code,
        user_id: input.userId,
        credit_cents: input.creditCents,
        created_at: new Date().toISOString(),
      });
    if (redError)
      throw new Error(`redeemPromo insert failed: ${redError.message}`);

    const promo = await this.getPromoCode(code);
    if (!promo) throw new Error('promo vanished during redeem');
    const { error: updError } = await this.db()
      .from('credit_promo_code')
      .update({ redeemed_count: promo.redeemedCount + 1 })
      .eq('code', code);
    if (updError)
      throw new Error(`redeemPromo count failed: ${updError.message}`);
  }

  async claimWebhookEvent(eventId: string): Promise<boolean> {
    const { error } = await this.db().from('stripe_webhook_event').insert({
      event_id: eventId,
      processed_at: new Date().toISOString(),
    });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw new Error(`claimWebhookEvent failed: ${error.message}`);
  }

  async updateUserPlan(userId: string, plan: UserPlan): Promise<void> {
    const { data, error } = await this.db()
      .from('user_profile')
      .select('preferences_json')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`updateUserPlan read failed: ${error.message}`);

    const prefs =
      (data?.preferences_json as Record<string, unknown> | null) ?? {};
    const { error: updError } = await this.db()
      .from('user_profile')
      .update({
        plan,
        preferences_json: { ...prefs, selectedPlan: plan },
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (updError) throw new Error(`updateUserPlan failed: ${updError.message}`);
  }
}

function mapCustomer(row: Record<string, unknown>): BillingCustomerRow {
  return {
    userId: row.user_id as string,
    stripeCustomerId: row.stripe_customer_id as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapSubscription(row: Record<string, unknown>): BillingSubscriptionRow {
  return {
    stripeSubscriptionId: row.stripe_subscription_id as string,
    userId: row.user_id as string,
    plan: row.plan as Exclude<UserPlan, 'free'>,
    interval: row.interval as BillingInterval,
    status: row.status as string,
    trialEndsAt: row.trial_ends_at
      ? new Date(row.trial_ends_at as string)
      : null,
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end as string)
      : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    stripePriceId: (row.stripe_price_id as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapLedger(row: Record<string, unknown>): UsageCreditLedgerRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    deltaCents: row.delta_cents as number,
    balanceAfterCents: row.balance_after_cents as number,
    reason: row.reason as CreditLedgerReason,
    refType: (row.ref_type as string | null) ?? null,
    refId: (row.ref_id as string | null) ?? null,
    periodKey: row.period_key as string,
    createdAt: new Date(row.created_at as string),
  };
}

function mapPromo(row: Record<string, unknown>): CreditPromoCodeRow {
  return {
    code: row.code as string,
    creditCents: row.credit_cents as number,
    maxRedemptions: (row.max_redemptions as number | null) ?? null,
    redeemedCount: row.redeemed_count as number,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    active: Boolean(row.active),
    metadata: (row.metadata_json as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
  };
}
