import { createHash } from 'node:crypto';
import {
  createRootSpanContext,
  extractTraceCarrier,
  injectTraceHeaders,
  parseTraceparent,
  serializeTraceparent,
} from './w3c-traceparent.js';
import { carrierFromUnknown, runWithTraceStore, startChildSpan } from './trace-context.js';
import { tracedJobData } from './bullmq-trace.js';
import { currentTraceCarrier } from './trace-context.js';

describe('W3C traceparent', () => {
  it('round-trips a sampled context and rejects invalid ids', () => {
    const context = createRootSpanContext();
    const header = serializeTraceparent(context);
    expect(parseTraceparent(header)).toEqual(context);
    expect(parseTraceparent('00-' + '0'.repeat(32) + '-' + '1'.repeat(16) + '-01')).toBeUndefined();
  });

  it('extracts from HTTP headers and injects outbound headers', () => {
    const context = createRootSpanContext();
    const carrier = extractTraceCarrier({
      traceparent: serializeTraceparent(context),
      tracestate: 'vendor=1',
    });
    expect(carrier?.tracestate).toBe('vendor=1');
    expect(injectTraceHeaders({}, carrier)).toEqual({
      traceparent: carrier?.traceparent,
      tracestate: 'vendor=1',
    });
  });

  it('survives a BullMQ job boundary', () => {
    const parent = startChildSpan('http.server', { 'vektre.project_id': 'project-1' });
    const job = runWithTraceStore(parent, () => tracedJobData({ runId: 'run-1' }));
    expect(job.trace?.traceparent).toContain(parent.span.context.traceId);
    const restored = carrierFromUnknown(job);
    expect(restored?.traceparent).toBe(job.trace?.traceparent);
  });

  it('keeps identifiers in attributes, not span names', () => {
    const store = startChildSpan('ui_agent.transition', {
      'vektre.run_id': 'run-1',
      'vektre.project_id': 'project-1',
    });
    expect(store.span.name).toBe('ui_agent.transition');
    expect(store.span.name).not.toContain('run-1');
    expect(store.span.attributes['vektre.run_id']).toBe('run-1');
  });

  it('exposes the current carrier from async local storage', () => {
    const store = startChildSpan('http.server');
    const carrier = runWithTraceStore(store, () => currentTraceCarrier());
    expect(carrier?.traceparent).toBe(serializeTraceparent(store.span.context));
    expect(createHash('sha256').update(carrier!.traceparent).digest('hex')).toHaveLength(64);
  });
});
