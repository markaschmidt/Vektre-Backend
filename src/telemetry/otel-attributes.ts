/**
 * Pinned UI-agent telemetry attribute names.
 *
 * OpenTelemetry GenAI conventions may evolve; product code uses the
 * `vektre.gen_ai.*` mapping below and mirrors stable `gen_ai.*` keys when
 * exporting. Identifiers belong in attributes, never in span names.
 */

export const TRACE_SPAN_NAMES = {
  httpServer: 'http.server',
  httpClient: 'http.client',
  bullmqProcess: 'bullmq.process',
  uiAgentTransition: 'ui_agent.transition',
  uiAgentStage: 'ui_agent.stage',
  uiAgentAssetResume: 'ui_agent.asset_resume',
  uiAgentReconcile: 'ui_agent.reconcile',
  generativeJob: 'generative_model.job',
  contextIndex: 'ui_context.index',
} as const;

export const TRACE_ATTR = {
  projectId: 'vektre.project_id',
  documentId: 'vektre.document_id',
  threadId: 'vektre.thread_id',
  runId: 'vektre.run_id',
  requestId: 'vektre.request_id',
  activityId: 'vektre.activity_id',
  stageExecutionId: 'vektre.stage_execution_id',
  schemaVersion: 'vektre.schema_version',
  promptVersion: 'vektre.prompt_version',
  contextVersion: 'vektre.context_manifest_version',
  documentKind: 'vektre.document_kind',
  modelPresetId: 'vektre.model_preset_id',
  visibility: 'vektre.visibility',
  httpMethod: 'http.request.method',
  httpRoute: 'http.route',
  httpStatus: 'http.response.status_code',
  jobName: 'messaging.destination.name',
  provider: 'vektre.gen_ai.provider',
  requestModel: 'vektre.gen_ai.request.model',
  responseModel: 'vektre.gen_ai.response.model',
  inputTokens: 'vektre.gen_ai.usage.input_tokens',
  cachedInputTokens: 'vektre.gen_ai.usage.cached_input_tokens',
  imageInputTokens: 'vektre.gen_ai.usage.image_input_tokens',
  outputTokens: 'vektre.gen_ai.usage.output_tokens',
  reasoningTokens: 'vektre.gen_ai.usage.reasoning_tokens',
  finishReason: 'vektre.gen_ai.response.finish_reason',
  latencyMs: 'vektre.gen_ai.latency_ms',
  retryCount: 'vektre.gen_ai.retry_count',
  repairAttempts: 'vektre.gen_ai.repair_attempts',
  otelProvider: 'gen_ai.provider.name',
  otelRequestModel: 'gen_ai.request.model',
  otelResponseModel: 'gen_ai.response.model',
  otelInputTokens: 'gen_ai.usage.input_tokens',
  otelOutputTokens: 'gen_ai.usage.output_tokens',
} as const;

export type TraceAttributes = Record<string, string | number | boolean>;

export function correlationAttributes(input: {
  projectId?: string;
  documentId?: string;
  threadId?: string;
  runId?: string;
  requestId?: string;
  activityId?: string;
  stageExecutionId?: string;
  schemaVersion?: string;
  promptVersion?: string;
  contextVersion?: string;
  documentKind?: string;
  modelPresetId?: string;
  visibility?: string;
}): TraceAttributes {
  const attributes: TraceAttributes = {};
  set(attributes, TRACE_ATTR.projectId, input.projectId);
  set(attributes, TRACE_ATTR.documentId, input.documentId);
  set(attributes, TRACE_ATTR.threadId, input.threadId);
  set(attributes, TRACE_ATTR.runId, input.runId);
  set(attributes, TRACE_ATTR.requestId, input.requestId);
  set(attributes, TRACE_ATTR.activityId, input.activityId);
  set(attributes, TRACE_ATTR.stageExecutionId, input.stageExecutionId);
  set(attributes, TRACE_ATTR.schemaVersion, input.schemaVersion);
  set(attributes, TRACE_ATTR.promptVersion, input.promptVersion);
  set(attributes, TRACE_ATTR.contextVersion, input.contextVersion);
  set(attributes, TRACE_ATTR.documentKind, input.documentKind);
  set(attributes, TRACE_ATTR.modelPresetId, input.modelPresetId);
  set(attributes, TRACE_ATTR.visibility, input.visibility);
  return attributes;
}

export function genAiAttributes(input: {
  provider?: string;
  requestedModel?: string;
  actualModel?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  imageInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
  latencyMs?: number;
  retryCount?: number;
  repairAttempts?: number;
}): TraceAttributes {
  const attributes: TraceAttributes = {};
  set(attributes, TRACE_ATTR.provider, input.provider);
  set(attributes, TRACE_ATTR.otelProvider, input.provider);
  set(attributes, TRACE_ATTR.requestModel, input.requestedModel);
  set(attributes, TRACE_ATTR.otelRequestModel, input.requestedModel);
  set(attributes, TRACE_ATTR.responseModel, input.actualModel);
  set(attributes, TRACE_ATTR.otelResponseModel, input.actualModel);
  setNumber(attributes, TRACE_ATTR.inputTokens, input.inputTokens);
  setNumber(attributes, TRACE_ATTR.otelInputTokens, input.inputTokens);
  setNumber(attributes, TRACE_ATTR.cachedInputTokens, input.cachedInputTokens);
  setNumber(attributes, TRACE_ATTR.imageInputTokens, input.imageInputTokens);
  setNumber(attributes, TRACE_ATTR.outputTokens, input.outputTokens);
  setNumber(attributes, TRACE_ATTR.otelOutputTokens, input.outputTokens);
  setNumber(attributes, TRACE_ATTR.reasoningTokens, input.reasoningTokens);
  set(attributes, TRACE_ATTR.finishReason, input.finishReason);
  setNumber(attributes, TRACE_ATTR.latencyMs, input.latencyMs);
  setNumber(attributes, TRACE_ATTR.retryCount, input.retryCount);
  setNumber(attributes, TRACE_ATTR.repairAttempts, input.repairAttempts);
  return attributes;
}

function set(
  attributes: TraceAttributes,
  key: string,
  value: string | undefined,
): void {
  if (value) attributes[key] = value;
}

function setNumber(
  attributes: TraceAttributes,
  key: string,
  value: number | undefined,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    attributes[key] = value;
  }
}
