import { z } from 'zod';
import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  JsonValueSchema,
  OpaqueIdSchema,
  SemanticIdSchema,
  Sha256Schema,
} from './common.js';
import { ContextManifestSchema } from './context.js';
import { VektreUIDocumentV2Schema } from './document.js';
import { DesignMemoryProposalSchema } from './memory.js';
import { SourceCitationSchema } from './messages.js';
import { DocumentPatchProposalSchema, PatchConflictSchema } from './patches.js';

export const AgentRunStatusSchema = z.enum([
  'created',
  'awaiting_context',
  'understanding',
  'awaiting_clarification',
  'planning',
  'generating_ux_visual',
  'awaiting_assets',
  'matching',
  'composing',
  'validating',
  'awaiting_review',
  'needs_rebase',
  'completed',
  'failed',
  'cancelled',
]);

export const AgentStageSchema = z.enum([
  'understand',
  'propose_ux',
  'propose_visual',
  'analyze_references',
  'plan_patch',
  'match_compose',
  'critique_validate',
]);

export const AgentStepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const AgentRunSchema = z.strictObject({
  runId: OpaqueIdSchema,
  requestId: OpaqueIdSchema,
  activityId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  documentId: OpaqueIdSchema,
  threadId: OpaqueIdSchema,
  actorId: OpaqueIdSchema,
  status: AgentRunStatusSchema,
  intent: z.string().min(1).max(4096),
  baseDocumentHash: Sha256Schema,
  contextManifestId: OpaqueIdSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const AgentStepSchema = z.strictObject({
  stepId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  stageExecutionId: OpaqueIdSchema,
  stage: AgentStageSchema,
  attempt: z.number().int().positive(),
  status: AgentStepStatusSchema,
  inputRef: OpaqueIdSchema.optional(),
  outputRef: OpaqueIdSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const AgentStageRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  promptVersion: z.string().min(1).max(128),
  contextVersion: z.string().min(1).max(128),
  stageExecutionId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  stage: AgentStageSchema,
  modelPresetId: OpaqueIdSchema,
  contextManifest: ContextManifestSchema,
  currentUISlice: JsonValueSchema,
  priorStageArtifacts: z.array(JsonValueSchema).max(64),
  imageReferences: z
    .array(
      z.strictObject({
        assetId: OpaqueIdSchema,
        url: z.string().url(),
        contentHash: Sha256Schema.optional(),
      }),
    )
    .max(32),
});

export const NormalizedModelUsageSchema = z.strictObject({
  provider: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  providerRequestId: z.string().min(1).max(512).optional(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  imageInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  providerCostUsd: z.number().finite().nonnegative().optional(),
});

export const AgentStageResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stageExecutionId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  stage: AgentStageSchema,
  result: JsonValueSchema,
  citations: z.array(SourceCitationSchema).max(256),
  warnings: z.array(z.string().max(2048)).max(128),
  repairAttempts: z.number().int().nonnegative().max(2),
  usage: NormalizedModelUsageSchema.optional(),
});

export const ValidationIssueSchema = z.strictObject({
  code: z.string().min(1).max(128),
  severity: z.enum(['info', 'warning', 'error']),
  path: z.string().max(2048).optional(),
  message: z.string().min(1).max(2048),
  relatedIds: z.array(SemanticIdSchema).max(128),
});

export const MatchCandidateSchema = z.strictObject({
  candidateId: OpaqueIdSchema,
  functionalNodeId: SemanticIdSchema,
  visualNodeId: SemanticIdSchema,
  score: z.number().finite(),
  scoreBreakdown: z.record(z.string(), z.number().finite()),
  explanation: z.string().max(2048).optional(),
});

export const SolverNodeSchema = z.strictObject({
  id: SemanticIdSchema,
  groupId: SemanticIdSchema.optional(),
  required: z.boolean(),
  attributes: JsonObjectSchema,
});

export const SolverCandidateEdgeSchema = z.strictObject({
  functionalNodeId: SemanticIdSchema,
  visualNodeId: SemanticIdSchema,
  score: z.number().finite(),
  scoreBreakdown: z.record(z.string(), z.number().finite()),
  compatible: z.boolean(),
});

export const SolverInputSchema = z.strictObject({
  solverVersion: z.string().min(1).max(128),
  functionalNodes: z.array(SolverNodeSchema).min(1).max(10000),
  visualNodes: z.array(SolverNodeSchema).min(1).max(10000),
  candidates: z.array(SolverCandidateEdgeSchema).max(100000),
  constraints: z.array(JsonObjectSchema).max(10000),
});

export const SolverResultSchema = z.strictObject({
  solverVersion: z.string().min(1).max(128),
  status: z.enum(['optimal', 'feasible', 'infeasible', 'error']),
  assignments: z.array(MatchCandidateSchema).max(10000),
  objectiveValue: z.number().finite().optional(),
  diagnostics: z.array(z.string().max(2048)).max(256),
});

export const MatchAlternativeSchema = z.strictObject({
  alternativeId: OpaqueIdSchema,
  candidates: z.array(MatchCandidateSchema).min(1).max(4096),
  totalScore: z.number().finite(),
  feasible: z.boolean(),
});

export const MatchReviewDecisionSchema = z.strictObject({
  alternativeId: OpaqueIdSchema,
  actorId: OpaqueIdSchema,
  decidedAt: IsoDateTimeSchema,
  notes: z.string().max(2048).optional(),
});

export const MatchReviewSetSchema = z.strictObject({
  matchSetId: OpaqueIdSchema,
  alternatives: z.array(MatchAlternativeSchema).min(1).max(64),
  recommendedAlternativeId: OpaqueIdSchema.optional(),
  requiresReview: z.boolean(),
  reviewDecision: MatchReviewDecisionSchema.optional(),
});

/** Decision a user submits for a run paused in `awaiting_review`. */
export const RunReviewDecisionSchema = z.enum([
  'approve',
  'reject',
  'request_changes',
]);

/**
 * Body for `POST /projects/:projectId/documents/:documentId/ui-agent/runs/:runId/review`.
 * The decision is persisted on the run server-side; it is not local UI state.
 */
export const RunReviewRequestSchema = z.strictObject({
  decision: RunReviewDecisionSchema,
  alternativeId: z.string().min(1).max(256).optional(),
  notes: z.string().max(2048).optional(),
});

/** The persisted review record returned as `review` on the run response. */
export const RunReviewRecordSchema = z.strictObject({
  decision: RunReviewDecisionSchema,
  alternativeId: z.string().min(1).max(256).optional(),
  notes: z.string().max(2048).optional(),
  actorId: OpaqueIdSchema,
  decidedAt: IsoDateTimeSchema,
});

export const AssetPlanItemSchema = z.strictObject({
  requestKey: SemanticIdSchema,
  role: z.enum([
    'icon',
    'frame',
    'background',
    'mask',
    'texture',
    'illustration',
  ]),
  prompt: z.string().min(1).max(10000),
  targetIds: z.array(SemanticIdSchema).min(1).max(128),
  constraints: JsonObjectSchema,
});

export const AssistantTurnSchema = z.strictObject({
  schemaVersion: z.literal(1),
  text: z.string().max(50000),
  clarifyingQuestion: z.string().min(1).max(4096).optional(),
  citations: z.array(SourceCitationSchema).max(256),
  memoryProposals: z.array(DesignMemoryProposalSchema).max(128),
  assetPlan: z.array(AssetPlanItemSchema).max(128),
  documentProposal: z
    .discriminatedUnion('type', [
      z.strictObject({
        type: z.literal('full_document'),
        document: VektreUIDocumentV2Schema,
      }),
      z.strictObject({
        type: z.literal('patch'),
        patch: DocumentPatchProposalSchema,
      }),
    ])
    .optional(),
  matchReview: MatchReviewSetSchema.optional(),
  validationIssues: z.array(ValidationIssueSchema).max(4096),
  conflicts: z.array(PatchConflictSchema).max(4096),
});

export type MatchReviewDecision = z.infer<typeof MatchReviewDecisionSchema>;
export type RunReviewDecision = z.infer<typeof RunReviewDecisionSchema>;
export type RunReviewRequest = z.infer<typeof RunReviewRequestSchema>;
export type RunReviewRecord = z.infer<typeof RunReviewRecordSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentStep = z.infer<typeof AgentStepSchema>;
export type AgentStageRequest = z.infer<typeof AgentStageRequestSchema>;
export type AgentStageResult = z.infer<typeof AgentStageResultSchema>;
export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
