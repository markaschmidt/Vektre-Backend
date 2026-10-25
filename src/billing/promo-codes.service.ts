import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingRepository } from './repositories/billing.repository.js';
import { UsageCreditsService } from './usage-credits.service.js';

@Injectable()
export class PromoCodesService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly credits: UsageCreditsService,
  ) {}

  async redeem(
    userId: string,
    rawCode: string,
  ): Promise<{ credit_cents: number; balance_cents: number }> {
    const code = rawCode.trim().toUpperCase();
    const promo = await this.repo.getPromoCode(code);
    if (!promo || !promo.active) {
      throw new NotFoundException('Promo code not found');
    }
    if (promo.expiresAt && promo.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Promo code has expired');
    }
    if (
      promo.maxRedemptions != null &&
      promo.redeemedCount >= promo.maxRedemptions
    ) {
      throw new BadRequestException('Promo code has reached max redemptions');
    }

    if (await this.repo.hasPromoRedemption(code, userId)) {
      throw new ConflictException('Promo code already redeemed');
    }

    await this.repo.redeemPromo({
      code,
      userId,
      creditCents: promo.creditCents,
    });
    const balance = await this.credits.grantPromoCredits({
      userId,
      creditCents: promo.creditCents,
      code,
    });

    return { credit_cents: promo.creditCents, balance_cents: balance };
  }
}
