import { isLargeBodyUploadRoute } from './http-body-limits.js';

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

  it('keeps default limit for other project routes', () => {
    expect(isLargeBodyUploadRoute('/projects/proj-1/assets', 'POST')).toBe(false);
    expect(
      isLargeBodyUploadRoute('/projects/proj-1/assets/import-generated', 'POST'),
    ).toBe(false);
    expect(isLargeBodyUploadRoute('/generative-model/3d', 'POST')).toBe(false);
  });

  it('keeps default limit for non-POST methods on upload paths', () => {
    expect(
      isLargeBodyUploadRoute('/projects/proj-1/assets/upload', 'GET'),
    ).toBe(false);
  });
});
