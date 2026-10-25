import {
  AssistantTurnSchema,
  RunReviewRequestSchema,
  buildRunReviewRequest,
  matchReviewBlocksApply,
  uiAgentRunReviewPath,
  withPersistedReviewDecision,
  type AssistantTurn,
} from '../src/index';

const turn: AssistantTurn = AssistantTurnSchema.parse({
  schemaVersion: 1,
  text: 'Proposal ready',
  citations: [],
  memoryProposals: [],
  assetPlan: [],
  validationIssues: [],
  conflicts: [],
  matchReview: {
    matchSetId: 'matchset-1',
    alternatives: [
      {
        alternativeId: 'alt-1',
        candidates: [
          {
            candidateId: 'cand-1',
            functionalNodeId: 'health_bar',
            visualNodeId: 'resource_bar',
            score: 0.9,
            scoreBreakdown: {},
          },
        ],
        totalScore: 0.9,
        feasible: true,
      },
    ],
    recommendedAlternativeId: 'alt-1',
    requiresReview: true,
  },
});

describe('run review decision contract', () => {
  it('builds the backend review path and validated request body', () => {
    expect(
      uiAgentRunReviewPath({
        projectId: 'proj 1',
        documentId: 'doc/1',
        runId: 'uirun_1',
      }),
    ).toBe('projects/proj%201/documents/doc%2F1/ui-agent/runs/uirun_1/review');
    expect(
      buildRunReviewRequest({ decision: 'approve', alternativeId: 'alt-1' }),
    ).toEqual({ decision: 'approve', alternativeId: 'alt-1' });
    expect(() =>
      RunReviewRequestSchema.parse({ decision: 'maybe' }),
    ).toThrow();
  });

  it('blocks apply while un-reviewed, then unblocks from the persisted record', () => {
    expect(matchReviewBlocksApply(turn)).toBe(true);

    // What the desktop gets back from GET runs/:runId after a restart:
    // the proposal in `result`, the decision in `review`.
    const restored = withPersistedReviewDecision(turn, {
      decision: 'approve',
      alternativeId: 'alt-1',
      actorId: 'user-1',
      decidedAt: '2026-10-25T18:00:00.000Z',
    });
    expect(matchReviewBlocksApply(restored)).toBe(false);
    expect(restored.matchReview?.reviewDecision?.alternativeId).toBe('alt-1');
  });

  it('does not unblock apply for reject or request_changes', () => {
    for (const decision of ['reject', 'request_changes'] as const) {
      const restored = withPersistedReviewDecision(turn, {
        decision,
        actorId: 'user-1',
        decidedAt: '2026-10-25T18:00:00.000Z',
      });
      expect(matchReviewBlocksApply(restored)).toBe(true);
    }
  });

  it('falls back to the recommended alternative when none was recorded', () => {
    const restored = withPersistedReviewDecision(turn, {
      decision: 'approve',
      actorId: 'user-1',
      decidedAt: '2026-10-25T18:00:00.000Z',
    });
    expect(restored.matchReview?.reviewDecision?.alternativeId).toBe('alt-1');
  });
});
