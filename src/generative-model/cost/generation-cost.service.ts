import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppDataService } from '../../integrations/app-data.service.js';
import { GenerationCostEstimator } from './generation-cost.estimator.js';
import type { GenerationUsageEventRow } from '../../integrations/app-data.types.js';
import type {
  ProjectCostByActor,
  ProjectCostByModel,
  ProjectCostBySurface,
  ProjectCostPeriodSummary,
  ProjectCostSummaryResponse,
  RecordGenerationUsageInput,
} from './generation-cost.types.js';
import { UsageCreditsService } from '../../billing/usage-credits.service.js';

@Injectable()
export class GenerationCostService {
  private readonly logger = new Logger(GenerationCostService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly estimator: GenerationCostEstimator,
    @Optional() private readonly usageCredits?: UsageCreditsService,
  ) {}

  /**
   * Persist a billable (or excluded) usage event. Idempotent on requestId —
   * retries / double-complete do not double-count.
   */
  async recordUsage(input: RecordGenerationUsageInput): Promise<void> {
    if (!input.projectId) {
      this.logger.warn(
        JSON.stringify({
          event: 'generation_usage_skipped_no_project',
          requestId: input.requestId,
          provider: input.provider,
        }),
      );
      return;
    }

    const billable = input.billable !== false;
    const estimated =
      input.estimatedCostUsd ??
      (billable
        ? this.estimator.estimateUsd(input.provider, input.usage, input.modelId)
        : 0);

    try {
      await this.appData.upsertGenerationUsageEvent({
        eventId: `gue_${randomUUID()}`,
        requestId: input.requestId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        provider: input.provider,
        modelId: input.modelId,
        surface: input.surface,
        actionKind: input.actionKind,
        requestType: input.requestType,
        usage: input.usage as unknown as Record<string, unknown>,
        estimatedCostUsd: billable ? estimated : 0,
        currency: 'USD',
        billable,
        documentId: input.documentId,
        threadId: input.threadId,
        runId: input.runId,
        stage: input.stage,
        providerRequestId: input.providerRequestId,
        requestedModel: input.requestedModel,
        actualModel: input.actualModel,
        modelPresetId: input.modelPresetId,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        contextManifestVersion: input.contextManifestVersion,
        providerCostUsd: input.providerCostUsd,
        priceTableVersion: input.priceTableVersion,
        latencyMs: input.latencyMs,
        retryCount: input.retryCount,
        repairAttempts: input.repairAttempts,
        outcome: input.outcome,
        errorCategory: input.errorCategory,
        imageCount: input.imageCount,
      });
      if (billable && estimated > 0 && this.usageCredits) {
        await this.usageCredits.consumeGeneration({
          userId: input.actorUserId,
          requestId: input.requestId,
          estimatedCostUsd: estimated,
        });
      }
      this.logger.log(
        JSON.stringify({
          event: 'generation_usage_recorded',
          requestId: input.requestId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          provider: input.provider,
          estimatedCostUsd: billable ? estimated : 0,
          billable,
        }),
      );
    } catch (err) {
      // Cost tracking must never fail the generative job.
      this.logger.error(
        JSON.stringify({
          event: 'generation_usage_record_failed',
          requestId: input.requestId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  async getProjectCostSummary(
    projectId: string,
    now = new Date(),
  ): Promise<ProjectCostSummaryResponse> {
    const monthStart = startOfUtcMonth(now);
    const yearStart = startOfUtcYear(now);

    const [monthEvents, yearEvents, totalEvents] = await Promise.all([
      this.appData.listGenerationUsageEvents(projectId, {
        since: monthStart,
        billableOnly: true,
      }),
      this.appData.listGenerationUsageEvents(projectId, {
        since: yearStart,
        billableOnly: true,
      }),
      this.appData.listGenerationUsageEvents(projectId, {
        billableOnly: true,
      }),
    ]);

    return {
      projectId,
      currency: 'USD',
      month: summarize(monthEvents),
      year: summarize(yearEvents),
      total: summarize(totalEvents),
      pricingNote:
        'estimatedCostUsd uses the configured price-table version on each row. providerCostUsd is the vendor-reported amount when present and is not mixed into estimated totals. Surfaces include storyboard, foundry, canvas, gui_screen, and chat/model stages.',
    };
  }
}

function summarize(
  events: GenerationUsageEventRow[],
): ProjectCostPeriodSummary {
  const byActorMap = new Map<string, ProjectCostByActor>();
  const bySurfaceMap = new Map<string, ProjectCostBySurface>();
  const byModelMap = new Map<string, ProjectCostByModel>();
  let estimatedCostUsd = 0;

  for (const e of events) {
    estimatedCostUsd += e.estimatedCostUsd;
    const cur = byActorMap.get(e.actorUserId) ?? {
      userId: e.actorUserId,
      estimatedCostUsd: 0,
      eventCount: 0,
    };
    cur.estimatedCostUsd += e.estimatedCostUsd;
    cur.eventCount += 1;
    byActorMap.set(e.actorUserId, cur);

    const surface = bySurfaceMap.get(e.surface) ?? {
      surface: e.surface,
      estimatedCostUsd: 0,
      eventCount: 0,
    };
    surface.estimatedCostUsd += e.estimatedCostUsd;
    surface.eventCount += 1;
    bySurfaceMap.set(e.surface, surface);

    const modelKey = `${e.provider}:${e.modelId ?? e.actualModel ?? ''}`;
    const usage = e.usage as {
      text?: { inputTokens?: number; outputTokens?: number };
    };
    const model = byModelMap.get(modelKey) ?? {
      provider: e.provider,
      modelId: e.modelId ?? e.actualModel,
      estimatedCostUsd: 0,
      eventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    model.estimatedCostUsd += e.estimatedCostUsd;
    model.eventCount += 1;
    model.inputTokens += Number(usage.text?.inputTokens ?? 0);
    model.outputTokens += Number(usage.text?.outputTokens ?? 0);
    byModelMap.set(modelKey, model);
  }

  const byActor = [...byActorMap.values()]
    .map((a) => ({
      ...a,
      estimatedCostUsd: roundUsd(a.estimatedCostUsd),
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  const bySurface = [...bySurfaceMap.values()]
    .map((item) => ({
      ...item,
      estimatedCostUsd: roundUsd(item.estimatedCostUsd),
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  const byModel = [...byModelMap.values()]
    .map((item) => ({
      ...item,
      estimatedCostUsd: roundUsd(item.estimatedCostUsd),
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

  return {
    estimatedCostUsd: roundUsd(estimatedCostUsd),
    eventCount: events.length,
    byActor,
    bySurface,
    byModel,
  };
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfUtcYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}

function roundUsd(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
