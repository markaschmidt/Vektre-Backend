import { UiContextRepository } from './ui-context.repository.js';
import type { SupabaseService } from '../../integrations/supabase.js';

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

function createChain(result: QueryResult) {
  const chain: Record<string, jest.Mock> = {};
  const terminal = jest.fn().mockResolvedValue(result);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = terminal;
  chain.single = terminal;
  return chain;
}

function revisionRow(overrides: Record<string, unknown> = {}) {
  return {
    revision_id: 'uirev_existing',
    project_id: 'project-1',
    document_id: 'document-1',
    document_key: 'project:project-1:doc:gui_screen:document-1',
    document_hash: 'a'.repeat(64),
    snapshot_id: 'snap-old',
    state_vector: 'state-old',
    structural_digest_json: { screens: 1 },
    layout_fingerprints_json: {},
    source_snapshot_created_at: '2026-08-31T10:00:00.000Z',
    created_at: '2026-08-31T10:00:00.000Z',
    ...overrides,
  };
}

function upsertInput() {
  return {
    revisionId: 'uirev_new',
    projectId: 'project-1',
    documentId: 'document-1',
    documentKey: 'project:project-1:doc:gui_screen:document-1',
    documentHash: 'a'.repeat(64),
    snapshotId: 'snap-new',
    stateVector: 'state-new',
    structuralDigest: { screens: 1 },
    layoutFingerprints: { layout: 'bottom-left' },
    sourceSnapshotCreatedAt: new Date('2026-08-31T10:06:00.000Z'),
  };
}

describe('UiContextRepository.upsertDocumentRevision', () => {
  let fromMock: jest.Mock;
  let repository: UiContextRepository;

  beforeEach(() => {
    fromMock = jest.fn();
    repository = new UiContextRepository({
      getAdminClient: () => ({ from: fromMock }),
    } as unknown as SupabaseService);
  });

  it('inserts a new revision id when the document hash is unseen', async () => {
    const lookup = createChain({ data: null, error: null });
    const insert = createChain({
      data: revisionRow({
        revision_id: 'uirev_new',
        snapshot_id: 'snap-new',
        state_vector: 'state-new',
      }),
      error: null,
    });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(insert);

    const result = await repository.upsertDocumentRevision(upsertInput());

    expect(result.revisionId).toBe('uirev_new');
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        revision_id: 'uirev_new',
        document_hash: 'a'.repeat(64),
        snapshot_id: 'snap-new',
      }),
    );
    expect(insert.update).not.toHaveBeenCalled();
    expect(insert.upsert).not.toHaveBeenCalled();
  });

  it('reuses the existing revision id instead of rewriting the primary key', async () => {
    const lookup = createChain({ data: revisionRow(), error: null });
    const update = createChain({
      data: revisionRow({
        snapshot_id: 'snap-new',
        state_vector: 'state-new',
        layout_fingerprints_json: { layout: 'bottom-left' },
      }),
      error: null,
    });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(update);

    const result = await repository.upsertDocumentRevision(upsertInput());

    expect(result.revisionId).toBe('uirev_existing');
    expect(result.snapshotId).toBe('snap-new');
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot_id: 'snap-new',
        state_vector: 'state-new',
        document_hash: 'a'.repeat(64),
      }),
    );
    expect(update.update.mock.calls[0][0]).not.toHaveProperty('revision_id');
    expect(update.eq).toHaveBeenCalledWith('revision_id', 'uirev_existing');
    expect(update.insert).not.toHaveBeenCalled();
    expect(update.upsert).not.toHaveBeenCalled();
  });

  it('updates the winner when a concurrent insert hits the unique hash constraint', async () => {
    const firstLookup = createChain({ data: null, error: null });
    const insert = createChain({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "ui_document_revision_document_key_document_hash_key"',
      },
    });
    const racedLookup = createChain({ data: revisionRow(), error: null });
    const update = createChain({
      data: revisionRow({ snapshot_id: 'snap-new' }),
      error: null,
    });
    fromMock
      .mockReturnValueOnce(firstLookup)
      .mockReturnValueOnce(insert)
      .mockReturnValueOnce(racedLookup)
      .mockReturnValueOnce(update);

    const result = await repository.upsertDocumentRevision(upsertInput());

    expect(result.revisionId).toBe('uirev_existing');
    expect(update.update.mock.calls[0][0]).not.toHaveProperty('revision_id');
    expect(update.eq).toHaveBeenCalledWith('revision_id', 'uirev_existing');
  });
});
