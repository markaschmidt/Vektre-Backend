import { readFileSync } from 'node:fs';
import {
  applyAssistantTurn,
  applyAssistantTurnToYjs,
  applyJsonPatch,
  applyPatchProposal,
  matchReviewBlocksApply,
  reconcileBody,
  RESET_TO_LAST_AI_GENERATION,
  type AssistantTurn,
  type DocumentPatchProposal,
  type VektreUIDocumentV2,
  VektreUIDocumentV2Schema,
  isActivityApplied,
  nextDesktopRunAction,
  planReconnectCatchUp,
  readVektreUiDocument,
  writeVektreUiDocument,
} from '@markaschmidt/ui-builder-contracts';
import * as Y from 'yjs';

const HASH = 'a'.repeat(64);

describe('proposal apply, conflicts, match review, reconcile', () => {
  it('never offers reset-to-last-AI-generation recovery', () => {
    expect(RESET_TO_LAST_AI_GENERATION).toBe(false);
  });

  it('applies RFC 6902 patches and keeps human values when tests fail', () => {
    const live = fixture();
    live.components.player_health.zIndex = 21;
    const result = applyJsonPatch(live, [
      {
        op: 'test',
        path: '/components/player_health/zIndex',
        value: 20,
      },
      {
        op: 'replace',
        path: '/components/player_health/zIndex',
        value: 99,
      },
      {
        op: 'replace',
        path: '/components/player_health/name',
        value: 'Renamed Health',
      },
    ]);
    const document = result.document as VektreUIDocumentV2;
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/components/player_health/zIndex',
          kind: 'test_failed',
          resolution: 'human_wins',
        }),
      ]),
    );
    expect(document.components.player_health.zIndex).toBe(21);
    expect(document.components.player_health.name).toBe('Renamed Health');
  });

  it('overwrites a conflicted field only after explicit ai_wins', () => {
    const live = fixture();
    live.components.player_health.zIndex = 21;
    const result = applyPatchProposal(live, proposal(), {
      activityId: 'act_1',
      runId: 'run_1',
      resolutions: { '/components/player_health/zIndex': 'ai_wins' },
    });
    expect(result.document.components.player_health.zIndex).toBe(99);
    expect(result.conflicts[0]?.resolution).toBe('ai_wins');
  });

  it('blocks Yjs mutation while match review is pending', () => {
    const turn = assistantTurn({
      matchReview: {
        matchSetId: 'match_1',
        alternatives: [
          {
            alternativeId: 'alt_1',
            candidates: [
              {
                candidateId: 'cand_1',
                functionalNodeId: 'player_health',
                visualNodeId: 'bar_a',
                score: 0.9,
                scoreBreakdown: { layout: 0.9 },
              },
            ],
            totalScore: 0.9,
            feasible: true,
          },
        ],
        requiresReview: true,
      },
    });
    expect(matchReviewBlocksApply(turn)).toBe(true);
    const result = applyAssistantTurn(fixture(), turn, {
      activityId: 'act_1',
      runId: 'run_1',
    });
    expect(result.status).toBe('blocked_review');
    expect(result.mutated).toBe(false);
  });

  it('applies a completed activity once and reconciles duplicates without cloning nodes', () => {
    const yDocument = new Y.Doc();
    writeVektreUiDocument(yDocument, fixture());
    const turn = assistantTurn();
    const first = applyAssistantTurnToYjs(yDocument, turn, {
      activityId: 'act_1',
      runId: 'run_1',
      appliedAt: '2026-08-20T06:00:00.000Z',
    });
    expect(first.status).toBe('applied');
    expect(first.mutated).toBe(true);
    expect(isActivityApplied(yDocument, 'act_1', 'run_1')).toBe(true);

    const second = applyAssistantTurnToYjs(yDocument, turn, {
      activityId: 'act_1',
      runId: 'run_1',
    });
    expect(second.status).toBe('already_applied');
    expect(second.mutated).toBe(false);
    const live = readVektreUiDocument(yDocument);
    expect(Object.keys(live.components)).toEqual(['player_health']);
    expect(reconcileBody(second).appliedDocumentHash).toHaveLength(64);
  });

  it('does not write Yjs for field conflicts until the user commits resolutions', () => {
    const yDocument = new Y.Doc();
    const live = fixture();
    live.components.player_health.zIndex = 21;
    writeVektreUiDocument(yDocument, live);
    const turn = assistantTurn({
      documentProposal: { type: 'patch', patch: conflictProposal() },
    });
    const preview = applyAssistantTurnToYjs(yDocument, turn, {
      activityId: 'act_conflict',
      runId: 'run_conflict',
    });
    expect(preview.status).toBe('conflicts');
    expect(isActivityApplied(yDocument, 'act_conflict')).toBe(false);
    expect(readVektreUiDocument(yDocument).components.player_health.zIndex).toBe(
      21,
    );
    expect(readVektreUiDocument(yDocument).components.player_health.name).toBe(
      'Player Health',
    );

    const committed = applyAssistantTurnToYjs(yDocument, turn, {
      activityId: 'act_conflict',
      runId: 'run_conflict',
      commitConflicts: true,
      appliedAt: '2026-08-20T06:00:00.000Z',
    });
    expect(committed.status).toBe('conflicts');
    expect(committed.mutated).toBe(true);
    expect(isActivityApplied(yDocument, 'act_conflict', 'run_conflict')).toBe(
      true,
    );
    expect(readVektreUiDocument(yDocument).components.player_health.zIndex).toBe(
      21,
    );
    expect(readVektreUiDocument(yDocument).components.player_health.name).toBe(
      'Renamed Health',
    );
  });

  it('rejects a full document proposal against an existing tree', () => {
    const result = applyAssistantTurn(
      fixture(),
      {
        schemaVersion: 1,
        text: 'replace everything',
        citations: [],
        memoryProposals: [],
        assetPlan: [],
        validationIssues: [],
        conflicts: [],
        documentProposal: { type: 'full_document', document: fixture() },
      },
      { activityId: 'act_1', runId: 'run_1' },
    );
    expect(result.status).toBe('rejected_full_document');
    expect(result.mutated).toBe(false);
  });

  it('plans reconnect catch-up to apply unreconciled activity exactly once', () => {
    expect(
      planReconnectCatchUp([
        {
          activityId: 'act_done',
          runId: 'run_done',
          status: 'completed',
          applied: true,
          reconciledAt: '2026-08-20T06:00:00.000Z',
        },
        {
          activityId: 'act_unreconciled',
          runId: 'run_unreconciled',
          status: 'completed',
          applied: true,
        },
        {
          activityId: 'act_pending_apply',
          runId: 'run_pending',
          status: 'completed',
          applied: false,
        },
      ]),
    ).toEqual([
      expect.objectContaining({ action: 'skip' }),
      expect.objectContaining({
        activityId: 'act_unreconciled',
        action: 'reconcile_only',
      }),
      expect.objectContaining({
        activityId: 'act_pending_apply',
        action: 'apply_then_reconcile',
      }),
    ]);
    expect(
      nextDesktopRunAction({ status: 'completed', alreadyApplied: true }),
    ).toEqual({ action: 'reconcile', mutateYjs: false });
    expect(nextDesktopRunAction({ status: 'failed' })).toEqual({
      action: 'show_failure',
      mutateYjs: false,
    });
    expect(nextDesktopRunAction({ status: 'awaiting_review' })).toEqual({
      action: 'render_match_review',
      mutateYjs: false,
    });
    expect(nextDesktopRunAction({ status: 'understanding' })).toEqual({
      action: 'wait',
      mutateYjs: false,
    });
    expect(
      nextDesktopRunAction({
        status: 'awaiting_review',
        matchReviewPending: true,
      }),
    ).toEqual({ action: 'render_match_review', mutateYjs: false });
  });
});

function fixture(): VektreUIDocumentV2 {
  return structuredClone(
    VektreUIDocumentV2Schema.parse(
      JSON.parse(
        readFileSync('contracts/ui-builder/fixtures/combat-hud.json', 'utf8'),
      ),
    ),
  );
}

function proposal(): DocumentPatchProposal {
  return {
    schemaVersion: 1,
    proposalId: 'prop_1',
    runId: 'run_1',
    activityId: 'act_1',
    baseDocumentHash: HASH,
    baseRevision: 'rev_1',
    intent: 'edit',
    targetedIds: ['player_health'],
    targetedPaths: ['/components/player_health/zIndex'],
    operations: [
      {
        op: 'test',
        path: '/components/player_health/zIndex',
        value: 20,
      },
      {
        op: 'replace',
        path: '/components/player_health/zIndex',
        value: 99,
      },
    ],
    generatedAssetIds: [],
    intentionallyPreservedPaths: [],
    conflicts: [],
  };
}

function conflictProposal(): DocumentPatchProposal {
  return {
    ...proposal(),
    proposalId: 'prop_conflict',
    targetedPaths: [
      '/components/player_health/zIndex',
      '/components/player_health/name',
    ],
    operations: [
      {
        op: 'test',
        path: '/components/player_health/zIndex',
        value: 20,
      },
      {
        op: 'replace',
        path: '/components/player_health/zIndex',
        value: 99,
      },
      {
        op: 'replace',
        path: '/components/player_health/name',
        value: 'Renamed Health',
      },
    ],
  };
}

function assistantTurn(
  overrides: Partial<AssistantTurn> = {},
): AssistantTurn {
  return {
    schemaVersion: 1,
    text: 'Rename the health bar',
    citations: [],
    memoryProposals: [],
    assetPlan: [],
    validationIssues: [],
    conflicts: [],
    documentProposal: { type: 'patch', patch: proposal() },
    ...overrides,
  };
}
