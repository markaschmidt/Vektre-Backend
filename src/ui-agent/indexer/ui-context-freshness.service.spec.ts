import { ConflictException } from '@nestjs/common';
import type { UiDocumentRevisionRow } from '../models/ui-agent.model.js';
import type { UiContextRepository } from '../repositories/ui-context.repository.js';
import { UiContextFreshnessService } from './ui-context-freshness.service.js';
import type { UiContextIndexRepository } from './ui-context-index.repository.js';
import type { UiContextIndexService } from './ui-context-index.service.js';

describe('UiContextFreshnessService', () => {
  const index = {
    getLatestSnapshot: jest.fn(),
  };
  const context = {
    getLatestDocumentRevision: jest.fn(),
  };
  const indexer = {
    indexSnapshot: jest.fn(),
  };
  const service = new UiContextFreshnessService(
    index as unknown as UiContextIndexRepository,
    context as unknown as UiContextRepository,
    indexer as unknown as UiContextIndexService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('uses an already current revision without re-indexing', async () => {
    const current = revision('snapshot-current');
    index.getLatestSnapshot.mockResolvedValue({
      snapshotId: 'snapshot-current',
      documentKey: current.documentKey,
      stateVector: 'state',
      storageRef: 'supabase://bucket/snapshot.yjs',
      createdAt: new Date(),
    });
    context.getLatestDocumentRevision.mockResolvedValue(current);

    await expect(service.ensureCurrent(scope())).resolves.toBe(current);
    expect(indexer.indexSnapshot).not.toHaveBeenCalled();
  });

  it('synchronously catches a stale index up to the newest snapshot', async () => {
    const current = revision('snapshot-new');
    index.getLatestSnapshot.mockResolvedValue({
      snapshotId: 'snapshot-new',
      documentKey: current.documentKey,
      stateVector: 'state',
      storageRef: 'supabase://bucket/snapshot.yjs',
      createdAt: new Date(),
    });
    context.getLatestDocumentRevision.mockResolvedValue(
      revision('snapshot-old'),
    );
    indexer.indexSnapshot.mockResolvedValue({
      status: 'ready',
      revision: current,
      validationIssues: [],
    });

    await expect(service.ensureCurrent(scope())).resolves.toBe(current);
    expect(indexer.indexSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: 'snapshot-new' }),
    );
  });

  it('blocks the run when the newest live document is invalid', async () => {
    index.getLatestSnapshot.mockResolvedValue({
      snapshotId: 'snapshot-invalid',
      documentKey: scope().documentKey,
      stateVector: 'state',
      storageRef: 'supabase://bucket/snapshot.yjs',
      createdAt: new Date(),
    });
    context.getLatestDocumentRevision.mockResolvedValue(
      revision('snapshot-old'),
    );
    indexer.indexSnapshot.mockResolvedValue({
      status: 'invalid',
      validationIssues: [
        {
          code: 'missing_surface',
          path: '/screens/main',
          message: 'Missing surface',
          relatedIds: [],
        },
      ],
    });

    await expect(service.ensureCurrent(scope())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

function scope() {
  return {
    projectId: 'project-1',
    documentId: 'document-1',
    documentKey: 'project:project-1:doc:gui_screen:document-1',
  };
}

function revision(snapshotId: string): UiDocumentRevisionRow {
  return {
    revisionId: `revision-${snapshotId}`,
    projectId: 'project-1',
    documentId: 'document-1',
    documentKey: scope().documentKey,
    documentHash: 'a'.repeat(64),
    snapshotId,
    structuralDigest: {},
    layoutFingerprints: {},
    createdAt: new Date(),
  };
}
