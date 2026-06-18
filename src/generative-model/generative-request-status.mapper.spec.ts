import { mapGenerativeRequestStatus } from './generative-request-status.mapper.js';
import type { RequestStatusRow } from '../integrations/app-data.types.js';

function makeRow(
  overrides: Partial<RequestStatusRow> = {},
): RequestStatusRow {
  return {
    requestId: 'req-1',
    userId: 'user-1',
    type: 'replicate-3d',
    status: 'processing',
    createdAt: new Date('2026-06-12T00:00:00Z'),
    updatedAt: new Date('2026-06-12T00:01:00Z'),
    ...overrides,
  };
}

describe('mapGenerativeRequestStatus', () => {
  it('maps processing to jobStatus running with predictionId from resultJson', () => {
    const result = mapGenerativeRequestStatus(
      makeRow({
        status: 'processing',
        outputRef: 'replicate-prediction:pred-abc',
        resultJson: { predictionId: 'pred-abc' },
      }),
    );

    expect(result.jobStatus).toBe('running');
    expect(result.status).toBe('processing');
    expect(result.predictionId).toBe('pred-abc');
    expect(result.modelUrl).toBeUndefined();
  });

  it('parses predictionId from replicate-prediction outputRef when resultJson missing', () => {
    const result = mapGenerativeRequestStatus(
      makeRow({
        outputRef: 'replicate-prediction:pred-from-ref',
      }),
    );

    expect(result.predictionId).toBe('pred-from-ref');
  });

  it('maps completed replicate-3d to succeeded with modelUrl and previewUrl', () => {
    const result = mapGenerativeRequestStatus(
      makeRow({
        status: 'completed',
        outputRef: 'https://delivery.replicate.com/model.glb',
        resultJson: {
          predictionId: 'pred-xyz',
          modelUrl: 'https://delivery.replicate.com/model.glb',
          previewUrl: 'https://delivery.replicate.com/preview.png',
        },
      }),
    );

    expect(result.jobStatus).toBe('succeeded');
    expect(result.modelUrl).toBe('https://delivery.replicate.com/model.glb');
    expect(result.previewUrl).toBe('https://delivery.replicate.com/preview.png');
    expect(result.outputRef).toBe('https://delivery.replicate.com/model.glb');
    expect(result.predictionId).toBe('pred-xyz');
  });

  it('maps failed to jobStatus failed with errorMessage', () => {
    const result = mapGenerativeRequestStatus(
      makeRow({
        status: 'failed',
        errorMessage: 'Replicate completed but returned no model file URL',
      }),
    );

    expect(result.jobStatus).toBe('failed');
    expect(result.errorMessage).toContain('no model file URL');
  });

  it('maps cancelled to jobStatus canceled', () => {
    const result = mapGenerativeRequestStatus(
      makeRow({ status: 'cancelled' }),
    );
    expect(result.jobStatus).toBe('canceled');
  });

  it('does not add modelUrl for non-replicate-3d job types', () => {
    const result = mapGenerativeRequestStatus(
      makeRow({
        type: 'openai-concept-art',
        status: 'completed',
        outputRef: 'supabase://bucket/path',
      }),
    );

    expect(result.modelUrl).toBeUndefined();
    expect(result.jobStatus).toBe('succeeded');
  });
});
