import { GenerationCostService } from './generation-cost.service.js';
import { GenerationCostEstimator } from './generation-cost.estimator.js';
import type { AppDataService } from '../../integrations/app-data.service.js';
import type { GenerationUsageEventRow } from '../../integrations/app-data.types.js';

function event(
  partial: Partial<GenerationUsageEventRow> & {
    actorUserId: string;
    estimatedCostUsd: number;
  },
): GenerationUsageEventRow {
  return {
    eventId: partial.eventId ?? 'e1',
    requestId: partial.requestId ?? 'r1',
    projectId: partial.projectId ?? 'p1',
    actorUserId: partial.actorUserId,
    provider: partial.provider ?? 'openai',
    surface: partial.surface ?? 'storyboard',
    requestType: partial.requestType ?? 'openai-concept-art',
    usage: partial.usage ?? {},
    estimatedCostUsd: partial.estimatedCostUsd,
    currency: 'USD',
    billable: partial.billable ?? true,
    createdAt: partial.createdAt ?? new Date(),
  };
}

describe('GenerationCostService.getProjectCostSummary', () => {
  it('aggregates month/year/total and byActor', async () => {
    const events = [
      event({ actorUserId: 'u1', estimatedCostUsd: 1.5, requestId: 'a' }),
      event({ actorUserId: 'u1', estimatedCostUsd: 0.5, requestId: 'b' }),
      event({ actorUserId: 'u2', estimatedCostUsd: 2, requestId: 'c' }),
    ];
    const appData = {
      listGenerationUsageEvents: jest.fn().mockResolvedValue(events),
      upsertGenerationUsageEvent: jest.fn(),
    } as unknown as AppDataService;
    const estimator = {
      estimateUsd: jest.fn().mockReturnValue(0),
    } as unknown as GenerationCostEstimator;

    const service = new GenerationCostService(appData, estimator);
    const summary = await service.getProjectCostSummary('p1');

    expect(summary.projectId).toBe('p1');
    expect(summary.currency).toBe('USD');
    expect(summary.total.estimatedCostUsd).toBe(4);
    expect(summary.total.eventCount).toBe(3);
    expect(summary.total.byActor).toEqual(
      expect.arrayContaining([
        { userId: 'u1', estimatedCostUsd: 2, eventCount: 2 },
        { userId: 'u2', estimatedCostUsd: 2, eventCount: 1 },
      ]),
    );
    expect(summary.total.byActor).toHaveLength(2);
    expect(summary.total.bySurface).toEqual([
      { surface: 'storyboard', estimatedCostUsd: 4, eventCount: 3 },
    ]);
    expect(summary.total.byModel[0]?.provider).toBe('openai');
    expect(summary.month.estimatedCostUsd).toBe(4);
    expect(summary.year.estimatedCostUsd).toBe(4);
  });

  it('records price-table estimates separately from provider-reported cost', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const consume = jest.fn().mockResolvedValue(undefined);
    const service = new GenerationCostService(
      { upsertGenerationUsageEvent: upsert } as unknown as AppDataService,
      { estimateUsd: jest.fn().mockReturnValue(1.25) } as unknown as GenerationCostEstimator,
      { consumeGeneration: consume } as never,
    );
    await service.recordUsage({
      requestId: 'stage-1',
      projectId: 'p1',
      actorUserId: 'u1',
      provider: 'openai',
      surface: 'gui_screen',
      requestType: 'ui_agent_stage',
      usage: { text: { inputTokens: 10, outputTokens: 4, providerCostUsd: 0.4 } },
      estimatedCostUsd: 1.25,
      providerCostUsd: 0.4,
      priceTableVersion: 'ui-agent-2026-08',
      providerRequestId: 'prov-1',
    });
    await service.recordUsage({
      requestId: 'stage-1',
      projectId: 'p1',
      actorUserId: 'u1',
      provider: 'openai',
      surface: 'gui_screen',
      requestType: 'ui_agent_stage',
      usage: { text: { inputTokens: 10, outputTokens: 4, providerCostUsd: 0.4 } },
      estimatedCostUsd: 1.25,
      providerCostUsd: 0.4,
      priceTableVersion: 'ui-agent-2026-08',
      providerRequestId: 'prov-1',
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'stage-1',
        providerCostUsd: 0.4,
        priceTableVersion: 'ui-agent-2026-08',
        estimatedCostUsd: 1.25,
      }),
    );
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume.mock.calls[0]?.[0].requestId).toBe('stage-1');
  });
});
