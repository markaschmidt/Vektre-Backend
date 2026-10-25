import * as Y from 'yjs';
import type { AssistantTurn } from './agent.js';
import { canonicalSha256 } from './canonical-json.js';
import type { JsonValue } from './common.js';
import {
  VektreUIDocumentV2Schema,
  type VektreUIDocumentV2,
} from './document.js';
import { applyJsonPatch } from './json-patch.js';
import type { DocumentPatchProposal, PatchConflict } from './patches.js';
import { validateVektreUIDocument } from './validation.js';
import {
  isActivityApplied,
  isEmptyVektreUiDocument,
  markActivityApplied,
  readVektreUiDocument,
  writeVektreUiDocument,
} from './yjs-document.js';

export const LIVE_DOCUMENT_IS_AUTHORITATIVE = true;
export const RESET_TO_LAST_AI_GENERATION = false;

export type ApplyProposalStatus =
  | 'applied'
  | 'already_applied'
  | 'conflicts'
  | 'blocked_review'
  | 'rejected_full_document'
  | 'schema_invalid';

export interface ApplyProposalOptions {
  activityId: string;
  runId: string;
  appliedAt?: string;
  resolutions?: Record<string, NonNullable<PatchConflict['resolution']>>;
  manualValues?: Record<string, JsonValue>;
  /**
   * When the patch produced field-level conflicts, set this after the user
   * confirms human_wins / ai_wins / manual values. Until then the Yjs document
   * is not mutated.
   */
  commitConflicts?: boolean;
}

export interface ApplyProposalResult {
  status: ApplyProposalStatus;
  document: VektreUIDocumentV2;
  conflicts: PatchConflict[];
  mutated: boolean;
  appliedDocumentHash?: string;
  alreadyApplied?: boolean;
}

export function matchReviewBlocksApply(turn: AssistantTurn): boolean {
  return (
    turn.matchReview?.requiresReview === true &&
    turn.matchReview.reviewDecision === undefined
  );
}

export function applyAssistantTurn(
  live: VektreUIDocumentV2,
  turn: AssistantTurn,
  options: ApplyProposalOptions,
): ApplyProposalResult {
  if (matchReviewBlocksApply(turn)) {
    return {
      status: 'blocked_review',
      document: live,
      conflicts: [],
      mutated: false,
    };
  }
  const proposal = turn.documentProposal;
  if (!proposal) {
    return {
      status: 'applied',
      document: live,
      conflicts: [],
      mutated: false,
      appliedDocumentHash: canonicalSha256(live),
    };
  }
  if (proposal.type === 'full_document') {
    return applyFullDocument(live, proposal.document, options);
  }
  return applyPatchProposal(live, proposal.patch, options);
}

export function applyPatchProposal(
  live: VektreUIDocumentV2,
  patch: DocumentPatchProposal,
  options: ApplyProposalOptions,
): ApplyProposalResult {
  const patched = applyJsonPatch(live, patch.operations, {
    resolutions: options.resolutions,
    manualValues: options.manualValues,
  });
  const parsed = VektreUIDocumentV2Schema.safeParse(patched.document);
  if (!parsed.success) {
    return {
      status: 'schema_invalid',
      document: live,
      conflicts: [
        ...patched.conflicts,
        ...parsed.error.issues.map((issue) => ({
          path: `/${issue.path.map(String).join('/')}`,
          kind: 'schema_invalid' as const,
          message: issue.message,
          resolution: 'human_wins' as const,
        })),
      ],
      mutated: false,
    };
  }
  const semanticIssues = validateVektreUIDocument(parsed.data);
  if (semanticIssues.length > 0) {
    return {
      status: 'schema_invalid',
      document: live,
      conflicts: [
        ...patched.conflicts,
        ...semanticIssues.map((issue) => ({
          path: issue.path,
          kind: 'schema_invalid' as const,
          message: issue.message,
          resolution: 'human_wins' as const,
        })),
      ],
      mutated: false,
    };
  }
  const mutated = canonicalSha256(parsed.data) !== canonicalSha256(live);
  return {
    status: patched.conflicts.length > 0 ? 'conflicts' : 'applied',
    document: parsed.data,
    conflicts: patched.conflicts,
    mutated,
    appliedDocumentHash: canonicalSha256(parsed.data),
  };
}

export function applyFullDocument(
  live: VektreUIDocumentV2,
  proposed: VektreUIDocumentV2,
  _options: ApplyProposalOptions,
): ApplyProposalResult {
  if (!isEmptyVektreUiDocument(live)) {
    return {
      status: 'rejected_full_document',
      document: live,
      conflicts: [
        {
          path: '/components',
          kind: 'human_changed',
          liveValue: Object.keys(live.components),
          proposedValue: Object.keys(proposed.components),
          resolution: 'human_wins',
          message:
            'Existing documents receive RFC 6902 patches; a full document proposal is only applied to an empty document',
        },
      ],
      mutated: false,
    };
  }
  const parsed = VektreUIDocumentV2Schema.parse(proposed);
  return {
    status: 'applied',
    document: parsed,
    conflicts: [],
    mutated: true,
    appliedDocumentHash: canonicalSha256(parsed),
  };
}

/**
 * Apply an assistant turn onto a Yjs document in one transaction. If the
 * activity was already applied, skip mutation and report `already_applied` so
 * the desktop can still call idempotent reconcile.
 */
export function applyAssistantTurnToYjs(
  yDocument: Y.Doc,
  turn: AssistantTurn,
  options: ApplyProposalOptions,
): ApplyProposalResult {
  if (isActivityApplied(yDocument, options.activityId, options.runId)) {
    const document = readVektreUiDocument(yDocument);
    return {
      status: 'already_applied',
      document,
      conflicts: [],
      mutated: false,
      alreadyApplied: true,
      appliedDocumentHash: canonicalSha256(document),
    };
  }

  const live = readVektreUiDocument(yDocument);
  const result = applyAssistantTurn(live, turn, options);
  const canCommit =
    result.status === 'applied' ||
    (result.status === 'conflicts' && options.commitConflicts === true);
  if (
    !canCommit ||
    result.status === 'blocked_review' ||
    result.status === 'rejected_full_document' ||
    result.status === 'schema_invalid' ||
    !result.mutated
  ) {
    return result;
  }

  writeVektreUiDocument(yDocument, result.document);
  markActivityApplied(yDocument, {
    activityId: options.activityId,
    runId: options.runId,
    documentHash: result.appliedDocumentHash ?? canonicalSha256(result.document),
    appliedAt: options.appliedAt ?? new Date().toISOString(),
  });
  return result;
}

export function reconcileBody(result: ApplyProposalResult): {
  appliedDocumentHash: string;
  appliedRevisionId?: string;
} {
  return {
    appliedDocumentHash:
      result.appliedDocumentHash ?? canonicalSha256(result.document),
  };
}
