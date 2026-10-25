import { z } from 'zod';
import {
  DocumentKindSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  OpaqueIdSchema,
  Sha256Schema,
  VisibilitySchema,
} from './common.js';
import {
  AgentStageSchema,
  AgentStepStatusSchema,
  NormalizedModelUsageSchema,
} from './agent.js';

export const ModelInvocationTelemetrySchema = z.strictObject({
  invocationId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  documentId: OpaqueIdSchema,
  threadId: OpaqueIdSchema,
  runId: OpaqueIdSchema,
  stageExecutionId: OpaqueIdSchema,
  stage: AgentStageSchema,
  actorId: OpaqueIdSchema,
  gateway: z.enum(['openai', 'openrouter', 'other']),
  requestedModel: z.string().min(1).max(256),
  actualModel: z.string().min(1).max(256),
  promptVersion: z.string().min(1).max(128),
  schemaVersion: z.string().min(1).max(128),
  contextManifestVersion: z.string().min(1).max(128),
  usage: NormalizedModelUsageSchema,
  estimatedCostUsd: z.number().finite().nonnegative().optional(),
  priceTableVersion: z.string().min(1).max(128).optional(),
  latencyMs: z.number().int().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  repairAttempts: z.number().int().nonnegative().max(2),
  outcome: AgentStepStatusSchema,
  errorCategory: z.string().min(1).max(128).optional(),
  createdAt: IsoDateTimeSchema,
  modelPresetId: z.string().min(1).max(128).optional(),
  finishReason: z.string().min(1).max(128).optional(),
  imageCount: z.number().int().nonnegative().optional(),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  traceId: z.string().min(1).max(64).optional(),
  spanId: z.string().min(1).max(32).optional(),
});

export type ModelInvocationTelemetry = z.infer<
  typeof ModelInvocationTelemetrySchema
>;

export const UiAgentQualityMetricKindSchema = z.enum([
  'first_pass_valid',
  'repair_attempts',
  'repair_success',
  'untouched_field_preservation',
  'stale_rebase',
  'field_conflict',
  'human_accept',
  'human_reject',
  'human_request_changes',
  'edit_distance',
  'undo_after_apply',
  'comment_resolution',
  'memory_acceptance',
  'solver_feasible',
  'solver_confidence',
  'review_required',
  'cost_usd_completed',
  'cost_usd_accepted',
  'latency_ms_completed',
  'tokens_completed',
]);

export const UiAgentQualityEventSchema = z.strictObject({
  eventId: OpaqueIdSchema,
  projectId: OpaqueIdSchema,
  documentId: OpaqueIdSchema,
  runId: OpaqueIdSchema.optional(),
  threadId: OpaqueIdSchema.optional(),
  visibility: VisibilitySchema,
  metricKind: UiAgentQualityMetricKindSchema,
  metricValue: z.number().finite(),
  documentKind: DocumentKindSchema.optional(),
  modelPresetId: z.string().min(1).max(128).optional(),
  promptVersion: z.string().min(1).max(128).optional(),
  schemaVersion: z.string().min(1).max(128).optional(),
  dimensions: JsonObjectSchema.optional(),
  createdAt: IsoDateTimeSchema,
});

export type UiAgentQualityEvent = z.infer<typeof UiAgentQualityEventSchema>;
export type UiAgentQualityMetricKind = z.infer<
  typeof UiAgentQualityMetricKindSchema
>;

export const EvalDatasetKindSchema = z.enum([
  'contract',
  'patch_preservation',
  'solver',
  'model_quality',
  'vlm_review',
]);

export const EvalDatasetCaseSchema = z.strictObject({
  datasetId: z.string().min(1).max(128),
  caseId: z.string().min(1).max(128),
  version: z.string().min(1).max(64),
  kind: EvalDatasetKindSchema,
  blocking: z.boolean(),
  documentKind: DocumentKindSchema,
  theme: z.string().min(1).max(128),
  fixtureName: z.string().min(1).max(256).optional(),
  fixtureHash: Sha256Schema.optional(),
  promptVersion: z.string().min(1).max(128).optional(),
  schemaVersion: z.string().min(1).max(128).optional(),
  contextVersion: z.string().min(1).max(128).optional(),
  modelPresetId: z.string().min(1).max(128).optional(),
  seed: z.number().int().optional(),
  expected: JsonObjectSchema,
});

export type EvalDatasetCase = z.infer<typeof EvalDatasetCaseSchema>;
