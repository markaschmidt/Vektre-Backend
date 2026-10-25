import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentStageRequestSchema,
  AgentStageResultSchema,
  type AgentStageRequest,
  type AgentStageResult,
} from '@markaschmidt/ui-builder-contracts';
import type { UiAiConfig } from '../config/ui-ai.config.js';
import { outboundJson } from '../integrations/outbound-http.js';
import { ProviderError } from '../integrations/provider-error.model.js';
import type { UiModelPreset } from './ui-agent.capabilities.js';

@Injectable()
export class UiAiClient {
  constructor(private readonly config: ConfigService) {}

  private cfg(): UiAiConfig {
    return this.config.getOrThrow<UiAiConfig>('uiAi');
  }

  async executeStage(
    request: AgentStageRequest,
    preset: UiModelPreset,
    idempotencyKey: string,
  ): Promise<AgentStageResult> {
    const payload = AgentStageRequestSchema.parse(request);
    const cfg = this.cfg();
    if (!cfg.enabled || !cfg.url || !cfg.apiKey) {
      throw ProviderError.retryable(
        'vektre-ai',
        'Private UI worker is not configured',
      );
    }
    const response = await outboundJson<unknown>({
      provider: 'vektre-ai',
      url: `${cfg.url}/v1/ui-agent/stages/execute`,
      method: 'POST',
      headers: {
        'X-API-Key': cfg.apiKey,
        'X-Idempotency-Key': idempotencyKey,
        'X-Vektre-Model-Provider': preset.workerPolicy.provider,
        'X-Vektre-Model-Policy': preset.workerPolicy.model,
        'X-Vektre-Run-Id': payload.runId,
        'X-Vektre-Stage-Execution-Id': payload.stageExecutionId,
      },
      body: payload,
      timeoutMs: cfg.requestTimeoutMs,
      requestId: payload.stageExecutionId,
    });
    const parsed = AgentStageResultSchema.safeParse(response.data);
    if (!parsed.success) {
      throw ProviderError.permanent(
        'vektre-ai',
        `Worker returned an invalid stage result: ${parsed.error.message}`,
      );
    }
    if (
      parsed.data.runId !== payload.runId ||
      parsed.data.stageExecutionId !== payload.stageExecutionId ||
      parsed.data.stage !== payload.stage
    ) {
      throw ProviderError.permanent(
        'vektre-ai',
        'Worker stage identity does not match the request',
      );
    }
    return parsed.data;
  }

  async cancelRun(runId: string): Promise<boolean> {
    const cfg = this.cfg();
    if (!cfg.enabled || !cfg.url || !cfg.apiKey) return false;
    try {
      await outboundJson<unknown>({
        provider: 'vektre-ai',
        url: `${cfg.url}/v1/ui-agent/runs/${encodeURIComponent(runId)}/cancel`,
        method: 'POST',
        headers: { 'X-API-Key': cfg.apiKey },
        timeoutMs: Math.min(cfg.requestTimeoutMs, 10_000),
        requestId: runId,
      });
      return true;
    } catch {
      return false;
    }
  }
}
