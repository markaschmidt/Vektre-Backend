import type { Job, JobsOptions, Queue } from 'bullmq';
import { TRACE_ATTR, TRACE_SPAN_NAMES } from './otel-attributes.js';
import {
  carrierFromUnknown,
  currentTraceCarrier,
  runWithTraceStore,
  storeFromCarrier,
} from './trace-context.js';
import type { W3cTraceCarrier } from './w3c-traceparent.js';
import { TelemetryService } from './telemetry.service.js';

export const TRACE_CARRIER_SCHEMA = {
  traceparent: true,
  tracestate: true,
} as const;

export function tracedJobData<T extends object>(data: T): T {
  const carrier = currentTraceCarrier();
  if (!carrier) return data;
  return { ...data, trace: carrier };
}

export async function addTracedJob<T extends object>(
  queue: Queue,
  name: string,
  data: T,
  opts?: JobsOptions,
): Promise<unknown> {
  return queue.add(name, tracedJobData(data), opts);
}

export async function runWithJobTrace<T>(
  job: Job,
  telemetry: TelemetryService | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const carrier: W3cTraceCarrier | undefined = carrierFromUnknown(job.data);
  const name = TRACE_SPAN_NAMES.bullmqProcess;
  const attributes = {
    [TRACE_ATTR.jobName]: job.name,
  };
  if (telemetry) {
    return telemetry.runFromCarrier(carrier, name, attributes, fn);
  }
  const store = storeFromCarrier(carrier, name, attributes);
  return runWithTraceStore(store, fn);
}
