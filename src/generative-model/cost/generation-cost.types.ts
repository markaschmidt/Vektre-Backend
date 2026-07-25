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

export type GenerationCostProvider = 'openai' | 'replicate' | 'local';

export type GenerationCostSurface =
  | 'storyboard'
  | 'foundry'
  | 'canvas'
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
}

export interface ProjectCostByActor {
  userId: string;
  estimatedCostUsd: number;
  eventCount: number;
}

export interface ProjectCostPeriodSummary {
  estimatedCostUsd: number;
  eventCount: number;
  byActor: ProjectCostByActor[];
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
