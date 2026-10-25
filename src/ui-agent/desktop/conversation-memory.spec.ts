import {
  COMMENTS_ARE_NOT_AI_CHAT,
  PRIVATE_APPLY_SHARES_TRANSCRIPT,
  acceptedGuidance,
  appendMessageRequest,
  composeUiMessageParts,
  contextInspectorView,
  desktopFeatureFlags,
  filterDesignMemory,
  interpretMutatingConflict,
  memoryReviewModel,
  privateThreadMustNotLeak,
  staleCommentAnchorLabel,
  threadVisibilityChrome,
  type ContextManifest,
  type DesignMemoryRecord,
  type SourceCitation,
  type ThreadSummary,
  type UIAIMessage,
} from '@markaschmidt/ui-builder-contracts';

const HASH = 'b'.repeat(64);

describe('conversation and design memory UI helpers', () => {
  it('composes multimodal parts from text, images, UI, comments, and artifacts', () => {
    const parts = composeUiMessageParts({
      text: 'Make this gothic',
      images: [{ assetId: 'asset_ref_1', purpose: 'style' }],
      uiReferences: [{ referenceKind: 'component', semanticId: 'player_health' }],
      comments: [{ commentId: 'comment_1' }],
      storyboardSections: [
        {
          documentId: 'doc_story',
          headerBlockId: 'hdr_1',
          contentHash: HASH,
        },
      ],
      projectArtifacts: [
        { artifactKind: 'asset', artifactId: 'asset_ref_1' },
      ],
    });
    expect(parts.map((part) => part.type)).toEqual([
      'text',
      'image_asset',
      'ui_reference',
      'storyboard_section',
      'comment',
      'project_artifact',
    ]);
    expect(COMMENTS_ARE_NOT_AI_CHAT).toBe(true);
    expect(staleCommentAnchorLabel()).toBe('component removed');
    const request = appendMessageRequest({
      parts,
      execute: true,
      intent: 'edit',
    });
    expect(request.idempotencyKey).toHaveLength(36);
  });

  it('makes private draft visibility obvious and does not publish the transcript on apply', () => {
    const chrome = threadVisibilityChrome('private');
    expect(chrome.ownerOnly).toBe(true);
    expect(chrome.tone).toBe('private-draft');
    expect(chrome.applySharesDocument).toBe(true);
    expect(chrome.applySharesTranscript).toBe(false);
    expect(PRIVATE_APPLY_SHARES_TRANSCRIPT).toBe(false);
  });

  it('keeps private threads and citations out of shared aggregates', () => {
    const threads: ThreadSummary[] = [
      {
        threadId: 'thr_shared',
        projectId: 'proj_1',
        documentId: 'doc_1',
        ownerUserId: 'user_a',
        title: 'Shared',
        visibility: 'shared',
        status: 'active',
      },
      {
        threadId: 'thr_private',
        projectId: 'proj_1',
        documentId: 'doc_1',
        ownerUserId: 'user_a',
        title: 'Draft',
        visibility: 'private',
        status: 'active',
      },
    ];
    const privateCitation: SourceCitation = {
      sourceId: 'src_private',
      sourceKind: 'message',
      contentHash: HASH,
      visibility: 'private',
    };
    const messages: UIAIMessage[] = [
      {
        messageId: 'msg_shared',
        threadId: 'thr_shared',
        actorId: 'user_a',
        role: 'user',
        visibility: 'shared',
        parts: [{ type: 'text', text: 'hello' }],
        citations: [],
        createdAt: '2026-08-20T06:00:00.000Z',
      },
      {
        messageId: 'msg_private',
        threadId: 'thr_private',
        actorId: 'user_a',
        role: 'user',
        visibility: 'private',
        parts: [{ type: 'text', text: 'secret' }],
        citations: [privateCitation],
        createdAt: '2026-08-20T06:00:00.000Z',
      },
    ];
    const shared = privateThreadMustNotLeak(messages, threads);
    expect(shared.map((message) => message.messageId)).toEqual(['msg_shared']);
    expect(shared.some((message) => message.visibility === 'private')).toBe(
      false,
    );
  });

  it('filters memory and exposes accept/reject/publish without sharing transcripts', () => {
    const records: DesignMemoryRecord[] = [
      memory({
        memoryId: 'mem_lore',
        kind: 'lore',
        status: 'accepted',
        visibility: 'shared',
        text: 'The kingdom is gothic',
      }),
      memory({
        memoryId: 'mem_draft',
        kind: 'aesthetic',
        status: 'proposed',
        visibility: 'private',
        text: 'Try neon',
        ownerUserId: 'user_a',
      }),
      memory({
        memoryId: 'mem_reject',
        kind: 'rejected_direction',
        status: 'rejected',
        visibility: 'shared',
        text: 'No comic book inks',
      }),
    ];
    expect(
      filterDesignMemory(records, { kind: 'lore', status: 'accepted' }).map(
        (record) => record.memoryId,
      ),
    ).toEqual(['mem_lore']);
    expect(acceptedGuidance(records).map((record) => record.memoryId)).toEqual([
      'mem_lore',
    ]);
    const review = memoryReviewModel(records[1]!, 'user_a');
    expect(review.canAccept).toBe(true);
    expect(review.canReject).toBe(true);
    expect(review.canPublish).toBe(true);
    expect(review.publishSharesTranscript).toBe(false);
  });

  it('hides AI chrome when capabilities are missing and never queues a duplicate mutating run', () => {
    expect(
      desktopFeatureFlags({ capabilitiesHttpStatus: 404 }).aiChat,
    ).toBe(false);
    expect(
      desktopFeatureFlags({ capabilitiesHttpStatus: 404 }).nativeEditor,
    ).toBe(true);
    expect(
      interpretMutatingConflict({
        status: 409,
        code: 'active_mutating_run',
        activeRun: { runId: 'run_busy' },
      }),
    ).toEqual({
      showBusy: true,
      queueDuplicate: false,
      activeRunId: 'run_busy',
    });
  });

  it('sanitizes the context inspector and strips private sources from other users', () => {
    const view = contextInspectorView(manifest(), {
      viewerUserId: 'user_b',
      runActorId: 'user_a',
    });
    expect(view.documentHash).toBe(HASH);
    expect(view.cited.map((source) => source.visibility)).toEqual(['shared']);
    expect(view.tokenAllocation[0]?.section).toBe('live_document');
  });
});

function memory(
  input: Partial<DesignMemoryRecord> &
    Pick<DesignMemoryRecord, 'memoryId' | 'kind' | 'status' | 'visibility' | 'text'>,
): DesignMemoryRecord {
  return {
    projectId: 'proj_1',
    documentId: 'doc_1',
    scope: 'document',
    pinned: false,
    provenance: { sourceKind: 'user', sourceId: 'user_a' },
    createdAt: '2026-08-20T06:00:00.000Z',
    updatedAt: '2026-08-20T06:00:00.000Z',
    ownerUserId: 'user_a',
    ...input,
  };
}

function manifest(): ContextManifest {
  return {
    schemaVersion: 1,
    manifestId: 'man_1',
    runId: 'run_1',
    projectId: 'proj_1',
    documentId: 'doc_1',
    threadId: 'thr_1',
    actorId: 'user_a',
    documentRevision: 'rev_1',
    documentHash: HASH,
    modelPresetId: 'ui-standard',
    totalTokenBudget: 8000,
    estimatedTokens: 120,
    generatedAt: '2026-08-20T06:00:00.000Z',
    sections: [
      {
        name: 'live_document',
        tokenBudget: 4000,
        estimatedTokens: 80,
        sources: [
          {
            sourceId: 'doc_1',
            sourceKind: 'document',
            contentHash: HASH,
            visibility: 'shared',
            selectionReason: 'live_document',
            rank: 0,
            estimatedTokens: 80,
            content: {},
            truncated: false,
            citation: {
              sourceId: 'doc_1',
              sourceKind: 'document',
              contentHash: HASH,
              visibility: 'shared',
            },
          },
          {
            sourceId: 'thr_private',
            sourceKind: 'message',
            contentHash: HASH,
            visibility: 'private',
            selectionReason: 'recent_message',
            rank: 1,
            estimatedTokens: 40,
            content: { text: 'secret' },
            truncated: false,
            citation: {
              sourceId: 'thr_private',
              sourceKind: 'message',
              contentHash: HASH,
              visibility: 'private',
            },
          },
        ],
      },
    ],
  };
}
