import { GoogleDriveService } from './google-drive.service.js';

describe('GoogleDriveService.getExportMimeType', () => {
  let service: GoogleDriveService;

  beforeEach(() => {
    service = new GoogleDriveService({ get: () => ({ timeoutMs: 30_000 }) } as never);
  });

  it('returns text/plain for Google Docs', () => {
    expect(service.getExportMimeType('application/vnd.google-apps.document')).toBe('text/plain');
  });

  it('returns xlsx mime for Google Sheets', () => {
    expect(service.getExportMimeType('application/vnd.google-apps.spreadsheet')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('returns pptx mime for Google Slides', () => {
    expect(service.getExportMimeType('application/vnd.google-apps.presentation')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
  });

  it('returns null for regular files (direct download)', () => {
    expect(service.getExportMimeType('application/pdf')).toBeNull();
    expect(service.getExportMimeType('image/png')).toBeNull();
    expect(service.getExportMimeType('text/plain')).toBeNull();
  });
});
