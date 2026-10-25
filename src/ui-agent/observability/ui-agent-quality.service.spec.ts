import { UiAgentQualityService } from './ui-agent-quality.service.js';
import type { UiContextRepository } from '../repositories/ui-context.repository.js';

describe('UiAgentQualityService', () => {
  it('does not aggregate private-thread metrics without project policy', async () => {
    const context = {
      getTelemetryPolicy: jest.fn().mockResolvedValue({
        contentTraces: false,
        zeroRetention: false,
        allowPrivateAggregates: false,
      }),
      recordQualityEvent: jest.fn(),
    };
    const quality = new UiAgentQualityService(
      context as unknown as UiContextRepository,
    );
    await quality.record({
      run: {
        projectId: 'project-1',
        documentId: 'document-1',
        runId: 'run-1',
        ownerUserId: 'user-1',
        visibility: 'private',
      },
      metricKind: 'human_accept',
      metricValue: 1,
    });
    expect(context.recordQualityEvent).not.toHaveBeenCalled();
  });
});
