import { UiAgentOperationsService } from './ui-agent-operations.service.js';
import type { AppDataService } from '../../integrations/app-data.service.js';
import type { UiContextRepository } from '../repositories/ui-context.repository.js';
import type { UiContextIndexRepository } from '../indexer/ui-context-index.repository.js';
import type { GenerationCostService } from '../../generative-model/cost/generation-cost.service.js';

jest.mock('../../projects/project-access.js', () => ({
  requireProjectRole: jest.fn().mockResolvedValue({ role: 'viewer' }),
}));

describe('UiAgentOperationsService', () => {
  it('builds alerts for stalled stages, index lag, and unreconciled activities', async () => {
    const service = new UiAgentOperationsService(
      {
        listUnreconciledCollaborationActivity: jest.fn().mockResolvedValue([
          {
            activityId: 'act-1',
            documentId: 'document-1',
            activityType: 'ai_task',
          },
        ]),
      } as unknown as AppDataService,
      {
        listStalledSteps: jest.fn().mockResolvedValue([
          {
            runId: 'run-1',
            stageExecutionId: 'exec-1',
            stage: 'understand',
            status: 'running',
            stalledMs: 400_000,
          },
        ]),
        listProviderErrorRates: jest
          .fn()
          .mockResolvedValue([{ errorCategory: 'rate_limited', eventCount: 8 }]),
        listQualityRollup: jest.fn().mockResolvedValue([
          {
            metricKind: 'first_pass_valid',
            avgValue: 0.4,
            eventCount: 10,
            sumValue: 4,
          },
        ]),
      } as unknown as UiContextRepository,
      {
        listIndexLag: jest.fn().mockResolvedValue([
          {
            documentId: 'document-1',
            documentKey: 'key',
            status: 'pending',
            indexLagMs: 12_000,
          },
        ]),
      } as unknown as UiContextIndexRepository,
      {
        getProjectCostSummary: jest.fn().mockResolvedValue({
          projectId: 'project-1',
          currency: 'USD',
          month: {
            estimatedCostUsd: 1,
            eventCount: 1,
            byActor: [],
            bySurface: [],
            byModel: [],
          },
          year: {
            estimatedCostUsd: 1,
            eventCount: 1,
            byActor: [],
            bySurface: [],
            byModel: [],
          },
          total: {
            estimatedCostUsd: 1,
            eventCount: 1,
            byActor: [],
            bySurface: [
              { surface: 'gui_screen', estimatedCostUsd: 1, eventCount: 1 },
            ],
            byModel: [],
          },
          pricingNote: 'estimated',
        }),
      } as unknown as GenerationCostService,
    );

    const snapshot = await service.getSnapshot('user-1', 'project-1');
    expect(snapshot.costs.total.bySurface[0]?.surface).toBe('gui_screen');
    expect(snapshot.alerts.map((alert) => alert.id)).toEqual(
      expect.arrayContaining([
        'stalled_stages',
        'context_index_lag',
        'provider_rate_limits',
        'schema_repair_regression',
        'unreconciled_activities',
      ]),
    );
    expect(snapshot.alerts.every((alert) => alert.blockingProduct === false)).toBe(
      true,
    );
  });
});
