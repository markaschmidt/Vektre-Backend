import { BadRequestException } from '@nestjs/common';
import { BillingWebhookController } from './billing-webhook.controller.js';
import { StripeClient } from './stripe.client.js';

describe('BillingWebhookController', () => {
  const stripe = {
    constructEvent: jest.fn(),
  };
  const queue = {
    add: jest.fn().mockResolvedValue({ id: 'evt_1' }),
  };

  let controller: BillingWebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new BillingWebhookController(
      stripe as unknown as StripeClient,
      queue as never,
    );
  });

  it('rejects missing signature', async () => {
    await expect(
      controller.handleStripe(
        { rawBody: Buffer.from('{}') } as never,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid signature', async () => {
    stripe.constructEvent.mockImplementation(() => {
      throw new Error('bad sig');
    });
    await expect(
      controller.handleStripe({ rawBody: Buffer.from('{}') } as never, 'sig'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enqueues verified events with event.id as jobId', async () => {
    stripe.constructEvent.mockReturnValue({
      id: 'evt_123',
      type: 'invoice.paid',
    });
    const result = await controller.handleStripe(
      { rawBody: Buffer.from('{"id":"evt_123"}') } as never,
      'sig_ok',
    );
    expect(result).toEqual({ received: true });
    expect(queue.add).toHaveBeenCalledWith(
      'stripe-webhook',
      expect.objectContaining({ eventId: 'evt_123' }),
      expect.objectContaining({ jobId: 'evt_123' }),
    );
  });
});
