import type {
  AgentRun,
  AgentStep,
  ContextManifest,
  DesignMemoryRecord,
  JsonValue,
  MessagePart,
  SourceCitation,
} from '@markaschmidt/ui-builder-contracts';

export type UiVisibility = 'shared' | 'private';
export type UiThreadStatus = 'active' | 'archived' | 'deleted';

export interface UiAiThreadRow {
  threadId: string;
  threadOrder: number;
  projectId: string;
  documentId?: string;
  documentKey?: string;
  ownerUserId: string;
  title: string;
  visibility: UiVisibility;
  status: UiThreadStatus;
  publishedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UiAiMessageRow {
  messageId: string;
  messageOrder: number;
  threadId: string;
  projectId: string;
  documentId?: string;
  actorUserId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  visibility: UiVisibility;
  ownerUserId: string;
  parts: MessagePart[];
  citations: SourceCitation[];
  isSummary: boolean;
  summarySourceMessageIds: string[];
  createdAt: Date;
}

export interface UiDesignMemoryRow {
  memoryId: string;
  memoryOrder: number;
  projectId: string;
  documentId?: string;
  threadId?: string;
  ownerUserId: string;
  kind: DesignMemoryRecord['kind'];
  scope: DesignMemoryRecord['scope'];
  scopeId?: string;
  text: string;
  structuredValue?: JsonValue;
  status: DesignMemoryRecord['status'];
  visibility: UiVisibility;
  pinned: boolean;
  effectiveRevision?: string;
  reviewedByUserId?: string;
  reviewedAt?: Date;
  supersededByMemoryId?: string;
  provenance: DesignMemoryRecord['provenance'];
  createdAt: Date;
  updatedAt: Date;
}

export interface UiDocumentRevisionRow {
  revisionId: string;
  projectId: string;
  documentId: string;
  documentKey: string;
  documentHash: string;
  snapshotId?: string;
  stateVector?: string;
  structuralDigest: JsonValue;
  layoutFingerprints: JsonValue;
  sourceSnapshotCreatedAt?: Date;
  createdAt: Date;
}

export interface UiAiBaselineRow {
  documentKey: string;
  projectId: string;
  documentId: string;
  revisionId?: string;
  runId?: string;
  activityId?: string;
  documentHash: string;
  proposalHash?: string;
  reconciledAt: Date;
  updatedAt: Date;
}

export interface UiAgentRunRow {
  runId: string;
  requestId: string;
  activityId?: string;
  projectId: string;
  documentId: string;
  documentKey: string;
  threadId?: string;
  actorUserId: string;
  ownerUserId: string;
  visibility: UiVisibility;
  status: AgentRun['status'];
  intent: string;
  baseDocumentHash: string;
  frozenRevisionId?: string;
  contextManifestId?: string;
  messageId?: string;
  modelPresetId?: string;
  mutating: boolean;
  result?: JsonValue;
  proposalHash?: string;
  review?: JsonValue;
  errorCode?: string;
  errorMessage?: string;
  cancelRequestedAt?: Date;
  reconciledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface UiAgentStepRow {
  stepId: string;
  runId: string;
  projectId: string;
  stageExecutionId: string;
  stage: AgentStep['stage'];
  attempt: number;
  idempotencyKey: string;
  status: AgentStep['status'];
  inputRef?: string;
  outputRef?: string;
  usage?: JsonValue;
  errorCode?: string;
  errorMessage?: string;
  ownerUserId: string;
  visibility: UiVisibility;
  createdAt: Date;
  updatedAt: Date;
  workerStartedAt?: Date;
  completedAt?: Date;
}

export interface UiAgentStageArtifactRow {
  artifactId: string;
  runId: string;
  stepId?: string;
  projectId: string;
  documentId: string;
  ownerUserId: string;
  visibility: UiVisibility;
  artifactKind:
    | 'stage_input'
    | 'stage_output'
    | 'asset_result'
    | 'review'
    | 'conflict';
  contentHash: string;
  payload: JsonValue;
  createdAt: Date;
}

export interface UiAgentAssetRequestRow {
  requestId: string;
  runId: string;
  stepId: string;
  projectId: string;
  requestKey: string;
  assetRole: string;
  preferredAssetId: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  assetId?: string;
  errorMessage?: string;
}

export interface UiContextManifestRow {
  manifestId: string;
  runId: string;
  projectId: string;
  documentId: string;
  threadId?: string;
  actorUserId: string;
  ownerUserId: string;
  visibility: UiVisibility;
  manifest: ContextManifest;
  manifestHash: string;
  createdAt: Date;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface SanitizedContextManifest extends Omit<
  ContextManifest,
  'sections'
> {
  sections: Array<
    Omit<ContextManifest['sections'][number], 'sources'> & {
      sources: Array<
        Omit<ContextManifest['sections'][number]['sources'][number], 'content'>
      >;
    }
  >;
}

export function sanitizeContextManifest(
  manifest: ContextManifest,
): SanitizedContextManifest {
  return {
    ...manifest,
    sections: manifest.sections.map((section) => ({
      ...section,
      sources: section.sources.map(({ content, ...source }) => {
        void content;
        return source;
      }),
    })),
  };
}

export function toThreadResponse(row: UiAiThreadRow) {
  return {
    threadId: row.threadId,
    projectId: row.projectId,
    documentId: row.documentId,
    ownerUserId: row.ownerUserId,
    title: row.title,
    visibility: row.visibility,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessageResponse(row: UiAiMessageRow) {
  return {
    messageId: row.messageId,
    threadId: row.threadId,
    actorId: row.actorUserId,
    role: row.role,
    visibility: row.visibility,
    parts: row.parts,
    citations: row.citations,
    isSummary: row.isSummary,
    summarySourceMessageIds: row.summarySourceMessageIds,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMemoryResponse(row: UiDesignMemoryRow): DesignMemoryRecord {
  return {
    memoryId: row.memoryId,
    projectId: row.projectId,
    documentId: row.documentId,
    kind: row.kind,
    scope: row.scope,
    scopeId: row.scopeId,
    text: row.text,
    structuredValue: row.structuredValue,
    status: row.status,
    visibility: row.visibility,
    ownerUserId: row.ownerUserId,
    pinned: row.pinned,
    effectiveRevision: row.effectiveRevision,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString(),
    supersededByMemoryId: row.supersededByMemoryId,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toStepResponse(row: UiAgentStepRow) {
  return {
    stepId: row.stepId,
    stageExecutionId: row.stageExecutionId,
    stage: row.stage,
    attempt: row.attempt,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  };
}

export function toRunResponse(
  row: UiAgentRunRow,
  steps: UiAgentStepRow[] = [],
) {
  return {
    runId: row.runId,
    requestId: row.requestId,
    activityId: row.activityId,
    projectId: row.projectId,
    documentId: row.documentId,
    threadId: row.threadId,
    messageId: row.messageId,
    actorId: row.actorUserId,
    visibility: row.visibility,
    status: row.status,
    intent: row.intent,
    modelPresetId: row.modelPresetId,
    mutating: row.mutating,
    baseDocumentHash: row.baseDocumentHash,
    frozenRevisionId: row.frozenRevisionId,
    contextManifestId: row.contextManifestId,
    result: row.result,
    proposalHash: row.proposalHash,
    review: row.review,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    steps: steps.map(toStepResponse),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    reconciledAt: row.reconciledAt?.toISOString(),
  };
}
