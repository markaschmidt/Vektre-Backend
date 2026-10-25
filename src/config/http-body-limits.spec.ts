import {
  isLargeBodyUploadRoute,
  isStripeWebhookRoute,
} from './http-body-limits.js';

describe('isLargeBodyUploadRoute', () => {
  it('allows large bodies for asset upload', () => {
    expect(
      isLargeBodyUploadRoute('/projects/proj-1/assets/upload', 'POST'),
    ).toBe(true);
  });

  it('allows large bodies for asset chunk upload', () => {
    expect(
      isLargeBodyUploadRoute('/projects/proj-1/assets/asset-1/chunks', 'POST'),
    ).toBe(true);
  });

  it('allows large bodies for Google Drive export', () => {
    expect(
      isLargeBodyUploadRoute('/integrations/google-drive/export', 'POST'),
    ).toBe(true);
  });

  it('allows large bodies for organization logo upload', () => {
    expect(isLargeBodyUploadRoute('/organizations/logo/upload', 'POST')).toBe(
      true,
    );
    expect(
      isLargeBodyUploadRoute('/organizations/org-1/logo', 'POST'),
    ).toBe(true);
  });

  it('keeps default limit for other project routes', () => {
    expect(isLargeBodyUploadRoute('/projects/proj-1/assets', 'POST')).toBe(
      false,
    );
    expect(
      isLargeBodyUploadRoute(
        '/projects/proj-1/assets/import-generated',
        'POST',
      ),
    ).toBe(false);
    expect(isLargeBodyUploadRoute('/generative-model/3d', 'POST')).toBe(false);
  });

  it('keeps default limit for non-POST methods on upload paths', () => {
    expect(
      isLargeBodyUploadRoute('/projects/proj-1/assets/upload', 'GET'),
    ).toBe(false);
  });
});

describe('isStripeWebhookRoute', () => {
  it('matches Stripe webhook POST', () => {
    expect(isStripeWebhookRoute('/billing/webhooks/stripe', 'POST')).toBe(true);
  });

  it('rejects other methods and paths', () => {
    expect(isStripeWebhookRoute('/billing/webhooks/stripe', 'GET')).toBe(false);
    expect(isStripeWebhookRoute('/billing/me', 'POST')).toBe(false);
  });
});
