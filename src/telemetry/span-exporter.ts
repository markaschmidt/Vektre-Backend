import { Logger } from '@nestjs/common';
import type { TelemetryConfig } from '../config/telemetry.config.js';
import { redactAttributes } from './redaction.js';
import type { ActiveSpan } from './trace-context.js';

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{
    key: string;
    value: { stringValue?: string; intValue?: string; boolValue?: boolean };
  }>;
  status: { code: number; message?: string };
}

const logger = new Logger('TelemetryExporter');

export async function exportRedactedSpans(
  spans: ActiveSpan[],
  config: TelemetryConfig,
): Promise<{ otlp: boolean; langfuse: boolean }> {
  if (spans.length === 0) return { otlp: false, langfuse: false };
  const payload = otlpPayload(spans, config.serviceName);
  const otlp = await postJson(
    config.otlpTracesUrl,
    payload,
    {},
    config.exportTimeoutMs,
    'otlp',
  );
  const langfuse = await exportLangfuse(payload, config);
  return { otlp, langfuse };
}

async function exportLangfuse(
  payload: unknown,
  config: TelemetryConfig,
): Promise<boolean> {
  if (!config.langfuseHost || !config.langfusePublicKey || !config.langfuseSecretKey) {
    return false;
  }
  const token = Buffer.from(
    `${config.langfusePublicKey}:${config.langfuseSecretKey}`,
  ).toString('base64');
  return postJson(
    `${config.langfuseHost}/api/public/otel/v1/traces`,
    payload,
    { Authorization: `Basic ${token}` },
    config.exportTimeoutMs,
    'langfuse',
  );
}

function otlpPayload(spans: ActiveSpan[], serviceName: string): unknown {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'vektre.telemetry', version: '1' },
            spans: spans.map(toOtlpSpan),
          },
        ],
      },
    ],
  };
}

function toOtlpSpan(span: ActiveSpan): OtlpSpan {
  const redacted = redactAttributes(span.attributes) as Record<string, unknown>;
  const startNs = BigInt(span.startTime) * 1_000_000n;
  const endNs = BigInt(span.endTime ?? span.startTime) * 1_000_000n;
  return {
    traceId: span.context.traceId,
    spanId: span.context.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    kind: 1,
    startTimeUnixNano: startNs.toString(),
    endTimeUnixNano: endNs.toString(),
    attributes: Object.entries(redacted).flatMap(([key, value]) => {
      const otlp = toOtlpValue(value);
      return otlp ? [{ key, value: otlp }] : [];
    }),
    status: {
      code: span.status === 'error' ? 2 : 1,
      ...(span.errorCategory ? { message: span.errorCategory } : {}),
    },
  };
}

function toOtlpValue(value: unknown): OtlpSpan['attributes'][number]['value'] | undefined {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { stringValue: String(value) };
  }
  if (value && typeof value === 'object') {
    return { stringValue: JSON.stringify(value) };
  }
  return undefined;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  sink: string,
): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(
        JSON.stringify({
          event: 'telemetry_export_failed',
          sink,
          status: response.status,
        }),
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.warn(
      JSON.stringify({
        event: 'telemetry_export_failed',
        sink,
        error: error instanceof Error ? error.name : 'unknown',
      }),
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}
