import type { ConfigService } from '@nestjs/config';
import type { AgentStageRequest } from '@markaschmidt/ui-builder-contracts';
import { ProviderError } from '../integrations/provider-error.model.js';
import { UiAiClient } from './ui-ai.client.js';
import type { UiModelPreset } from './ui-agent.capabilities.js';
import { runWithTraceStore, startChildSpan } from '../telemetry/trace-context.js';

describe('UiAiClient', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      enabled: true,
      url: 'https://worker.internal',
      apiKey: 'private-key',
      requestTimeoutMs: 10_000,
      promptVersion: 'prompt-v1',
      contextVersion: 'context-v1',
      priceTableVersion: 'prices-v1',
    }),
  };
  const preset: UiModelPreset = {
    id: 'ui-standard',
    label: 'Standard',
    tier: 'standard',
    capabilities: ['chat'],
    supportsText: true,
    supportsImages: false,
    supportsStructuredOutput: true,
    contextTokenLimit: 10_000,
    outputTokenLimit: 2_000,
    allowedDocumentKinds: ['screen'],
    allowedIntents: ['chat'],
    allowedVisibilities: ['private'],
    workerPolicy: { provider: 'openai', model: 'server-default' },
  };
  const request: AgentStageRequest = {
    schemaVersion: 1,
    promptVersion: 'prompt-v1',
    contextVersion: 'context-v1',
    stageExecutionId: 'stage-execution-1',
    runId: 'run-1',
    stage: 'understand',
    modelPresetId: 'ui-standard',
    contextManifest: {
      schemaVersion: 1,
      manifestId: 'manifest-1',
      runId: 'run-1',
      projectId: 'project-1',
      documentId: 'document-1',
      threadId: 'thread-1',
      actorId: 'actor-1',
      documentRevision: 'revision-1',
      documentHash: 'a'.repeat(64),
      modelPresetId: 'ui-standard',
      totalTokenBudget: 10_000,
      estimatedTokens: 0,
      sections: [
        {
          name: 'live_document',
          tokenBudget: 10_000,
          estimatedTokens: 0,
          sources: [],
        },
      ],
      generatedAt: new Date().toISOString(),
    },
    currentUISlice: {},
    priorStageArtifacts: [],
    imageReferences: [],
  };

  afterEach(() => jest.restoreAllMocks());

  it('sends only private service credentials and validates the result', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          stageExecutionId: request.stageExecutionId,
          runId: request.runId,
          stage: request.stage,
          result: { intent: 'chat' },
          citations: [],
          warnings: [],
          repairAttempts: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new UiAiClient(config as unknown as ConfigService);

    await expect(
      client.executeStage(request, preset, 'paid-call-key'),
    ).resolves.toEqual(expect.objectContaining({ runId: 'run-1' }));
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-API-Key']).toBe('private-key');
    expect(headers['X-Idempotency-Key']).toBe('paid-call-key');
    expect(headers['X-Vektre-Run-Id']).toBe('run-1');
    expect(headers['X-Vektre-Stage-Execution-Id']).toBe(
      request.stageExecutionId,
    );
  });

  it('propagates W3C traceparent to the private worker', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          stageExecutionId: request.stageExecutionId,
          runId: request.runId,
          stage: request.stage,
          result: {},
          citations: [],
          warnings: [],
          repairAttempts: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const store = startChildSpan('bullmq.process');
    const client = new UiAiClient(config as unknown as ConfigService);
    await runWithTraceStore(store, () =>
      client.executeStage(request, preset, 'paid-call-key'),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers.traceparent).toContain(store.span.context.traceId);
    expect(JSON.stringify(headers)).not.toMatch(/prompt-v1 combat/i);
  });

  it('accepts worker citations that use JSON null for omitted locator and excerpt', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          stageExecutionId: request.stageExecutionId,
          runId: request.runId,
          stage: request.stage,
          result: { intent: 'create' },
          citations: [
            {
              sourceId: 'doc-1',
              sourceKind: 'document',
              contentHash: 'b'.repeat(64),
              visibility: 'shared',
              label: 'Live HUD',
              locator: null,
              excerpt: null,
            },
          ],
          warnings: [],
          repairAttempts: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new UiAiClient(config as unknown as ConfigService);

    await expect(
      client.executeStage(request, preset, 'paid-call-key'),
    ).resolves.toEqual(
      expect.objectContaining({
        runId: 'run-1',
        citations: [
          expect.objectContaining({
            sourceId: 'doc-1',
            locator: null,
            excerpt: null,
          }),
        ],
      }),
    );
  });

  it('rejects worker output with a mismatched durable identity', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          stageExecutionId: 'different-stage',
          runId: request.runId,
          stage: request.stage,
          result: {},
          citations: [],
          warnings: [],
          repairAttempts: 0,
        }),
        { status: 200 },
      ),
    );
    const client = new UiAiClient(config as unknown as ConfigService);

    await expect(
      client.executeStage(request, preset, 'paid-call-key'),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
