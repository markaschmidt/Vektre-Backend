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
    expect(summary.month.estimatedCostUsd).toBe(4);
    expect(summary.year.estimatedCostUsd).toBe(4);
  });
});
