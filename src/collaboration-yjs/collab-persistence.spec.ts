import * as Y from 'yjs';
import {
  getCollabBucket,
  getSnapshotRetentionLimit,
  loadDocumentSnapshot,
  storeDocumentSnapshot,
} from './collab-persistence.js';
import type { ParsedDocumentName } from './document-name.js';

const mockDownload = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockUpsert = jest.fn();
const mockInsert = jest.fn();

const mockPruneRange = jest.fn(() =>
  Promise.resolve({ data: [] as { snapshot_id: string; storage_ref: string }[], error: null }),
);
const mockPruneOrder = jest.fn(() => ({ range: mockPruneRange }));
const mockPruneEq = jest.fn(() => ({ order: mockPruneOrder }));
const mockPruneSelect = jest.fn(() => ({ eq: mockPruneEq }));
const mockDeleteIn = jest.fn(() => Promise.resolve({ error: null }));
const mockDelete = jest.fn(() => ({ in: mockDeleteIn }));

const mockFrom = jest.fn((table: string) => {
  if (table === 'collaboration_document') {
    return {
      select: mockSelect,
      upsert: mockUpsert,
      insert: mockInsert,
    };
  }
  if (table === 'collaboration_snapshot') {
    return {
      insert: mockInsert,
      select: mockPruneSelect,
      delete: mockDelete,
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});
const mockStorageFrom = jest.fn(() => ({
  download: mockDownload,
  upload: mockUpload,
  remove: mockRemove,
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom,
    storage: { from: mockStorageFrom },
  })),
}));

const parsed: ParsedDocumentName = {
  kind: 'document',
  projectId: 'proj-1',
  documentId: 'doc-1',
  documentType: 'canvas',
  documentKey: 'project:proj-1:doc:canvas:doc-1',
};

describe('collab-persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockUpsert.mockResolvedValue({ error: null });
    mockUpload.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_COLLAB_BUCKET = 'test-collab-bucket';
    delete process.env.COLLAB_SNAPSHOT_RETENTION;
  });

  it('uses the configured collaboration snapshot bucket', () => {
    expect(getCollabBucket()).toBe('test-collab-bucket');
  });

  it('defaults snapshot retention to 200 and honors overrides', () => {
    expect(getSnapshotRetentionLimit()).toBe(200);
    process.env.COLLAB_SNAPSHOT_RETENTION = '50';
    expect(getSnapshotRetentionLimit()).toBe(50);
  });

  it('loads an existing snapshot into the Yjs document without touching metadata', async () => {
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
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('registers document metadata on first open even without an existing snapshot', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockDownload.mockResolvedValue({ data: null, error: { message: 'Object not found' } });

    const target = new Y.Doc();
    await loadDocumentSnapshot(parsed, target);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        document_key: 'project:proj-1:doc:canvas:doc-1',
        document_id: 'doc-1',
        project_id: 'proj-1',
        document_type: 'canvas',
        title: 'Untitled',
        version: 0,
      }),
    );
  });

  it('stores a compacted snapshot, an immutable per-version copy, and project-scoped metadata for a brand new document', async () => {
    const doc = new Y.Doc();
    doc.getMap('gui').set('button-1', { text: 'Save' });

    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

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
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^projects\/proj-1\/docs\/gui_screen\/doc-1\/snapshots\/snap_.+\.yjs$/),
      expect.any(Buffer),
      { contentType: 'application/octet-stream', upsert: true },
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        document_key: 'project:proj-1:doc:gui_screen:doc-1',
        project_id: 'proj-1',
        document_id: 'doc-1',
        document_type: 'gui_screen',
        title: 'Untitled',
        created_by_user_id: 'user-1',
        version: 1,
        updated_by_user_id: 'user-1',
        storage_ref: 'supabase://test-collab-bucket/projects/proj-1/docs/gui_screen/doc-1/latest.yjs',
      }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        document_key: 'project:proj-1:doc:gui_screen:doc-1',
        document_id: 'doc-1',
        created_by_user_id: 'user-1',
        storage_ref: expect.stringMatching(
          /^supabase:\/\/test-collab-bucket\/projects\/proj-1\/docs\/gui_screen\/doc-1\/snapshots\/snap_.+\.yjs$/,
        ),
      }),
    );
  });

  it('does not overwrite title/created_by_user_id when re-saving an existing document', async () => {
    const doc = new Y.Doc();
    doc.getMap('canvas').set('node-2', { x: 1 });

    mockMaybeSingle.mockResolvedValue({ data: { version: 4 }, error: null });

    await storeDocumentSnapshot(parsed, doc, 'user-2');

    const upsertPayload = mockUpsert.mock.calls[0][0];
    expect(upsertPayload).not.toHaveProperty('title');
    expect(upsertPayload).not.toHaveProperty('created_by_user_id');
    expect(upsertPayload).toMatchObject({ version: 5, updated_by_user_id: 'user-2' });
  });

  it('prunes stale snapshot rows and their per-version storage objects after saving', async () => {
    const doc = new Y.Doc();
    mockMaybeSingle.mockResolvedValue({ data: { version: 1 }, error: null });
    mockPruneRange.mockResolvedValue({
      data: [
        { snapshot_id: 'snap_old_1', storage_ref: 'supabase://test-collab-bucket/projects/proj-1/docs/canvas/doc-1/snapshots/snap_old_1.yjs' },
        { snapshot_id: 'snap_old_2', storage_ref: 'supabase://test-collab-bucket/projects/proj-1/docs/canvas/doc-1/snapshots/snap_old_2.yjs' },
      ],
      error: null,
    });

    await storeDocumentSnapshot(parsed, doc, 'user-1');

    expect(mockPruneSelect).toHaveBeenCalledWith('snapshot_id, storage_ref');
    expect(mockPruneEq).toHaveBeenCalledWith('document_key', parsed.documentKey);
    expect(mockDeleteIn).toHaveBeenCalledWith('snapshot_id', ['snap_old_1', 'snap_old_2']);
    expect(mockRemove).toHaveBeenCalledWith([
      'projects/proj-1/docs/canvas/doc-1/snapshots/snap_old_1.yjs',
      'projects/proj-1/docs/canvas/doc-1/snapshots/snap_old_2.yjs',
    ]);
  });
});
