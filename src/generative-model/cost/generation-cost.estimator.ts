import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GenerationUsagePayload,
  OpenAiImageUsage,
  ReplicateUsage,
} from './generation-cost.types.js';

export interface GenerationPricingConfig {
  openaiTextInputPer1M: number;
  openaiImageInputPer1M: number;
  openaiImageOutputPer1M: number;
  /** Fallback when token detail split is unavailable. */
  openaiInputBlendedPer1M: number;
  replicateDefaultUsdPerSecond: number;
  /** Optional per-model overrides, keyed by Replicate model slug. */
  replicateModelUsdPerSecond: Record<string, number>;
}

/**
 * Estimates USD from provider metering. Rates are env-configurable so we can
 * track vendor price changes without code deploys.
 */
@Injectable()
export class GenerationCostEstimator {
  constructor(private readonly config: ConfigService) {}

  get pricing(): GenerationPricingConfig {
    const configured = this.config.get<GenerationPricingConfig>(
      'outbound.generationPricing',
    );
    return (
      configured ?? {
        openaiTextInputPer1M: 5,
        openaiImageInputPer1M: 8,
        openaiImageOutputPer1M: 30,
        openaiInputBlendedPer1M: 5,
        replicateDefaultUsdPerSecond: 0.002,
        replicateModelUsdPerSecond: {
          'tencent/hunyuan-3d-3.1': 0.002,
        'tencent/hunyuan3d-2mv': 0.001,
          'black-forest-labs/flux-2-pro': 0.003,
        },
      }
    );
  }

  estimateUsd(
    provider: 'openai' | 'replicate' | 'local',
    usage: GenerationUsagePayload,
    modelId?: string,
  ): number {
    if (provider === 'local') return 0;
    if (provider === 'openai') {
      return this.estimateOpenAi(usage.openai);
    }
    if (provider === 'replicate') {
      return this.estimateReplicate(usage.replicate, modelId);
    }
    return 0;
  }

  private estimateOpenAi(usage?: OpenAiImageUsage): number {
    if (!usage) return 0;
    const p = this.pricing;
    const text =
      usage.inputTokensDetails?.textTokens ??
      (usage.inputTokensDetails?.imageTokens == null
        ? (usage.inputTokens ?? 0)
        : 0);
    const imageIn = usage.inputTokensDetails?.imageTokens ?? 0;
    const hasDetail =
      usage.inputTokensDetails?.textTokens != null ||
      usage.inputTokensDetails?.imageTokens != null;

    let inputCost = 0;
    if (hasDetail) {
      inputCost =
        (text / 1_000_000) * p.openaiTextInputPer1M +
        (imageIn / 1_000_000) * p.openaiImageInputPer1M;
    } else if (usage.inputTokens) {
      inputCost = (usage.inputTokens / 1_000_000) * p.openaiInputBlendedPer1M;
    }

    const outputTokens = usage.outputTokens ?? 0;
    const outputCost =
      (outputTokens / 1_000_000) * p.openaiImageOutputPer1M;

    return roundUsd(inputCost + outputCost);
  }

  private estimateReplicate(
    usage?: ReplicateUsage,
    modelId?: string,
  ): number {
    if (!usage?.predictTimeSeconds || usage.predictTimeSeconds <= 0) return 0;
    const p = this.pricing;
    const rate =
      (modelId && p.replicateModelUsdPerSecond[modelId]) ||
      p.replicateDefaultUsdPerSecond;
    return roundUsd(usage.predictTimeSeconds * rate);
  }
}

export function parseOpenAiImageUsage(
  raw: unknown,
): OpenAiImageUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const details = u.input_tokens_details as Record<string, unknown> | undefined;
  return {
    inputTokens:
      typeof u.input_tokens === 'number' ? u.input_tokens : undefined,
    outputTokens:
      typeof u.output_tokens === 'number' ? u.output_tokens : undefined,
    totalTokens:
      typeof u.total_tokens === 'number' ? u.total_tokens : undefined,
    inputTokensDetails: details
      ? {
          textTokens:
            typeof details.text_tokens === 'number'
              ? details.text_tokens
              : undefined,
          imageTokens:
            typeof details.image_tokens === 'number'
              ? details.image_tokens
              : undefined,
        }
      : undefined,
    raw: u,
  };
}

export function parseReplicateMetrics(
  raw: unknown,
  predictionId?: string,
): ReplicateUsage | undefined {
  if (!raw || typeof raw !== 'object') {
    return predictionId ? { predictionId } : undefined;
  }
  const m = raw as Record<string, unknown>;
  return {
    predictTimeSeconds:
      typeof m.predict_time === 'number' ? m.predict_time : undefined,
    totalTimeSeconds:
      typeof m.total_time === 'number' ? m.total_time : undefined,
    predictionId,
    raw: m,
  };
}

function roundUsd(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1e8) / 1e8;
}
