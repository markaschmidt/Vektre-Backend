import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service.js';
import { BillingRepository } from './repositories/billing.repository.js';
import { StripeClient } from './stripe.client.js';
import { UsageCreditsService } from './usage-credits.service.js';
import { AppDataService } from '../integrations/app-data.service.js';

describe('BillingService', () => {
  const repo = {
    updateUserPlan: jest.fn(),
    getCustomer: jest.fn(),
    upsertCustomer: jest.fn(),
    upsertSubscription: jest.fn(),
    claimWebhookEvent: jest.fn(),
    getCustomerByStripeId: jest.fn(),
    getSubscriptionForUser: jest.fn(),
  };
  const stripe = {
    createCustomer: jest.fn(),
    createTrialSubscription: jest.fn(),
  };
  const credits = {
    grantPeriodCredits: jest.fn().mockResolvedValue(1000),
    getUsageSummary: jest.fn().mockResolvedValue({
      period_key: '2026-08',
      balance_cents: 1000,
      granted_cents: 1000,
      consumed_cents: 0,
      entries: [],
    }),
  };
  const appData = {
    getUserProfile: jest.fn().mockResolvedValue({ plan: 'free' }),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      secretKey: '',
      prices: {
        professional: { month: 'price_pro_m', year: 'price_pro_y' },
        studio: { month: 'price_studio_m', year: 'price_studio_y' },
        enterprise: { month: 'price_ent_m', year: 'price_ent_y' },
      },
      checkoutSuccessUrl: '',
      portalReturnUrl: '',
    }),
  };

  let service: BillingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BillingService(
      repo as unknown as BillingRepository,
      stripe as unknown as StripeClient,
      credits as unknown as UsageCreditsService,
      appData as unknown as AppDataService,
      config as unknown as ConfigService,
    );
  });

  it('starts free onboarding with local grant and no Stripe calls', async () => {
    await service.startOnboardingEntitlement('user-1', 'free');
    expect(repo.updateUserPlan).toHaveBeenCalledWith('user-1', 'free');
    expect(credits.grantPeriodCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        plan: 'free',
        reason: 'grant_plan',
      }),
    );
    expect(stripe.createCustomer).not.toHaveBeenCalled();
  });

  it('grants trial credits locally when Stripe secret is unset', async () => {
    await service.startOnboardingEntitlement('user-1', 'professional');
    expect(credits.grantPeriodCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'professional',
        reason: 'grant_trial',
      }),
    );
    expect(stripe.createTrialSubscription).not.toHaveBeenCalled();
  });

  it('skips already-processed webhook events', async () => {
    repo.claimWebhookEvent.mockResolvedValue(false);
    await service.handleStripeEvent({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      data: { object: {} },
    } as never);
    expect(repo.getCustomerByStripeId).not.toHaveBeenCalled();
  });
});
