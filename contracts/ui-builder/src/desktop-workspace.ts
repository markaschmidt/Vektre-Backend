import { z } from 'zod';
import {
  AgentRunStatusSchema,
  RunReviewRecordSchema,
  RunReviewRequestSchema,
  type AssistantTurn,
  type RunReviewRecord,
  type RunReviewRequest,
} from './agent.js';
import type { ContextManifest } from './context.js';
import { DEFAULT_DOCUMENT_LIMITS } from './validation.js';

export const UiAgentCapabilitiesSchema = z.object({
  schemaVersion: z.literal(1),
  yjsSchemaVersion: z.literal(2),
  documentContract: z.literal('VektreUIDocumentV2'),
  migrations: z.object({
    hudDocumentV1: z.boolean(),
  }),
  documentKinds: z.array(z.string()).min(1),
  componentKinds: z.array(z.string()).min(1),
  interactionEvents: z.array(z.string()).min(1),
  interactionActions: z.array(z.string()).min(1),
  platformProfiles: z.array(z.string()).min(1),
  spatialProfiles: z.array(z.string()).min(1),
  patchRoots: z.array(z.string()).min(1),
  intents: z.array(z.string()).min(1),
  limits: z.object({
    maxNodes: z.number().int().positive(),
    maxNestingDepth: z.number().int().positive(),
    maxTextLength: z.number().int().positive(),
    maxReferencesPerNode: z.number().int().positive(),
    maxPatchOperations: z.number().int().positive(),
  }),
  features: z.object({
    chat: z.boolean(),
    memory: z.boolean(),
    retrieval: z.boolean(),
    review: z.boolean(),
    telemetry: z.boolean(),
    multimodal: z.boolean(),
    privateThreads: z.boolean(),
    designMemoryPublish: z.boolean(),
  }),
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      tier: z.enum(['standard', 'premium']),
      capabilities: z.array(z.string()),
      supportsText: z.boolean(),
      supportsImages: z.boolean(),
      supportsStructuredOutput: z.boolean(),
      contextTokenLimit: z.number().int().positive(),
      outputTokenLimit: z.number().int().positive(),
      allowedDocumentKinds: z.array(z.string()),
      allowedIntents: z.array(z.string()),
      allowedVisibilities: z.array(z.enum(['shared', 'private'])),
    }),
  ),
});

export type UiAgentCapabilities = z.infer<typeof UiAgentCapabilitiesSchema>;

export interface DesktopFeatureFlags {
  nativeEditor: true;
  comments: true;
  collaboration: true;
  aiChat: boolean;
  memory: boolean;
  retrieval: boolean;
  review: boolean;
  telemetry: boolean;
  multimodal: boolean;
  privateThreads: boolean;
}

export interface CatchUpActivity {
  activityId: string;
  runId: string;
  status: string;
  reconciledAt?: string | null;
  applied?: boolean;
}

export type CatchUpAction =
  | 'apply_then_reconcile'
  | 'reconcile_only'
  | 'observe'
  | 'skip';

export interface CatchUpPlanItem {
  activityId: string;
  runId: string;
  action: CatchUpAction;
}

export type DesktopRunAction =
  | 'wait'
  | 'render_clarification'
  | 'render_match_review'
  | 'inspect_then_apply'
  | 'reconcile'
  | 'show_failure'
  | 'noop';

export function desktopFeatureFlags(input: {
  capabilitiesHttpStatus?: number;
  capabilities?: unknown;
}): DesktopFeatureFlags {
  const status = input.capabilitiesHttpStatus ?? 200;
  if (status === 404 || status === 0 || status >= 500) {
    return {
      nativeEditor: true,
      comments: true,
      collaboration: true,
      aiChat: false,
      memory: false,
      retrieval: false,
      review: false,
      telemetry: false,
      multimodal: false,
      privateThreads: false,
    };
  }
  const parsed = UiAgentCapabilitiesSchema.safeParse(input.capabilities);
  const features = parsed.success
    ? parsed.data.features
    : {
        chat: true,
        memory: true,
        retrieval: true,
        review: true,
        telemetry: true,
        multimodal: true,
        privateThreads: true,
      };
  return {
    nativeEditor: true,
    comments: true,
    collaboration: true,
    aiChat: features.chat,
    memory: features.memory,
    retrieval: features.retrieval,
    review: features.review,
    telemetry: features.telemetry,
    multimodal: features.multimodal,
    privateThreads: features.privateThreads,
  };
}

export function nextDesktopRunAction(input: {
  status: z.infer<typeof AgentRunStatusSchema> | string;
  alreadyApplied?: boolean;
  matchReviewPending?: boolean;
}): { action: DesktopRunAction; mutateYjs: boolean } {
  if (input.alreadyApplied) {
    return { action: 'reconcile', mutateYjs: false };
  }
  switch (input.status) {
    case 'awaiting_clarification':
      return { action: 'render_clarification', mutateYjs: false };
    case 'awaiting_review':
      return { action: 'render_match_review', mutateYjs: false };
    case 'matching':
      if (input.matchReviewPending) {
        return { action: 'render_match_review', mutateYjs: false };
      }
      return { action: 'wait', mutateYjs: false };
    case 'completed':
    case 'needs_rebase':
      return { action: 'inspect_then_apply', mutateYjs: true };
    case 'failed':
    case 'cancelled':
      return { action: 'show_failure', mutateYjs: false };
    default:
      return { action: 'wait', mutateYjs: false };
  }
}

/** Relative path of the backend review-decision endpoint for a run. */
export function uiAgentRunReviewPath(input: {
  projectId: string;
  documentId: string;
  runId: string;
}): string {
  const enc = encodeURIComponent;
  return `projects/${enc(input.projectId)}/documents/${enc(input.documentId)}/ui-agent/runs/${enc(input.runId)}/review`;
}

/** Validate/build the JSON body for the review-decision endpoint. */
export function buildRunReviewRequest(input: RunReviewRequest): RunReviewRequest {
  return RunReviewRequestSchema.parse(input);
}

/**
 * Re-attach a persisted review decision (the `review` field of a run
 * response, e.g. after an app restart) to its proposal turn. Without this,
 * a turn fetched fresh from the server still looks un-reviewed and
 * `applyAssistantTurn` blocks it with `blocked_review` even though the
 * run itself is already `completed`.
 */
export function withPersistedReviewDecision(
  turn: AssistantTurn,
  review: RunReviewRecord | unknown,
): AssistantTurn {
  const parsed = RunReviewRecordSchema.safeParse(review);
  if (!parsed.success || parsed.data.decision !== 'approve') return turn;
  const matchReview = turn.matchReview;
  if (!matchReview || matchReview.reviewDecision) return turn;
  const alternativeId =
    parsed.data.alternativeId ??
    matchReview.recommendedAlternativeId ??
    matchReview.alternatives[0]?.alternativeId;
  if (!alternativeId) return turn;
  return {
    ...turn,
    matchReview: {
      ...matchReview,
      reviewDecision: {
        alternativeId,
        actorId: parsed.data.actorId,
        decidedAt: parsed.data.decidedAt,
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      },
    },
  };
}

export function planReconnectCatchUp(
  activities: CatchUpActivity[],
): CatchUpPlanItem[] {
  return activities.map((activity) => {
    if (activity.reconciledAt) {
      return {
        activityId: activity.activityId,
        runId: activity.runId,
        action: 'skip',
      };
    }
    if (activity.status === 'completed' || activity.status === 'needs_rebase') {
      return {
        activityId: activity.activityId,
        runId: activity.runId,
        action: activity.applied ? 'reconcile_only' : 'apply_then_reconcile',
      };
    }
    if (
      activity.status === 'failed' ||
      activity.status === 'cancelled'
    ) {
      return {
        activityId: activity.activityId,
        runId: activity.runId,
        action: 'skip',
      };
    }
    return {
      activityId: activity.activityId,
      runId: activity.runId,
      action: 'observe',
    };
  });
}

export function interpretMutatingConflict(error: {
  status?: number;
  code?: string;
  activeRun?: { runId: string; requestId?: string; activityId?: string };
}): {
  showBusy: boolean;
  queueDuplicate: false;
  activeRunId?: string;
} {
  if (error.status === 409 || error.code === 'active_mutating_run') {
    return {
      showBusy: true,
      queueDuplicate: false,
      activeRunId: error.activeRun?.runId,
    };
  }
  return { showBusy: false, queueDuplicate: false };
}

export interface ContextInspectorView {
  documentRevision: string;
  documentHash: string;
  modelPresetId: string;
  cited: Array<{
    sourceKind: string;
    sourceId: string;
    selectionReason: string;
    estimatedTokens: number;
    visibility: string;
  }>;
  tokenAllocation: Array<{
    section: string;
    tokenBudget: number;
    estimatedTokens: number;
  }>;
  estimatedTokens: number;
  totalTokenBudget: number;
}

export function contextInspectorView(
  manifest: ContextManifest,
  input: { viewerUserId: string; runActorId: string; role?: string } = {
    viewerUserId: '',
    runActorId: '',
  },
): ContextInspectorView {
  const hidePrivate =
    input.viewerUserId !== '' && input.viewerUserId !== input.runActorId;
  return {
    documentRevision: manifest.documentRevision,
    documentHash: manifest.documentHash,
    modelPresetId: manifest.modelPresetId,
    cited: manifest.sections.flatMap((section) =>
      section.sources
        .filter((source) => !hidePrivate || source.visibility !== 'private')
        .map((source) => ({
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          selectionReason: source.selectionReason,
          estimatedTokens: source.estimatedTokens,
          visibility: source.visibility,
        })),
    ),
    tokenAllocation: manifest.sections.map((section) => ({
      section: section.name,
      tokenBudget: section.tokenBudget,
      estimatedTokens: section.estimatedTokens,
    })),
    estimatedTokens: manifest.estimatedTokens,
    totalTokenBudget: manifest.totalTokenBudget,
  };
}

export const DESKTOP_DEFAULT_LIMITS = DEFAULT_DOCUMENT_LIMITS;

export const UI_AGENT_MESSAGE_LIFECYCLE = [
  'persist_local_yjs',
  'compose_typed_parts',
  'append_thread',
  'observe_run',
  'inspect_result',
  'submit_review',
  'apply_once',
  'reconcile',
  'catch_up',
] as const;
