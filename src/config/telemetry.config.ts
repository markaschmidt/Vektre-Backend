import { registerAs } from '@nestjs/config';

export interface TelemetryConfig {
  serviceName: string;
  otlpTracesUrl: string;
  langfuseHost: string;
  langfusePublicKey: string;
  langfuseSecretKey: string;
  /** Must be combined with a per-project debug window. Never enables content globally. */
  operatorContentCapture: boolean;
  exportTimeoutMs: number;
}

export const telemetryConfig = registerAs(
  'telemetry',
  (): TelemetryConfig => ({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'vektre-api',
    otlpTracesUrl: (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? '').replace(
      /\/+$/,
      '',
    ),
    langfuseHost: (process.env.LANGFUSE_HOST ?? '').replace(/\/+$/, ''),
    langfusePublicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
    langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
    operatorContentCapture:
      process.env.TELEMETRY_OPERATOR_CONTENT_CAPTURE === '1',
    exportTimeoutMs: boundedNumber(
      process.env.TELEMETRY_EXPORT_TIMEOUT_MS,
      5_000,
      500,
      30_000,
    ),
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
