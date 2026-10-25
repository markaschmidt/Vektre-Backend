import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingConfig } from '../config/billing.config.js';
import type { UserPlan } from '../integrations/app-data.types.js';
import { BillingRepository } from './repositories/billing.repository.js';
import {
  currentPeriodKey,
  type BillingUsageApi,
  type CreditLedgerReason,
} from './models/billing.model.js';

@Injectable()
export class UsageCreditsService {
  private readonly logger = new Logger(UsageCreditsService.name);

  constructor(
    private readonly repo: BillingRepository,
    private readonly config: ConfigService,
  ) {}

  private billing(): BillingConfig {
    return this.config.getOrThrow<BillingConfig>('billing');
  }

  async getBalanceCents(userId: string): Promise<number> {
    return this.repo.getCreditBalance(userId);
  }

  async grantPeriodCredits(opts: {
    userId: string;
    plan: UserPlan;
    reason: Extract<CreditLedgerReason, 'grant_plan' | 'grant_trial'>;
    periodKey?: string;
    refType?: string;
    refId?: string;
  }): Promise<number> {
    const periodKey = opts.periodKey ?? currentPeriodKey();
    const cents = this.billing().periodCreditsCents[opts.plan];
    if (!cents || cents <= 0) return this.repo.getCreditBalance(opts.userId);

    const refId = opts.refId ?? `${opts.plan}:${periodKey}:${opts.reason}`;
    const existing = await this.repo.findLedgerByRef(
      opts.userId,
      opts.reason,
      refId,
    );
    if (existing) return existing.balanceAfterCents;

    const entry = await this.repo.appendLedgerEntry({
      userId: opts.userId,
      deltaCents: cents,
      reason: opts.reason,
      periodKey,
      refType: opts.refType ?? 'plan',
      refId,
    });
    this.logger.log(
      `Granted ${cents} cents (${opts.reason}) to ${opts.userId} period=${periodKey}`,
    );
    return entry.balanceAfterCents;
  }

  async grantPromoCredits(opts: {
    userId: string;
    creditCents: number;
    code: string;
  }): Promise<number> {
    const entry = await this.repo.appendLedgerEntry({
      userId: opts.userId,
      deltaCents: opts.creditCents,
      reason: 'grant_promo',
      periodKey: currentPeriodKey(),
      refType: 'promo',
      refId: opts.code.toUpperCase(),
    });
    return entry.balanceAfterCents;
  }

  /**
   * Hard gate before generative enqueue. Enterprise is still gated on balance
   * unless an explicit override env is set later — plan: reject when <= 0.
   */
  async assertHasCredits(userId: string): Promise<void> {
    const balance = await this.repo.getCreditBalance(userId);
    if (balance <= 0) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Insufficient usage credits',
        code: 'insufficient_credits',
        credit_balance_cents: balance,
      });
    }
  }

  /**
   * Consume estimated generation cost (USD → cents). Idempotent on requestId.
   */
  async consumeGeneration(opts: {
    userId: string;
    requestId: string;
    estimatedCostUsd: number;
  }): Promise<void> {
    const cents = Math.max(0, Math.round(opts.estimatedCostUsd * 100));
    if (cents <= 0) return;

    const existing = await this.repo.findLedgerByRef(
      opts.userId,
      'consume_generation',
      opts.requestId,
    );
    if (existing) return;

    await this.repo.appendLedgerEntry({
      userId: opts.userId,
      deltaCents: -cents,
      reason: 'consume_generation',
      periodKey: currentPeriodKey(),
      refType: 'request',
      refId: opts.requestId,
    });
  }

  async getUsageSummary(userId: string): Promise<BillingUsageApi> {
    const periodKey = currentPeriodKey();
    const entries = await this.repo.listLedgerForPeriod(userId, periodKey);
    const balance = await this.repo.getCreditBalance(userId);
    let granted = 0;
    let consumed = 0;
    for (const e of entries) {
      if (e.deltaCents > 0) granted += e.deltaCents;
      if (e.deltaCents < 0) consumed += -e.deltaCents;
    }
    return {
      period_key: periodKey,
      balance_cents: balance,
      granted_cents: granted,
      consumed_cents: consumed,
      entries: entries.map((e) => ({
        id: e.id,
        delta_cents: e.deltaCents,
        balance_after_cents: e.balanceAfterCents,
        reason: e.reason,
        ref_type: e.refType,
        ref_id: e.refId,
        created_at: e.createdAt.toISOString(),
      })),
    };
  }
}
