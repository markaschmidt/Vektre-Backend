import { ConfigService } from '@nestjs/config';
import {
  GenerationCostEstimator,
  parseOpenAiImageUsage,
  parseReplicateMetrics,
} from './generation-cost.estimator.js';

describe('GenerationCostEstimator', () => {
  const estimator = new GenerationCostEstimator({
    get: () => ({
      openaiTextInputPer1M: 5,
      openaiImageInputPer1M: 8,
      openaiImageOutputPer1M: 30,
      openaiInputBlendedPer1M: 5,
      replicateDefaultUsdPerSecond: 0.002,
      replicateModelUsdPerSecond: {
        'tencent/hunyuan-3d-3.1': 0.002,
        'black-forest-labs/flux-2-pro': 0.003,
      },
    }),
  } as unknown as ConfigService);

  it('estimates OpenAI image cost from token details', () => {
    const usd = estimator.estimateUsd('openai', {
      openai: {
        inputTokens: 1200,
        outputTokens: 1000,
        inputTokensDetails: { textTokens: 200, imageTokens: 1000 },
      },
    });
    // (200/1e6)*5 + (1000/1e6)*8 + (1000/1e6)*30 = 0.039
    expect(usd).toBeCloseTo(0.039, 8);
  });

  it('estimates Replicate from predict_time × model rate', () => {
    const usd = estimator.estimateUsd(
      'replicate',
      { replicate: { predictTimeSeconds: 10 } },
      'black-forest-labs/flux-2-pro',
    );
    expect(usd).toBeCloseTo(0.03, 8);
  });

  it('returns 0 for local provider', () => {
    expect(estimator.estimateUsd('local', {})).toBe(0);
  });
});

describe('parseOpenAiImageUsage / parseReplicateMetrics', () => {
  it('parses OpenAI usage snake_case fields', () => {
    const parsed = parseOpenAiImageUsage({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      input_tokens_details: { text_tokens: 40, image_tokens: 60 },
    });
    expect(parsed?.inputTokens).toBe(100);
    expect(parsed?.inputTokensDetails?.textTokens).toBe(40);
    expect(parsed?.inputTokensDetails?.imageTokens).toBe(60);
  });

  it('parses Replicate metrics', () => {
    const parsed = parseReplicateMetrics(
      { predict_time: 12.5, total_time: 14 },
      'pred_abc',
    );
    expect(parsed?.predictTimeSeconds).toBe(12.5);
    expect(parsed?.totalTimeSeconds).toBe(14);
    expect(parsed?.predictionId).toBe('pred_abc');
  });
});
