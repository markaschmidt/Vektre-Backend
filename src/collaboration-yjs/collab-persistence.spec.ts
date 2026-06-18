import * as Y from 'yjs';
import {
  getCollabBucket,
  loadDocumentSnapshot,
  storeDocumentSnapshot,
} from './collab-persistence.js';
import type { ParsedDocumentName } from './document-name.js';

const mockDownload = jest.fn();
const mockUpload = jest.fn();
const mockMaybeSingle = jest.fn();
const mockSelect = jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: mockMaybeSingle })) }));
const mockUpsert = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn((table: string) => {
  if (table === 'collaboration_document') {
    return {
      select: mockSelect,
      upsert: mockUpsert,
    };
  }
  if (table === 'collaboration_snapshot') {
    return {
      insert: mockInsert,
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});
const mockStorageFrom = jest.fn(() => ({
  download: mockDownload,
  upload: mockUpload,
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom,
    storage: { from: mockStorageFrom },
  })),
}));

const parsed: ParsedDocumentName = {
  projectId: 'proj-1',
  documentId: 'doc-1',
  documentType: 'canvas',
  documentKey: 'project:proj-1:doc:canvas:doc-1',
};

describe('collab-persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_COLLAB_BUCKET = 'test-collab-bucket';
  });

  it('uses the configured collaboration snapshot bucket', () => {
    expect(getCollabBucket()).toBe('test-collab-bucket');
  });

  it('loads an existing snapshot into the Yjs document', async () => {
    const source = new Y.Doc();
    source.getMap('canvas').set('node-1', { x: 10, y: 20 });
    const update = Y.encodeStateAsUpdate(source);

    mockMaybeSingle.mockResolvedValue({
      data: {
        document_id: 'doc-1',
        storage_ref: 'supabase://test-collab-bucket/projects/proj-1/docs/canvas/doc-1/latest.yjs',
      },
      error: null,
    });
    mockDownload.mockResolvedValue({
      data: {
        arrayBuffer: async () =>
          update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength),
      },
      error: null,
    });

    const target = new Y.Doc();
    await loadDocumentSnapshot(parsed, target);

    expect(mockSelect).toHaveBeenCalledWith('document_id, storage_ref');
    expect(mockStorageFrom).toHaveBeenCalledWith('test-collab-bucket');
    expect(mockDownload).toHaveBeenCalledWith('projects/proj-1/docs/canvas/doc-1/latest.yjs');
    expect(target.getMap('canvas').get('node-1')).toEqual({ x: 10, y: 20 });
  });

  it('stores a compacted snapshot and project-scoped metadata', async () => {
    const doc = new Y.Doc();
    doc.getMap('gui').set('button-1', { text: 'Save' });

    mockUpload.mockResolvedValue({ error: null });
    mockMaybeSingle.mockResolvedValue({ data: { version: 4 }, error: null });
    mockUpsert.mockResolvedValue({ error: null });
    mockInsert.mockResolvedValue({ error: null });

    await storeDocumentSnapshot(
      { ...parsed, documentType: 'gui_screen', documentKey: 'project:proj-1:doc:gui_screen:doc-1' },
      doc,
      'user-1',
    );

    expect(mockUpload).toHaveBeenCalledWith(
      'projects/proj-1/docs/gui_screen/doc-1/latest.yjs',
      expect.any(Buffer),
      { contentType: 'application/octet-stream', upsert: true },
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        document_key: 'project:proj-1:doc:gui_screen:doc-1',
        project_id: 'proj-1',
        document_id: 'doc-1',
        document_type: 'gui_screen',
        version: 5,
        updated_by_user_id: 'user-1',
      }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        document_key: 'project:proj-1:doc:gui_screen:doc-1',
        document_id: 'doc-1',
        created_by_user_id: 'user-1',
      }),
    );
  });
});
