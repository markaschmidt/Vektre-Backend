import type { AppDataService } from '../../integrations/app-data.service.js';
import type { UiDocumentRevisionRow } from '../models/ui-agent.model.js';
import type { UiConversationRepository } from '../repositories/ui-conversation.repository.js';
import type { UiMemoryRepository } from '../repositories/ui-memory.repository.js';
import { UiContextAssembler } from './ui-context-assembler.js';
import type { UiContextIndexRepository } from './ui-context-index.repository.js';

describe('UiContextAssembler', () => {
  const appData = {
    listProjectComments: jest.fn(),
  };
  const conversations = {
    getThread: jest.fn(),
    listMessages: jest.fn(),
  };
  const memories = {
    listVisibleMemory: jest.fn(),
  };
  const index = {
    listArtifactRelations: jest.fn(),
    getExactSources: jest.fn(),
    searchText: jest.fn(),
    searchEmbeddings: jest.fn(),
  };
  const assembler = new UiContextAssembler(
    appData as unknown as AppDataService,
    conversations as unknown as UiConversationRepository,
    memories as unknown as UiMemoryRepository,
    index as unknown as UiContextIndexRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    conversations.getThread.mockResolvedValue({
      threadId: 'thread-1',
      projectId: 'project-1',
      documentId: 'document-1',
      ownerUserId: 'actor-1',
      visibility: 'shared',
      status: 'active',
    });
    conversations.listMessages.mockResolvedValue([]);
    appData.listProjectComments.mockResolvedValue([]);
    index.listArtifactRelations.mockResolvedValue([]);
    index.getExactSources.mockResolvedValue([]);
    index.searchText.mockResolvedValue([]);
    index.searchEmbeddings.mockRejectedValue(new Error('provider unavailable'));
    memories.listVisibleMemory.mockResolvedValue([]);
  });

  it('builds deterministic, token-bounded sections without leaking private sources', async () => {
    memories.listVisibleMemory.mockResolvedValue([
      memory('shared-memory', 'shared', 'actor-1'),
      memory('private-memory', 'private', 'other-user'),
    ]);
    index.searchText.mockResolvedValue([
      retrieval('shared-result', 'shared', 'actor-1'),
      retrieval('private-result', 'private', 'other-user'),
    ]);

    const first = await assembler.assemble(input());
    const second = await assembler.assemble(input());

    expect(first).toEqual(second);
    expect(first.sections.map((section) => section.name)).toEqual([
      'live_document',
      'explicit_references',
      'memory',
      'comments',
      'conversation',
      'human_delta',
      'artifacts',
      'retrieval',
    ]);
    expect(first.estimatedTokens).toBeLessThanOrEqual(first.totalTokenBudget);
    expect(
      first.sections.flatMap((section) =>
        section.sources.map((source) => source.sourceId),
      ),
    ).not.toEqual(expect.arrayContaining(['private-memory', 'private-result']));
  });

  it('keeps canonical context usable when optional embedding retrieval fails', async () => {
    const manifest = await assembler.assemble({
      ...input(),
      queryEmbedding: [0.1, 0.2],
    });

    expect(manifest.documentHash).toBe('a'.repeat(64));
    expect(manifest.sections[0]?.sources[0]?.selectionReason).toBe(
      'live_document',
    );
  });
});

function input() {
  return {
    manifestId: 'manifest-1',
    runId: 'run-1',
    actorUserId: 'actor-1',
    projectId: 'project-1',
    documentId: 'document-1',
    threadId: 'thread-1',
    messageParts: [{ type: 'text' as const, text: 'make health clearer' }],
    explicitCitations: [],
    revision: revision(),
    modelPresetId: 'preset-1',
    totalTokenBudget: 1_000,
    intent: 'edit',
    selectionHints: ['player_health'],
    generatedAt: new Date('2026-08-20T00:00:00.000Z'),
  };
}

function revision(): UiDocumentRevisionRow {
  return {
    revisionId: 'revision-1',
    projectId: 'project-1',
    documentId: 'document-1',
    documentKey: 'project:project-1:doc:gui_screen:document-1',
    documentHash: 'a'.repeat(64),
    snapshotId: 'snapshot-1',
    structuralDigest: {
      humanDelta: {
        added: [],
        changed: ['player_health'],
        deleted: [],
      },
    },
    layoutFingerprints: {
      player_health: { hash: 'b'.repeat(64) },
    },
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
  };
}

function memory(
  memoryId: string,
  visibility: 'shared' | 'private',
  ownerUserId: string,
) {
  return {
    memoryId,
    memoryOrder: 1,
    projectId: 'project-1',
    documentId: 'document-1',
    ownerUserId,
    kind: 'constraint',
    scope: 'document',
    text: `${memoryId} text`,
    status: 'accepted',
    visibility,
    pinned: false,
    provenance: {
      sourceKind: 'user',
      sourceId: ownerUserId,
      actorId: ownerUserId,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function retrieval(
  sourceId: string,
  visibility: 'shared' | 'private',
  ownerUserId: string,
) {
  return {
    retrievalId: `retrieval-${sourceId}`,
    ownerUserId,
    visibility,
    sourceKind: 'component',
    sourceId,
    sourceHash: 'c'.repeat(64),
    title: sourceId,
    contentText: `${sourceId} content`,
    metadata: {},
    rank: 0.8,
  };
}
