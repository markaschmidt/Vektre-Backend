import { randomBytes } from 'node:crypto';

export interface W3cSpanContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

export interface W3cTraceCarrier {
  traceparent: string;
  tracestate?: string;
}

const TRACEPARENT =
  /^[\t ]*([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})[\t ]*$/;

export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function generateTraceId(): string {
  let id = randomBytes(16).toString('hex');
  if (id === '0'.repeat(32)) id = `1${id.slice(1)}`;
  return id;
}

export function createRootSpanContext(sampled = true): W3cSpanContext {
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    sampled,
  };
}

export function childSpanContext(parent: W3cSpanContext): W3cSpanContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    sampled: parent.sampled,
  };
}

export function serializeTraceparent(context: W3cSpanContext): string {
  const flags = context.sampled ? '01' : '00';
  return `00-${context.traceId}-${context.spanId}-${flags}`;
}

export function parseTraceparent(
  header: string | undefined | string[],
): W3cSpanContext | undefined {
  if (Array.isArray(header)) return parseTraceparent(header[0]);
  if (!header) return undefined;
  const match = TRACEPARENT.exec(header);
  if (!match) return undefined;
  const version = match[1];
  const traceId = match[2];
  const spanId = match[3];
  const flags = match[4];
  if (version === 'ff' || traceId === '0'.repeat(32) || spanId === '0'.repeat(16)) {
    return undefined;
  }
  return {
    traceId,
    spanId,
    sampled: (Number.parseInt(flags, 16) & 0x01) === 1,
  };
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function extractTraceCarrier(
  headers: Record<string, string | string[] | undefined>,
): W3cTraceCarrier | undefined {
  const traceparent = headerValue(headers, 'traceparent');
  const parsed = parseTraceparent(traceparent);
  if (!parsed || !traceparent) return undefined;
  const tracestate = headerValue(headers, 'tracestate');
  return tracestate ? { traceparent, tracestate } : { traceparent };
}

export function injectTraceHeaders(
  headers: Record<string, string>,
  carrier: W3cTraceCarrier | undefined,
): Record<string, string> {
  if (!carrier) return headers;
  return {
    ...headers,
    traceparent: carrier.traceparent,
    ...(carrier.tracestate ? { tracestate: carrier.tracestate } : {}),
  };
}
