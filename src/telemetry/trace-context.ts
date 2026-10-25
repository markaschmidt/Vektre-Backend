import { AsyncLocalStorage } from 'node:async_hooks';
import type { W3cSpanContext, W3cTraceCarrier } from './w3c-traceparent.js';
import {
  childSpanContext,
  createRootSpanContext,
  parseTraceparent,
  serializeTraceparent,
} from './w3c-traceparent.js';

export interface ActiveSpan {
  name: string;
  context: W3cSpanContext;
  parentSpanId?: string;
  attributes: Record<string, string | number | boolean>;
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error';
  errorCategory?: string;
}

export interface TraceStore {
  span: ActiveSpan;
  tracestate?: string;
}

const storage = new AsyncLocalStorage<TraceStore>();

export function currentTraceStore(): TraceStore | undefined {
  return storage.getStore();
}

export function currentSpan(): ActiveSpan | undefined {
  return storage.getStore()?.span;
}

export function currentTraceCarrier(): W3cTraceCarrier | undefined {
  const store = storage.getStore();
  if (!store) return undefined;
  return {
    traceparent: serializeTraceparent(store.span.context),
    ...(store.tracestate ? { tracestate: store.tracestate } : {}),
  };
}

export function runWithTraceStore<T>(
  store: TraceStore,
  fn: () => T,
): T {
  return storage.run(store, fn);
}

export function startChildSpan(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
  parent: TraceStore | undefined = storage.getStore(),
): TraceStore {
  const parentContext = parent?.span.context ?? createRootSpanContext();
  const context = parent
    ? childSpanContext(parentContext)
    : parentContext;
  return {
    tracestate: parent?.tracestate,
    span: {
      name,
      context,
      parentSpanId: parent?.span.context.spanId,
      attributes: { ...attributes },
      startTime: Date.now(),
      status: 'ok',
    },
  };
}

export function storeFromCarrier(
  carrier: W3cTraceCarrier | undefined,
  name: string,
  attributes: Record<string, string | number | boolean> = {},
): TraceStore {
  const remote = parseTraceparent(carrier?.traceparent);
  if (!remote) {
    return startChildSpan(name, attributes);
  }
  const context = childSpanContext(remote);
  return {
    tracestate: carrier?.tracestate,
    span: {
      name,
      context,
      parentSpanId: remote.spanId,
      attributes: { ...attributes },
      startTime: Date.now(),
      status: 'ok',
    },
  };
}

export function endSpan(
  span: ActiveSpan,
  status: 'ok' | 'error' = 'ok',
  errorCategory?: string,
): ActiveSpan {
  span.endTime = Date.now();
  span.status = status;
  if (errorCategory) span.errorCategory = errorCategory;
  return span;
}

export function setSpanAttributes(
  span: ActiveSpan,
  attributes: Record<string, string | number | boolean>,
): void {
  Object.assign(span.attributes, attributes);
}

export function carrierFromUnknown(value: unknown): W3cTraceCarrier | undefined {
  if (!value || typeof value !== 'object' || !('trace' in value)) {
    return undefined;
  }
  const trace = (value as { trace?: unknown }).trace;
  if (!trace || typeof trace !== 'object') return undefined;
  const traceparent = (trace as { traceparent?: unknown }).traceparent;
  if (typeof traceparent !== 'string' || !parseTraceparent(traceparent)) {
    return undefined;
  }
  const tracestate = (trace as { tracestate?: unknown }).tracestate;
  return {
    traceparent,
    ...(typeof tracestate === 'string' ? { tracestate } : {}),
  };
}
