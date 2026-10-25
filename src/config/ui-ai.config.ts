import { registerAs } from '@nestjs/config';

export interface UiAiConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  requestTimeoutMs: number;
  promptVersion: string;
  contextVersion: string;
  priceTableVersion: string;
}

export const uiAiConfig = registerAs(
  'uiAi',
  (): UiAiConfig => ({
    enabled: Boolean(
      process.env.VEKTRE_AI_URL && process.env.VEKTRE_AI_API_KEY,
    ),
    url: (process.env.VEKTRE_AI_URL ?? '').replace(/\/+$/, ''),
    apiKey: process.env.VEKTRE_AI_API_KEY ?? '',
    requestTimeoutMs: boundedNumber(
      process.env.VEKTRE_AI_TIMEOUT_MS,
      120_000,
      5_000,
      600_000,
    ),
    promptVersion: process.env.VEKTRE_AI_PROMPT_VERSION ?? 'ui-agent-v1',
    contextVersion: process.env.VEKTRE_AI_CONTEXT_VERSION ?? 'context-v1',
    priceTableVersion:
      process.env.VEKTRE_AI_PRICE_TABLE_VERSION ?? 'ui-agent-2026-08',
  }),
);

function boundedNumber(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? Math.floor(value)
    : fallback;
}
