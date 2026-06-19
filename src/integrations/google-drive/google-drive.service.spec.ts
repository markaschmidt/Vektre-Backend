import {
  GoogleDriveService,
  normalizeDriveExportFileName,
} from './google-drive.service.js';

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

describe('GoogleDriveService.resolveExportTargetMimeType', () => {
  let service: GoogleDriveService;

  beforeEach(() => {
    service = new GoogleDriveService({ get: () => ({ timeoutMs: 30_000 }) } as never);
  });

  it('defaults to markdown files', () => {
    expect(service.resolveExportTargetMimeType()).toBe('text/markdown');
    expect(service.resolveExportTargetMimeType('markdown')).toBe('text/markdown');
  });

  it('maps google doc aliases to workspace mime type', () => {
    expect(service.resolveExportTargetMimeType('google-doc')).toBe(
      'application/vnd.google-apps.document',
    );
    expect(service.resolveExportTargetMimeType('application/vnd.google-apps.document')).toBe(
      'application/vnd.google-apps.document',
    );
  });
});

describe('normalizeDriveExportFileName', () => {
  it('appends .md for markdown exports', () => {
    expect(normalizeDriveExportFileName('Story Draft', 'text/markdown')).toBe(
      'Story Draft.md',
    );
  });

  it('preserves binary filenames without forcing .md', () => {
    expect(normalizeDriveExportFileName('character.glb', 'model/gltf-binary')).toBe(
      'character.glb',
    );
  });

  it('strips .md for google doc exports', () => {
    expect(
      normalizeDriveExportFileName('Story Draft.md', 'application/vnd.google-apps.document'),
    ).toBe('Story Draft');
  });
});
