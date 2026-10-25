import { ConflictException, NotFoundException } from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service.js';
import { BillingRepository } from './repositories/billing.repository.js';
import { UsageCreditsService } from './usage-credits.service.js';

describe('PromoCodesService', () => {
  const repo = {
    getPromoCode: jest.fn(),
    hasPromoRedemption: jest.fn(),
    redeemPromo: jest.fn(),
  };
  const credits = {
    grantPromoCredits: jest.fn().mockResolvedValue(5000),
  };

  let service: PromoCodesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PromoCodesService(
      repo as unknown as BillingRepository,
      credits as unknown as UsageCreditsService,
    );
  });

  it('redeems an active promo once', async () => {
    repo.getPromoCode.mockResolvedValue({
      code: 'LAUNCH50',
      creditCents: 5000,
      maxRedemptions: 100,
      redeemedCount: 1,
      expiresAt: null,
      active: true,
    });
    repo.hasPromoRedemption.mockResolvedValue(false);

    const result = await service.redeem('user-1', 'launch50');
    expect(result).toEqual({ credit_cents: 5000, balance_cents: 5000 });
    expect(repo.redeemPromo).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'LAUNCH50', userId: 'user-1' }),
    );
  });

  it('rejects unknown codes', async () => {
    repo.getPromoCode.mockResolvedValue(null);
    await expect(service.redeem('user-1', 'NOPE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects second redemption for the same user', async () => {
    repo.getPromoCode.mockResolvedValue({
      code: 'LAUNCH50',
      creditCents: 5000,
      maxRedemptions: null,
      redeemedCount: 1,
      expiresAt: null,
      active: true,
    });
    repo.hasPromoRedemption.mockResolvedValue(true);
    await expect(service.redeem('user-1', 'LAUNCH50')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
