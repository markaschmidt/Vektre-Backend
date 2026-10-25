import * as Y from 'yjs';
import type { AppDataService } from '../../integrations/app-data.service.js';
import type { SupabaseService } from '../../integrations/supabase.js';
import type { UiContextRepository } from '../repositories/ui-context.repository.js';
import type { UiMemoryRepository } from '../repositories/ui-memory.repository.js';
import type { UiContextIndexRepository } from './ui-context-index.repository.js';
import { UiContextIndexService } from './ui-context-index.service.js';

describe('UiContextIndexService', () => {
  const supabase = {
    downloadObject: jest.fn(),
  };
  const appData = {
    listProjectComments: jest.fn().mockResolvedValue([]),
  };
  const index = {
    getAttemptBySnapshot: jest.fn(),
    getSnapshot: jest.fn(),
    markIndexState: jest.fn(),
    recordAttempt: jest.fn(),
    upsertRetrievalDocuments: jest.fn(),
    markRemovedDocumentSourcesStale: jest.fn(),
  };
  const context = {
    getBaseline: jest.fn(),
    getDocumentRevision: jest.fn(),
    upsertDocumentRevision: jest.fn(),
    upsertArtifactRelation: jest.fn(),
  };
  const memories = {};
  const service = new UiContextIndexService(
    supabase as unknown as SupabaseService,
    appData as unknown as AppDataService,
    index as unknown as UiContextIndexRepository,
    context as unknown as UiContextRepository,
    memories as unknown as UiMemoryRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    index.getAttemptBySnapshot.mockResolvedValue(null);
    index.getSnapshot.mockResolvedValue({
      snapshotId: 'snapshot-1',
      documentKey: 'project:project-1:doc:gui_screen:document-1',
      stateVector: 'state',
      storageRef: 'supabase://bucket/snapshot.yjs',
      createdAt: new Date(),
    });
    index.markIndexState.mockResolvedValue(undefined);
    index.recordAttempt.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );
    context.getBaseline.mockResolvedValue(null);
  });

  it('records invalid issues without overwriting the last valid revision', async () => {
    supabase.downloadObject.mockResolvedValue(Buffer.from(invalidUpdate()));

    const result = await service.indexSnapshot(snapshotJob());
    expect(result.status).toBe('invalid');
    expect(result.validationIssues[0]?.code).toBe('schema_validation_failed');
    expect(context.upsertDocumentRevision).not.toHaveBeenCalled();
    expect(index.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'invalid',
      }),
    );
  });

  it('treats a duplicate valid snapshot event as a no-op', async () => {
    index.getAttemptBySnapshot.mockResolvedValue({
      status: 'valid',
      revisionId: 'revision-1',
      validationIssues: [],
    });
    context.getDocumentRevision.mockResolvedValue({
      revisionId: 'revision-1',
      snapshotId: 'snapshot-1',
    });

    await expect(service.indexSnapshot(snapshotJob())).resolves.toEqual(
      expect.objectContaining({ status: 'ready' }),
    );
    expect(supabase.downloadObject).not.toHaveBeenCalled();
    expect(context.upsertDocumentRevision).not.toHaveBeenCalled();
  });
});

function snapshotJob() {
  return {
    kind: 'snapshot' as const,
    projectId: 'project-1',
    documentId: 'document-1',
    documentKey: 'project:project-1:doc:gui_screen:document-1',
    documentType: 'gui_screen' as const,
    snapshotId: 'snapshot-1',
    stateVector: 'state',
    storageRef: 'supabase://bucket/snapshot.yjs',
  };
}

function invalidUpdate(): Uint8Array {
  const document = new Y.Doc();
  document.getMap('root').set('schemaVersion', 2);
  return Y.encodeStateAsUpdate(document);
}
