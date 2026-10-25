import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TelemetryConfig } from '../config/telemetry.config.js';
import type { TraceAttributes } from './otel-attributes.js';
import { exportRedactedSpans } from './span-exporter.js';
import {
  currentTraceCarrier,
  currentTraceStore,
  endSpan,
  runWithTraceStore,
  setSpanAttributes,
  startChildSpan,
  storeFromCarrier,
  type ActiveSpan,
  type TraceStore,
} from './trace-context.js';
import {
  injectTraceHeaders,
  type W3cTraceCarrier,
} from './w3c-traceparent.js';

export interface TelemetryPolicy {
  contentTraces: boolean;
  zeroRetention: boolean;
  debugContentUntil?: Date;
  allowPrivateAggregates: boolean;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly pending: ActiveSpan[] = [];
  private readonly policies = new Map<string, TelemetryPolicy>();

  constructor(private readonly config: ConfigService) {}

  currentCarrier(): W3cTraceCarrier | undefined {
    return currentTraceCarrier();
  }

  injectOutboundHeaders(
    headers: Record<string, string> = {},
  ): Record<string, string> {
    return injectTraceHeaders(headers, this.currentCarrier());
  }

  setProjectPolicy(projectId: string, policy: TelemetryPolicy): void {
    this.policies.set(projectId, policy);
  }

  getProjectPolicy(projectId: string | undefined): TelemetryPolicy {
    if (!projectId) {
      return {
        contentTraces: false,
        zeroRetention: false,
        allowPrivateAggregates: false,
      };
    }
    return (
      this.policies.get(projectId) ?? {
        contentTraces: false,
        zeroRetention: false,
        allowPrivateAggregates: false,
      }
    );
  }

  allowsContentCapture(projectId: string | undefined): boolean {
    const cfg = this.cfg();
    const policy = this.getProjectPolicy(projectId);
    const debugOpen =
      policy.debugContentUntil != null &&
      policy.debugContentUntil.getTime() > Date.now();
    return Boolean(
      cfg.operatorContentCapture && policy.contentTraces && debugOpen,
    );
  }

  bindContext<T>(
    carrier: W3cTraceCarrier | undefined,
    name: string,
    attributes: TraceAttributes,
    fn: () => T,
  ): T {
    const store = storeFromCarrier(carrier, name, attributes);
    return runWithTraceStore(store, fn);
  }

  runWithCarrier<T>(
    carrier: W3cTraceCarrier | undefined,
    name: string,
    attributes: TraceAttributes,
    fn: () => T,
  ): T {
    const store = storeFromCarrier(carrier, name, attributes);
    return runWithTraceStore(store, () => {
      try {
        return fn();
      } finally {
        this.finish(store.span);
      }
    });
  }

  async runFromCarrier<T>(
    carrier: W3cTraceCarrier | undefined,
    name: string,
    attributes: TraceAttributes,
    fn: () => Promise<T>,
  ): Promise<T> {
    const store = storeFromCarrier(carrier, name, attributes);
    return runWithTraceStore(store, async () => {
      try {
        return await fn();
      } catch (error) {
        endSpan(store.span, 'error');
        throw error;
      } finally {
        this.finish(store.span);
      }
    });
  }

  async runSpan<T>(
    name: string,
    attributes: TraceAttributes,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const parent = currentTraceStore();
    const store = startChildSpan(name, attributes, parent);
    return runWithTraceStore(store, async () => {
      try {
        return await fn();
      } catch (error) {
        endSpan(store.span, 'error');
        throw error;
      } finally {
        this.finish(store.span);
      }
    });
  }

  addAttributes(attributes: TraceAttributes): void {
    const span = currentTraceStore()?.span;
    if (span) setSpanAttributes(span, attributes);
  }

  recordEndedSpan(span: ActiveSpan): void {
    this.finish(span);
  }

  async flush(): Promise<void> {
    const batch = this.pending.splice(0, this.pending.length);
    if (batch.length === 0) return;
    try {
      await exportRedactedSpans(batch, this.cfg());
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'telemetry_flush_failed',
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }

  private finish(span: ActiveSpan): void {
    endSpan(span, span.status, span.errorCategory);
    const projectId = span.attributes['vektre.project_id'];
    const policy = this.getProjectPolicy(
      typeof projectId === 'string' ? projectId : undefined,
    );
    if (policy.zeroRetention) return;
    this.pending.push(span);
    if (this.pending.length >= 32) {
      void this.flush();
    }
  }

  private cfg(): TelemetryConfig {
    return (
      this.config.get<TelemetryConfig>('telemetry') ?? {
        serviceName: 'vektre-api',
        otlpTracesUrl: '',
        langfuseHost: '',
        langfusePublicKey: '',
        langfuseSecretKey: '',
        operatorContentCapture: false,
        exportTimeoutMs: 5_000,
      }
    );
  }
}
