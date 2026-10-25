import { ConfigService } from '@nestjs/config';
import { TelemetryService } from './telemetry.service.js';
import { endSpan, startChildSpan } from './trace-context.js';

describe('TelemetryService', () => {
  it('allows product work to continue when exporters are down', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'));
    const service = new TelemetryService({
      get: () => ({
        serviceName: 'vektre-api',
        otlpTracesUrl: 'http://127.0.0.1:9/v1/traces',
        langfuseHost: 'http://127.0.0.1:9',
        langfusePublicKey: 'pk',
        langfuseSecretKey: 'sk',
        operatorContentCapture: false,
        exportTimeoutMs: 50,
      }),
    } as unknown as ConfigService);
    const store = startChildSpan('ui_agent.stage', { 'vektre.run_id': 'run-1' });
    endSpan(store.span);
    service.recordEndedSpan(store.span);
    await expect(service.flush()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('never enables content capture from a global flag alone', () => {
    const service = new TelemetryService({
      get: () => ({
        serviceName: 'vektre-api',
        otlpTracesUrl: '',
        langfuseHost: '',
        langfusePublicKey: '',
        langfuseSecretKey: '',
        operatorContentCapture: true,
        exportTimeoutMs: 50,
      }),
    } as unknown as ConfigService);
    expect(service.allowsContentCapture('project-1')).toBe(false);
    service.setProjectPolicy('project-1', {
      contentTraces: true,
      zeroRetention: false,
      allowPrivateAggregates: false,
    });
    expect(service.allowsContentCapture('project-1')).toBe(false);
    service.setProjectPolicy('project-1', {
      contentTraces: true,
      zeroRetention: false,
      allowPrivateAggregates: false,
      debugContentUntil: new Date(Date.now() + 60_000),
    });
    expect(service.allowsContentCapture('project-1')).toBe(true);
  });
});
