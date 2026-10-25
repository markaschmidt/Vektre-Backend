import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsageCreditsService } from './usage-credits.service.js';
import { BillingRepository } from './repositories/billing.repository.js';

describe('UsageCreditsService', () => {
  const repo = {
    getCreditBalance: jest.fn(),
    listLedgerForPeriod: jest.fn(),
    findLedgerByRef: jest.fn(),
    appendLedgerEntry: jest.fn(),
  };

  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      periodCreditsCents: {
        free: 1000,
        professional: 3000,
        studio: 6000,
        enterprise: 100_000,
      },
    }),
  };

  let service: UsageCreditsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsageCreditsService(
      repo as unknown as BillingRepository,
      config as unknown as ConfigService,
    );
  });

  it('grants period credits idempotently by ref', async () => {
    repo.findLedgerByRef.mockResolvedValue(null);
    repo.appendLedgerEntry.mockResolvedValue({
      balanceAfterCents: 3000,
    });

    const balance = await service.grantPeriodCredits({
      userId: 'user-1',
      plan: 'professional',
      reason: 'grant_trial',
      periodKey: '2026-08',
    });

    expect(balance).toBe(3000);
    expect(repo.appendLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        deltaCents: 3000,
        reason: 'grant_trial',
        refId: 'professional:2026-08:grant_trial',
      }),
    );

    repo.findLedgerByRef.mockResolvedValue({ balanceAfterCents: 3000 });
    const again = await service.grantPeriodCredits({
      userId: 'user-1',
      plan: 'professional',
      reason: 'grant_trial',
      periodKey: '2026-08',
    });
    expect(again).toBe(3000);
    expect(repo.appendLedgerEntry).toHaveBeenCalledTimes(1);
  });

  it('assertHasCredits throws insufficient_credits when balance is 0', async () => {
    repo.getCreditBalance.mockResolvedValue(0);
    await expect(service.assertHasCredits('user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('consumeGeneration is idempotent on requestId', async () => {
    repo.findLedgerByRef.mockResolvedValue({ id: 'existing' });
    await service.consumeGeneration({
      userId: 'user-1',
      requestId: 'req-1',
      estimatedCostUsd: 1.25,
    });
    expect(repo.appendLedgerEntry).not.toHaveBeenCalled();

    repo.findLedgerByRef.mockResolvedValue(null);
    repo.appendLedgerEntry.mockResolvedValue({});
    await service.consumeGeneration({
      userId: 'user-1',
      requestId: 'req-2',
      estimatedCostUsd: 1.25,
    });
    expect(repo.appendLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        deltaCents: -125,
        reason: 'consume_generation',
        refId: 'req-2',
      }),
    );
  });
});
