import {
  GoogleDriveService,
  normalizeDriveExportFileName,
  buildMultipartBody,
  buildDriveFileMetadata,
  resolveDriveMediaContentType,
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

describe('buildDriveFileMetadata', () => {
  it('omits text/markdown mimeType and keeps .md filename', () => {
    expect(
      buildDriveFileMetadata({ fileName: 'Story', mimeType: 'text/markdown' }),
    ).toEqual({ name: 'Story.md' });
  });

  it('sets google doc conversion mimeType', () => {
    expect(
      buildDriveFileMetadata({
        fileName: 'Story',
        mimeType: 'application/vnd.google-apps.document',
      }),
    ).toEqual({ name: 'Story', mimeType: 'application/vnd.google-apps.document' });
  });
});

describe('resolveDriveMediaContentType', () => {
  it('maps markdown to text/plain for Google multipart media part', () => {
    expect(resolveDriveMediaContentType('text/markdown')).toBe('text/plain; charset=UTF-8');
  });

  it('preserves binary mime types', () => {
    expect(resolveDriveMediaContentType('model/gltf-binary')).toBe('model/gltf-binary');
  });
});

describe('buildMultipartBody', () => {
  it('builds RFC 2387 multipart/related with json metadata then media', () => {
    const boundary = 'test_boundary';
    const body = buildMultipartBody(
      boundary,
      { name: 'Story.md' },
      '# Title\n\nBody',
      'text/plain',
    );
    const text = body.toString('utf8');

    expect(text.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`)).toBe(
      true,
    );
    expect(text).toContain('{"name":"Story.md"}');
    expect(text).toContain(`\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n`);
    expect(text).toContain('# Title\n\nBody');
    expect(text.endsWith(`\r\n--${boundary}--`)).toBe(true);
  });
});
