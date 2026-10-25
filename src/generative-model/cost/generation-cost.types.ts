/**
 * Provider metering + estimated USD cost for generative requests.
 *
 * Research (2026):
 * - OpenAI Images API: returns `usage` token counts (text/image input + image
 *   output). No dollar `cost` field — multiply by configured $/1M rates.
 * - Replicate predictions: returns `metrics.predict_time` / `total_time`
 *   (seconds). No dollar field and usually no hardware SKU — estimate with
 *   configured model $/sec rates (or a default GPU rate).
 */

export type GenerationCostProvider =
  | 'openai'
  | 'openrouter'
  | 'replicate'
  | 'local';

export type GenerationCostSurface =
  | 'storyboard'
  | 'foundry'
  | 'canvas'
  | 'gui_screen'
  | 'direct'
  | 'unknown';

export interface OpenAiImageUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokensDetails?: {
    textTokens?: number;
    imageTokens?: number;
  };
  raw?: Record<string, unknown>;
}

export interface ReplicateUsage {
  predictTimeSeconds?: number;
  totalTimeSeconds?: number;
  predictionId?: string;
  raw?: Record<string, unknown>;
}

export interface GenerationUsagePayload {
  openai?: OpenAiImageUsage;
  text?: {
    inputTokens: number;
    cachedInputTokens?: number;
    imageInputTokens?: number;
    outputTokens: number;
    reasoningTokens?: number;
    providerCostUsd?: number;
  };
  replicate?: ReplicateUsage;
  notes?: string;
}

export interface RecordGenerationUsageInput {
  requestId: string;
  projectId: string;
  actorUserId: string;
  provider: GenerationCostProvider;
  modelId?: string;
  surface: GenerationCostSurface;
  actionKind?: string;
  requestType: string;
  usage: GenerationUsagePayload;
  /** When false, estimatedCostUsd is forced to 0 (legacy / excluded). */
  billable?: boolean;
  /** Override estimator (e.g. tests). */
  estimatedCostUsd?: number;
  documentId?: string;
  threadId?: string;
  runId?: string;
  stage?: string;
  providerRequestId?: string;
  requestedModel?: string;
  actualModel?: string;
  modelPresetId?: string;
  promptVersion?: string;
  schemaVersion?: string;
  contextManifestVersion?: string;
  providerCostUsd?: number;
  priceTableVersion?: string;
  latencyMs?: number;
  retryCount?: number;
  repairAttempts?: number;
  outcome?: string;
  errorCategory?: string;
  imageCount?: number;
}

export interface GenerationUsageEventRow {
  eventId: string;
  requestId: string;
  projectId: string;
  actorUserId: string;
  provider: GenerationCostProvider;
  modelId?: string;
  surface: GenerationCostSurface;
  actionKind?: string;
  requestType: string;
  usage: GenerationUsagePayload;
  estimatedCostUsd: number;
  currency: string;
  billable: boolean;
  createdAt: Date;
  documentId?: string;
  threadId?: string;
  runId?: string;
  stage?: string;
  providerRequestId?: string;
  requestedModel?: string;
  actualModel?: string;
  modelPresetId?: string;
  promptVersion?: string;
  schemaVersion?: string;
  contextManifestVersion?: string;
  providerCostUsd?: number;
  priceTableVersion?: string;
  latencyMs?: number;
  retryCount?: number;
  repairAttempts?: number;
  outcome?: string;
  errorCategory?: string;
  imageCount?: number;
}

export interface ProjectCostByActor {
  userId: string;
  estimatedCostUsd: number;
  eventCount: number;
}

export interface ProjectCostBySurface {
  surface: string;
  estimatedCostUsd: number;
  eventCount: number;
}

export interface ProjectCostByModel {
  provider: string;
  modelId?: string;
  estimatedCostUsd: number;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ProjectCostPeriodSummary {
  estimatedCostUsd: number;
  eventCount: number;
  byActor: ProjectCostByActor[];
  bySurface: ProjectCostBySurface[];
  byModel: ProjectCostByModel[];
}

export interface ProjectCostSummaryResponse {
  projectId: string;
  currency: 'USD';
  /** Billable events only (legacy excluded rows with billable=false or cost 0 stay out of totals when billable=false). */
  month: ProjectCostPeriodSummary;
  year: ProjectCostPeriodSummary;
  total: ProjectCostPeriodSummary;
  pricingNote: string;
}
