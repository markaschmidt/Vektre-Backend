import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentStageRequestSchema,
  AgentStageResultSchema,
  AssistantTurnSchema,
  JsonValueSchema,
  ModelInvocationTelemetrySchema,
  buildEditorViewState,
  canonicalSha256,
  editorViewIssues,
  validateDocumentPatchProposal,
  validateVektreUIDocument,
  type AgentRun,
  type AgentStep,
  type AgentStageRequest,
  type AgentStageResult,
  type AssistantTurn,
  type DocumentPatchProposal,
  type JsonValue,
  type VektreUIDocumentV2,
} from '@markaschmidt/ui-builder-contracts';
import type { UiAiConfig } from '../config/ui-ai.config.js';
import { GenerationCostService } from '../generative-model/cost/generation-cost.service.js';
import { GenerativeModelService } from '../generative-model/generative-model.service.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { ProviderError } from '../integrations/provider-error.model.js';
import { SupabaseService } from '../integrations/supabase.js';
import { AssetsService } from '../projects/assets.service.js';
import {
  correlationAttributes,
  genAiAttributes,
  TRACE_SPAN_NAMES,
} from '../telemetry/otel-attributes.js';
import { sanitizeErrorCategory } from '../telemetry/redaction.js';
import { currentSpan } from '../telemetry/trace-context.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import { UiAgentQualityService } from './observability/ui-agent-quality.service.js';
import { normalizeContextManifest } from './context-manifest.js';
import {
  editorSubmissionFromArtifacts,
  editorSubmissionFromMessage,
  isModelFacingArtifact,
  referencedElementIds,
  selectionHintIds,
} from './editor-view-context.js';
import { UiContextAssembler } from './indexer/ui-context-assembler.js';
import { extractUiDocumentFromYjs } from './indexer/ui-document-extractor.js';
import type {
  UiAgentRunRow,
  UiAgentStepRow,
  UiAiMessageRow,
  UiDocumentRevisionRow,
} from './models/ui-agent.model.js';
import type {
  UiAgentAssetResumeJob,
  UiAgentTransitionJob,
} from './models/ui-agent-job.model.js';
import { UiContextRepository } from './repositories/ui-context.repository.js';
import { UiConversationRepository } from './repositories/ui-conversation.repository.js';
import { UiMemoryRepository } from './repositories/ui-memory.repository.js';
import {
  listUiModelPresets,
  type UiModelPreset,
} from './ui-agent.capabilities.js';
import { generateUiAgentId } from './ui-agent.ids.js';
import { UiAgentQueue } from './ui-agent.queue.js';
import { UiAiClient } from './ui-ai.client.js';

type AgentStage = AgentStep['stage'];

const NEXT_STAGE: Partial<
  Record<
    AgentStage,
    {
      stage: AgentStage;
      runStatus: AgentRun['status'];
    }
  >
> = {
  understand: { stage: 'propose_ux', runStatus: 'planning' },
  propose_ux: {
    stage: 'propose_visual',
    runStatus: 'generating_ux_visual',
  },
  propose_visual: { stage: 'analyze_references', runStatus: 'matching' },
  analyze_references: { stage: 'plan_patch', runStatus: 'composing' },
  plan_patch: { stage: 'match_compose', runStatus: 'composing' },
  match_compose: { stage: 'critique_validate', runStatus: 'validating' },
};

const STAGE_RUN_STATUS: Record<AgentStage, AgentRun['status']> = {
  understand: 'understanding',
  propose_ux: 'planning',
  propose_visual: 'generating_ux_visual',
  analyze_references: 'matching',
  plan_patch: 'composing',
  match_compose: 'composing',
  critique_validate: 'validating',
};

@Injectable()
export class UiAgentWorkflowService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UiAgentWorkflowService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly conversations: UiConversationRepository,
    private readonly memories: UiMemoryRepository,
    private readonly context: UiContextRepository,
    private readonly assembler: UiContextAssembler,
    private readonly assets: AssetsService,
    private readonly costs: GenerationCostService,
    private readonly generative: GenerativeModelService,
    private readonly queue: UiAgentQueue,
    private readonly worker: UiAiClient,
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    @Optional() private readonly telemetry?: TelemetryService,
    @Optional() private readonly quality?: UiAgentQualityService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const pending = await this.context.listPendingTransitionJobs();
      const awaitingAssets =
        await this.context.listRunsByStatus('awaiting_assets');
      const expired = await this.context.expireAbandonedRuns();
      await Promise.all([
        ...pending.map((job) =>
          this.queue.enqueueTransition({ kind: 'transition', ...job }),
        ),
        ...awaitingAssets.map(async (run) => {
          const source = (await this.context.listSteps(run.runId))
            .filter((step) => step.status === 'completed')
            .at(-1);
          if (!source) return;
          await this.queue.enqueueAssetResume({
            kind: 'asset_resume',
            projectId: run.projectId,
            documentId: run.documentId,
            runId: run.runId,
            sourceStageExecutionId: source.stageExecutionId,
          });
        }),
      ]);
      await Promise.all(expired.map((run) => this.updateActivity(run)));
      if (pending.length + awaitingAssets.length > 0) {
        this.logger.log(
          `Recovered ${pending.length} transitions and ${awaitingAssets.length} asset waits`,
        );
      }
    } catch (error) {
      this.logger.error(
        `UI-agent transition recovery failed: ${safeErrorMessage(error)}`,
      );
    }
  }

  async resumeRun(run: UiAgentRunRow): Promise<void> {
    const pending = (await this.context.listSteps(run.runId)).find(
      (step) => step.status === 'pending' || step.status === 'running',
    );
    if (!pending) return;
    await this.queue.enqueueTransition({
      kind: 'transition',
      projectId: run.projectId,
      documentId: run.documentId,
      runId: run.runId,
      stageExecutionId: pending.stageExecutionId,
    });
  }

  async resumeAfterClarification(
    run: UiAgentRunRow,
    message: UiAiMessageRow,
  ): Promise<UiAgentRunRow> {
    if (run.status !== 'awaiting_clarification') {
      throw new Error('Run is not awaiting clarification');
    }
    await this.rememberEditorSubmission(run, message);
    const payload = JsonValueSchema.parse({
      type: 'clarification',
      messageId: message.messageId,
      parts: message.parts,
      citations: message.citations,
      createdAt: message.createdAt.toISOString(),
    });
    const contentHash = canonicalSha256(payload);
    await this.context.saveStageArtifact({
      artifactId: `uiart_${contentHash.slice(0, 48)}`,
      runId: run.runId,
      projectId: run.projectId,
      documentId: run.documentId,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
      artifactKind: 'review',
      contentHash,
      payload,
    });
    return this.scheduleStage(run, 'understand', 'understanding', [
      'awaiting_clarification',
    ]);
  }

  async initializeRun(input: {
    run: UiAgentRunRow;
    message: UiAiMessageRow;
    revision: UiDocumentRevisionRow;
    preset: UiModelPreset;
    selectionHints?: string[];
  }): Promise<UiAgentRunRow> {
    const awaitingContext = await this.transition(
      input.run,
      ['created'],
      'awaiting_context',
    );
    try {
      await this.rememberEditorSubmission(awaitingContext, input.message);
      await this.rememberSelectionHints(
        awaitingContext,
        input.selectionHints ?? [],
      );
      const assembled = await this.assembler.assemble({
        runId: awaitingContext.runId,
        actorUserId: awaitingContext.actorUserId,
        projectId: awaitingContext.projectId,
        documentId: awaitingContext.documentId,
        threadId: awaitingContext.threadId!,
        messageParts: input.message.parts,
        explicitCitations: input.message.citations,
        revision: input.revision,
        modelPresetId: input.preset.id,
        totalTokenBudget: input.preset.contextTokenLimit,
        intent: awaitingContext.intent,
        selectionHints: input.selectionHints,
      });
      const normalized = normalizeContextManifest(
        assembled,
        awaitingContext.visibility,
      );
      await this.context.saveContextManifest({
        manifest: normalized.manifest,
        manifestHash: normalized.manifestHash,
        documentId: awaitingContext.documentId,
        threadId: awaitingContext.threadId,
        actorUserId: awaitingContext.actorUserId,
        ownerUserId: awaitingContext.ownerUserId,
        visibility: awaitingContext.visibility,
      });
      return this.scheduleStage(
        awaitingContext,
        'understand',
        'understanding',
        ['awaiting_context'],
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.provider === 'ui-agent-queue'
      ) {
        const persisted = await this.context.getRun(
          awaitingContext.projectId,
          awaitingContext.documentId,
          awaitingContext.runId,
        );
        if (persisted) return persisted;
      }
      await this.failRun(awaitingContext, 'context_assembly_failed', error);
      throw error;
    }
  }

  async processTransition(
    job: UiAgentTransitionJob,
    finalAttempt: boolean,
  ): Promise<void> {
    const run = await this.context.getRun(
      job.projectId,
      job.documentId,
      job.runId,
    );
    const step = await this.context.getStepByStageExecution(
      job.stageExecutionId,
    );
    if (!run || !step || step.runId !== run.runId) {
      throw new Error('UI-agent transition state not found');
    }
    this.telemetry?.addAttributes(
      correlationAttributes({
        projectId: run.projectId,
        documentId: run.documentId,
        threadId: run.threadId,
        runId: run.runId,
        requestId: run.requestId,
        activityId: run.activityId,
        stageExecutionId: step.stageExecutionId,
        modelPresetId: run.modelPresetId,
        visibility: run.visibility,
      }),
    );
    if (isTerminal(run.status)) return;
    if (step.status === 'completed') {
      const steps = await this.context.listSteps(run.runId);
      const stepIndex = steps.findIndex(
        (candidate) => candidate.stepId === step.stepId,
      );
      const later = stepIndex >= 0 ? steps[stepIndex + 1] : undefined;
      if (later && later.status === 'pending') {
        await this.queue.enqueueTransition({
          kind: 'transition',
          projectId: run.projectId,
          documentId: run.documentId,
          runId: run.runId,
          stageExecutionId: later.stageExecutionId,
        });
        return;
      }
      if (later) return;
      if (run.status === 'awaiting_assets' && step.outputRef) {
        const output = await this.context.getStageArtifact(step.outputRef);
        const parsed = output
          ? AgentStageResultSchema.safeParse(output.payload)
          : undefined;
        const turn = parsed?.success
          ? AssistantTurnSchema.safeParse(parsed.data.result)
          : undefined;
        if (turn?.success) {
          const planned = await this.context.listAssetRequests(run.runId);
          await this.enqueueMissingAssets(run, turn.data, planned);
          await this.queue.enqueueAssetResume({
            kind: 'asset_resume',
            projectId: run.projectId,
            documentId: run.documentId,
            runId: run.runId,
            sourceStageExecutionId: step.stageExecutionId,
          });
        }
        return;
      }
      if (run.status !== STAGE_RUN_STATUS[step.stage]) return;
      if (!step.outputRef) return;
      const output = await this.context.getStageArtifact(step.outputRef);
      if (output) {
        await this.advanceAfterStage(
          run,
          step,
          AgentStageResultSchema.parse(output.payload),
        );
      }
      return;
    }

    try {
      const claimed = await this.context.claimStep(step.stageExecutionId);
      if (!claimed) return;
      const request = await this.loadOrCreateStageRequest(run, claimed);
      const preset = this.requirePreset(run.modelPresetId);
      const startedAt = Date.now();
      const result = await (this.telemetry
        ? this.telemetry.runSpan(
            TRACE_SPAN_NAMES.uiAgentStage,
            correlationAttributes({
              projectId: run.projectId,
              documentId: run.documentId,
              threadId: run.threadId,
              runId: run.runId,
              requestId: run.requestId,
              activityId: run.activityId,
              stageExecutionId: claimed.stageExecutionId,
              modelPresetId: run.modelPresetId,
            }),
            () =>
              this.worker.executeStage(
                request,
                preset,
                claimed.idempotencyKey,
              ),
          )
        : this.worker.executeStage(request, preset, claimed.idempotencyKey));
      const output = await this.context.saveStageArtifact({
        artifactId: generateUiAgentId('uiart'),
        runId: run.runId,
        stepId: claimed.stepId,
        projectId: run.projectId,
        documentId: run.documentId,
        ownerUserId: run.ownerUserId,
        visibility: run.visibility,
        artifactKind: 'stage_output',
        contentHash: canonicalSha256(result),
        payload: JsonValueSchema.parse(result),
      });
      await this.context.completeStep({
        stageExecutionId: claimed.stageExecutionId,
        outputRef: output.artifactId,
        usage: result.usage,
      });
      await this.recordUsage(
        run,
        claimed,
        result,
        preset,
        Date.now() - startedAt,
      );
      await this.advanceAfterStage(run, claimed, result);
    } catch (error) {
      if (error instanceof ProviderError && error.retryable && !finalAttempt) {
        throw error;
      }
      await this.context.failStep({
        stageExecutionId: step.stageExecutionId,
        errorCode: errorCode(error),
        errorMessage: safeErrorMessage(error),
      });
      this.telemetry?.addAttributes({
        'error.category': sanitizeErrorCategory(error),
      });
      await this.failRun(run, errorCode(error), error);
      if (error instanceof ProviderError && error.retryable) throw error;
    }
  }

  async processAssetResume(
    job: UiAgentAssetResumeJob,
    finalAttempt: boolean,
  ): Promise<void> {
    const run = await this.context.getRun(
      job.projectId,
      job.documentId,
      job.runId,
    );
    if (!run || run.status !== 'awaiting_assets') return;
    const step = await this.context.getStepByStageExecution(
      job.sourceStageExecutionId,
    );
    if (!step?.outputRef) {
      await this.failRun(
        run,
        'asset_resume_state_missing',
        'Stage output missing',
      );
      return;
    }
    const output = await this.context.getStageArtifact(step.outputRef);
    const parsedOutput = output
      ? AgentStageResultSchema.safeParse(output.payload)
      : undefined;
    const parsedTurn = parsedOutput?.success
      ? AssistantTurnSchema.safeParse(parsedOutput.data.result)
      : undefined;
    if (!output || !parsedOutput?.success || !parsedTurn?.success) {
      await this.failRun(
        run,
        'asset_resume_state_missing',
        'Stage output invalid',
      );
      return;
    }
    const requests = await this.context.listAssetRequests(run.runId);
    if (requests.length === 0) {
      await this.failRun(
        run,
        'asset_resume_state_missing',
        'Asset plan missing',
      );
      return;
    }
    await this.enqueueMissingAssets(run, parsedTurn.data, requests);
    for (const request of requests) {
      const status = await this.appData.getRequestStatus(request.requestId);
      if (
        !status ||
        ['pending', 'queued', 'processing'].includes(status.status)
      ) {
        if (!finalAttempt) {
          throw ProviderError.retryable(
            'ui-agent-assets',
            'Generated assets are not terminal',
          );
        }
        await this.context.updateAssetRequest({
          requestId: request.requestId,
          status: 'failed',
          errorMessage: 'Timed out waiting for generated asset',
        });
        await this.failRun(
          run,
          'asset_generation_timeout',
          'Timed out waiting for generated assets',
        );
        return;
      }
      if (status.status === 'failed' || status.status === 'cancelled') {
        await this.context.updateAssetRequest({
          requestId: request.requestId,
          status: status.status,
          errorMessage: status.errorMessage,
        });
        await this.failRun(
          run,
          'asset_generation_failed',
          status.errorMessage ?? 'Required asset generation failed',
        );
        return;
      }
      const asset = await this.appData.getProjectAssetByRequestId(
        run.projectId,
        request.requestId,
      );
      if (!asset || asset.status !== 'ready') {
        if (!finalAttempt) {
          throw ProviderError.retryable(
            'ui-agent-assets',
            'Generated asset has not materialized',
          );
        }
        await this.failRun(
          run,
          'asset_materialization_failed',
          'Generated asset did not materialize',
        );
        return;
      }
      await this.context.updateAssetRequest({
        requestId: request.requestId,
        status: 'completed',
        assetId: asset.assetId,
      });
    }
    const completed = await this.context.listAssetRequests(run.runId);
    await this.context.saveStageArtifact({
      artifactId: generateUiAgentId('uiart'),
      runId: run.runId,
      stepId: step.stepId,
      projectId: run.projectId,
      documentId: run.documentId,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
      artifactKind: 'asset_result',
      contentHash: canonicalSha256(
        completed.map((request) => ({
          requestKey: request.requestKey,
          assetId: request.assetId,
          role: request.assetRole,
        })),
      ),
      payload: JsonValueSchema.parse({
        assets: completed.map((request) => ({
          requestKey: request.requestKey,
          assetId: request.assetId,
          role: request.assetRole,
        })),
      }),
    });
    await this.advanceAfterStage(run, step, parsedOutput.data, true);
    if (run.activityId) {
      const activity = await this.appData.getCollaborationActivity(
        run.activityId,
      );
      await this.appData.updateCollaborationActivity(run.activityId, {
        result: {
          ...(activity?.result ?? {}),
          assets: completed.map((request) => ({
            requestKey: request.requestKey,
            assetId: request.assetId,
            role: request.assetRole,
          })),
        },
      });
    }
  }

  async bestEffortCancelWorker(runId: string): Promise<void> {
    await this.worker.cancelRun(runId);
  }

  async loadFrozenGuiDocument(
    revision: UiDocumentRevisionRow,
  ): Promise<VektreUIDocumentV2 | null> {
    if (!revision.snapshotId) return null;
    try {
      const snapshot = await this.appData.getCollaborationSnapshotById(
        revision.snapshotId,
      );
      if (
        !snapshot ||
        snapshot.documentKey !== revision.documentKey ||
        snapshot.documentId !== revision.documentId
      ) {
        return null;
      }
      const storage = parseStorageRef(snapshot.storageRef);
      const bytes = await this.supabase.downloadObject(
        storage.objectPath,
        storage.bucket,
      );
      const extracted = extractUiDocumentFromYjs({
        bytes: new Uint8Array(bytes),
        projectId: revision.projectId,
        documentId: revision.documentId,
      });
      if (extracted.documentHash !== revision.documentHash) return null;
      return extracted.document;
    } catch (error) {
      this.logger.warn(
        `Frozen GUI snapshot could not be loaded: ${safeErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async rememberEditorSubmission(
    run: UiAgentRunRow,
    message: UiAiMessageRow,
  ): Promise<void> {
    const submission = editorSubmissionFromMessage(message);
    if (!submission) return;
    const payload = JsonValueSchema.parse(
      JSON.parse(
        JSON.stringify({
          type: 'editor_view_submission',
          view: submission,
        }),
      ),
    );
    await this.context.saveStageArtifact({
      artifactId: generateUiAgentId('uiart'),
      runId: run.runId,
      projectId: run.projectId,
      documentId: run.documentId,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
      artifactKind: 'review',
      contentHash: canonicalSha256(payload),
      payload,
    });
  }

  private async rememberSelectionHints(
    run: UiAgentRunRow,
    selectionHints: string[],
  ): Promise<void> {
    if (selectionHints.length === 0) return;
    const payload = JsonValueSchema.parse({
      type: 'selection_hints',
      ids: selectionHints,
    });
    await this.context.saveStageArtifact({
      artifactId: generateUiAgentId('uiart'),
      runId: run.runId,
      projectId: run.projectId,
      documentId: run.documentId,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
      artifactKind: 'review',
      contentHash: canonicalSha256(payload),
      payload,
    });
  }

  private async buildCurrentUiSlice(input: {
    revision: UiDocumentRevisionRow;
    manifest: AgentStageRequest['contextManifest'];
    message: UiAiMessageRow | null;
    artifacts: Awaited<ReturnType<UiContextRepository['listStageArtifacts']>>;
  }): Promise<JsonValue> {
    const legacy = {
      documentHash: input.revision.documentHash,
      structuralDigest: input.revision.structuralDigest,
      layoutFingerprints: input.revision.layoutFingerprints,
    };
    const document = await this.loadFrozenGuiDocument(input.revision);
    if (!document) return legacy;
    const submission =
      editorSubmissionFromArtifacts(input.artifacts) ??
      editorSubmissionFromMessage(input.message);
    if (submission) {
      const issues = editorViewIssues({
        document,
        documentHash: input.revision.documentHash,
        submission,
      });
      if (issues.length > 0) {
        throw ProviderError.permanent('ui-agent', issues[0].message);
      }
    }
    try {
      return JsonValueSchema.parse(
        buildEditorViewState({
          document,
          documentHash: input.revision.documentHash,
          documentRevision: input.revision.revisionId,
          fieldOfView: submission?.fieldOfView,
          extraIds: [
            ...(submission?.fieldOfView.selectedIds ?? []),
            ...selectionHintIds(input.artifacts),
            ...referencedElementIds(input.message, input.manifest),
          ],
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Editor view fell back to layout fingerprints: ${safeErrorMessage(error)}`,
      );
      return legacy;
    }
  }

  private async loadOrCreateStageRequest(
    run: UiAgentRunRow,
    step: UiAgentStepRow,
  ): Promise<AgentStageRequest> {
    if (step.inputRef) {
      const existing = await this.context.getStageArtifact(step.inputRef);
      if (existing) return AgentStageRequestSchema.parse(existing.payload);
    }
    const [manifestRow, revision, priorArtifacts, message] = await Promise.all([
      this.context.getContextManifestByRun(
        run.projectId,
        run.documentId,
        run.runId,
      ),
      run.frozenRevisionId
        ? this.context.getDocumentRevision(run.frozenRevisionId)
        : Promise.resolve(null),
      this.context.listStageArtifacts(run.runId),
      run.threadId && run.messageId
        ? this.conversations.getMessage(
            run.projectId,
            run.threadId,
            run.messageId,
          )
        : Promise.resolve(null),
    ]);
    if (!manifestRow || !revision) {
      throw ProviderError.permanent(
        'vektre-ai',
        'Frozen run context is unavailable',
      );
    }
    const imageReferences = await Promise.all(
      (message?.parts ?? [])
        .filter(
          (
            part,
          ): part is Extract<
            UiAiMessageRow['parts'][number],
            { type: 'image_asset' }
          > => part.type === 'image_asset',
        )
        .map(async (part) => {
          const asset = await this.assets.resolveAccessibleAsset(
            run.actorUserId,
            part.assetId,
          );
          if (asset.projectId !== run.projectId) {
            throw ProviderError.permanent(
              'vektre-ai',
              'Image reference is outside the run project',
            );
          }
          return {
            assetId: asset.assetId,
            url: await this.assets.createSignedDownloadUrlForAsset(asset, 900),
            contentHash: part.contentHash,
          };
        }),
    );
    const cfg = this.config.getOrThrow<UiAiConfig>('uiAi');
    const request = AgentStageRequestSchema.parse({
      schemaVersion: 1,
      promptVersion: cfg.promptVersion,
      contextVersion: cfg.contextVersion,
      stageExecutionId: step.stageExecutionId,
      runId: run.runId,
      stage: step.stage,
      modelPresetId: run.modelPresetId,
      contextManifest: manifestRow.manifest,
      currentUISlice: await this.buildCurrentUiSlice({
        revision,
        manifest: manifestRow.manifest,
        message,
        artifacts: priorArtifacts,
      }),
      priorStageArtifacts: priorArtifacts
        .filter(isModelFacingArtifact)
        .slice(-64)
        .map((item) => item.payload),
      imageReferences,
    });
    const artifact = await this.context.saveStageArtifact({
      artifactId: generateUiAgentId('uiart'),
      runId: run.runId,
      stepId: step.stepId,
      projectId: run.projectId,
      documentId: run.documentId,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
      artifactKind: 'stage_input',
      contentHash: canonicalSha256(request),
      payload: JsonValueSchema.parse(request),
    });
    await this.context.setStepInputRef(
      step.stageExecutionId,
      artifact.artifactId,
    );
    return request;
  }

  private async advanceAfterStage(
    run: UiAgentRunRow,
    step: UiAgentStepRow,
    result: AgentStageResult,
    assetsResolved = false,
  ): Promise<void> {
    const maybeTurn = AssistantTurnSchema.safeParse(result.result);
    if (
      !assetsResolved &&
      maybeTurn.success &&
      maybeTurn.data.assetPlan.length > 0
    ) {
      await this.suspendForAssets(run, step, maybeTurn.data);
      return;
    }
    if (maybeTurn.success && maybeTurn.data.clarifyingQuestion) {
      await this.appendAssistantTurn(run, maybeTurn.data);
      await this.transition(
        run,
        [run.status],
        'awaiting_clarification',
        maybeTurn.data,
      );
      return;
    }
    const next = NEXT_STAGE[step.stage];
    if (next) {
      await this.scheduleStage(run, next.stage, next.runStatus, [run.status]);
      return;
    }
    if (step.stage !== 'critique_validate') {
      throw ProviderError.permanent(
        'vektre-ai',
        `Unsupported terminal stage ${step.stage}`,
      );
    }
    const turn = AssistantTurnSchema.parse(result.result);
    this.validateAssistantTurn(run, turn);
    await this.appendAssistantTurn(run, turn);
    await this.persistMemoryProposals(run, turn);
    if (turn.matchReview) {
      await this.quality?.record({
        run,
        metricKind: 'review_required',
        metricValue: turn.matchReview.requiresReview ? 1 : 0,
      });
      const recommended = turn.matchReview.alternatives.find(
        (item) => item.alternativeId === turn.matchReview?.recommendedAlternativeId,
      );
      await this.quality?.record({
        run,
        metricKind: 'solver_feasible',
        metricValue: recommended?.feasible === false ? 0 : 1,
      });
      if (recommended) {
        await this.quality?.record({
          run,
          metricKind: 'solver_confidence',
          metricValue: recommended.totalScore,
        });
      }
    }
    if (turn.documentProposal?.type === 'patch') {
      const preserved = turn.documentProposal.patch.intentionallyPreservedPaths.length;
      await this.quality?.record({
        run,
        metricKind: 'untouched_field_preservation',
        metricValue: preserved,
      });
      await this.quality?.record({
        run,
        metricKind: 'field_conflict',
        metricValue: turn.documentProposal.patch.conflicts.length,
      });
    }

    const latest = await this.context.getLatestDocumentRevision(
      run.documentKey,
    );
    let finalTurn = turn;
    if (
      turn.documentProposal &&
      latest &&
      latest.documentHash !== run.baseDocumentHash
    ) {
      const rebased = await this.tryRebasePatch(run, turn, latest);
      await this.quality?.record({
        run,
        metricKind: 'stale_rebase',
        metricValue: rebased ? 0 : 1,
      });
      if (!rebased) {
        await this.transition(
          run,
          [run.status],
          'needs_rebase',
          turn,
          canonicalSha256(turn.documentProposal),
        );
        return;
      }
      finalTurn = rebased;
      await this.context.updateRunRebaseBase({
        runId: run.runId,
        documentHash: latest.documentHash,
        revisionId: latest.revisionId,
      });
    }
    const proposalHash = finalTurn.documentProposal
      ? canonicalSha256(finalTurn.documentProposal)
      : undefined;
    await this.transition(
      run,
      [run.status],
      nextStatusAfterCritique(finalTurn),
      finalTurn,
      proposalHash,
    );
  }

  private async tryRebasePatch(
    run: UiAgentRunRow,
    turn: AssistantTurn,
    latest: UiDocumentRevisionRow,
  ): Promise<AssistantTurn | undefined> {
    if (turn.documentProposal?.type !== 'patch' || !latest.snapshotId) {
      return undefined;
    }
    try {
      const snapshot = await this.appData.getCollaborationSnapshotById(
        latest.snapshotId,
      );
      if (
        !snapshot ||
        snapshot.documentKey !== run.documentKey ||
        snapshot.documentId !== run.documentId
      ) {
        return undefined;
      }
      const storage = parseStorageRef(snapshot.storageRef);
      const bytes = await this.supabase.downloadObject(
        storage.objectPath,
        storage.bucket,
      );
      const live = extractUiDocumentFromYjs({
        bytes: new Uint8Array(bytes),
        projectId: run.projectId,
        documentId: run.documentId,
      }).document;
      if (!patchPreconditionsStillHold(turn.documentProposal.patch, live)) {
        return undefined;
      }
      return AssistantTurnSchema.parse({
        ...turn,
        documentProposal: {
          type: 'patch',
          patch: {
            ...turn.documentProposal.patch,
            baseDocumentHash: latest.documentHash,
            baseRevision: latest.revisionId,
          },
        },
      });
    } catch {
      return undefined;
    }
  }

  private async suspendForAssets(
    run: UiAgentRunRow,
    step: UiAgentStepRow,
    turn: AssistantTurn,
  ): Promise<void> {
    const planned = await Promise.all(
      turn.assetPlan.map(async (item) => {
        const digest = canonicalSha256({
          runId: run.runId,
          requestKey: item.requestKey,
        }).slice(0, 48);
        return this.context.upsertAssetRequest({
          requestId: `uiassetreq_${digest}`,
          runId: run.runId,
          stepId: step.stepId,
          projectId: run.projectId,
          requestKey: item.requestKey,
          assetRole: item.role,
          preferredAssetId: `uiasset_${digest}`,
        });
      }),
    );
    const awaiting = await this.transition(
      run,
      [run.status],
      'awaiting_assets',
      turn,
    );
    await this.enqueueMissingAssets(run, turn, planned);
    try {
      await this.queue.enqueueAssetResume({
        kind: 'asset_resume',
        projectId: awaiting.projectId,
        documentId: awaiting.documentId,
        runId: awaiting.runId,
        sourceStageExecutionId: step.stageExecutionId,
      });
    } catch (error) {
      throw ProviderError.retryable(
        'ui-agent-queue',
        `Asset resume was persisted but could not be enqueued: ${safeErrorMessage(error)}`,
      );
    }
  }

  private async enqueueMissingAssets(
    run: UiAgentRunRow,
    turn: AssistantTurn,
    planned: Awaited<ReturnType<UiContextRepository['listAssetRequests']>>,
  ): Promise<void> {
    for (const item of turn.assetPlan) {
      const request = planned.find(
        (candidate) => candidate.requestKey === item.requestKey,
      );
      if (!request) continue;
      if (await this.appData.getRequestStatus(request.requestId)) continue;
      await this.generative.enqueueConceptArt({
        requestId: request.requestId,
        userId: run.actorUserId,
        prompt: item.prompt,
        projectId: run.projectId,
        runId: run.runId,
        preferredAssetId: request.preferredAssetId,
        surface: 'gui_screen',
        actionKind: `ui_agent_${item.role}`,
      });
    }
  }

  private validateAssistantTurn(run: UiAgentRunRow, turn: AssistantTurn): void {
    if (
      run.visibility === 'shared' &&
      (turn.citations.some((citation) => citation.visibility === 'private') ||
        turn.memoryProposals.some(
          (proposal) => proposal.visibility === 'private',
        ))
    ) {
      throw ProviderError.permanent(
        'vektre-ai',
        'Worker attempted to expose private content in a shared run',
      );
    }
    if (turn.documentProposal?.type === 'full_document') {
      const issues = validateVektreUIDocument(turn.documentProposal.document);
      if (issues.length > 0) {
        throw ProviderError.permanent(
          'vektre-ai',
          `Generated document failed semantic validation: ${issues
            .slice(0, 8)
            .map((issue) => issue.code)
            .join(', ')}`,
        );
      }
    }
    if (turn.documentProposal?.type === 'patch') {
      const patch = turn.documentProposal.patch;
      if (
        patch.runId !== run.runId ||
        patch.baseDocumentHash !== run.baseDocumentHash ||
        (patch.activityId && patch.activityId !== run.activityId)
      ) {
        throw ProviderError.permanent(
          'vektre-ai',
          'Patch proposal identity or base document does not match the run',
        );
      }
      const issues = validateDocumentPatchProposal(patch);
      if (issues.length > 0) {
        throw ProviderError.permanent(
          'vektre-ai',
          `Patch proposal failed semantic validation: ${issues
            .slice(0, 8)
            .map((issue) => issue.code)
            .join(', ')}`,
        );
      }
    }
  }

  private async appendAssistantTurn(
    run: UiAgentRunRow,
    turn: AssistantTurn,
  ): Promise<void> {
    if (!run.threadId) return;
    const thread = await this.conversations.getThread(
      run.projectId,
      run.documentId,
      run.threadId,
    );
    if (!thread) return;
    const text = turn.clarifyingQuestion ?? turn.text;
    if (!text && turn.citations.length === 0) return;
    await this.conversations.appendMessage({
      messageId: generateUiAgentId('uimsg'),
      thread,
      actorUserId: 'vektre-ai',
      role: 'assistant',
      parts: [{ type: 'text', text }],
      citations: turn.citations,
    });
  }

  private async persistMemoryProposals(
    run: UiAgentRunRow,
    turn: AssistantTurn,
  ): Promise<void> {
    await Promise.all(
      turn.memoryProposals.map((proposal) =>
        this.memories.createMemory({
          memoryId: generateUiAgentId('uimem'),
          projectId: run.projectId,
          documentId: run.documentId,
          threadId: run.threadId,
          ownerUserId: run.ownerUserId,
          kind: proposal.kind,
          scope: proposal.scope,
          scopeId: proposal.scopeId,
          text: proposal.text,
          structuredValue: proposal.structuredValue,
          visibility: run.visibility,
          pinned: false,
          provenance: {
            sourceKind: 'run',
            sourceId: run.runId,
            actorId: run.actorUserId,
            documentRevision: run.frozenRevisionId,
          },
        }),
      ),
    );
  }

  private async scheduleStage(
    run: UiAgentRunRow,
    stage: AgentStage,
    status: AgentRun['status'],
    expectedStatuses: AgentRun['status'][],
  ): Promise<UiAgentRunRow> {
    const stageExecutionId = generateUiAgentId('uiexec');
    await this.context.createStep({
      stepId: generateUiAgentId('uistep'),
      runId: run.runId,
      projectId: run.projectId,
      stageExecutionId,
      stage,
      attempt: 1,
      idempotencyKey: canonicalSha256({
        runId: run.runId,
        stage,
        stageExecutionId,
      }),
      status: 'pending',
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
    });
    const transitioned = await this.transition(run, expectedStatuses, status);
    try {
      await this.queue.enqueueTransition({
        kind: 'transition',
        projectId: run.projectId,
        documentId: run.documentId,
        runId: run.runId,
        stageExecutionId,
      });
    } catch (error) {
      throw ProviderError.retryable(
        'ui-agent-queue',
        `Transition was persisted but could not be enqueued: ${safeErrorMessage(error)}`,
      );
    }
    return transitioned;
  }

  private async transition(
    run: UiAgentRunRow,
    expectedStatuses: AgentRun['status'][],
    status: AgentRun['status'],
    result?: JsonValue,
    proposalHash?: string,
  ): Promise<UiAgentRunRow> {
    const changed = await this.context.transitionRun({
      runId: run.runId,
      expectedStatuses,
      status,
      result,
      proposalHash,
    });
    if (!changed) {
      const current = await this.context.getRun(
        run.projectId,
        run.documentId,
        run.runId,
      );
      if (current?.status === status) return current;
      throw new Error(
        `Run ${run.runId} cannot transition from ${run.status} to ${status}`,
      );
    }
    await this.updateActivity(changed);
    return changed;
  }

  private async failRun(
    run: UiAgentRunRow,
    code: string,
    error: unknown,
  ): Promise<void> {
    const current = await this.context.getRun(
      run.projectId,
      run.documentId,
      run.runId,
    );
    if (!current || isTerminal(current.status)) return;
    const failed = await this.context.transitionRun({
      runId: run.runId,
      expectedStatuses: [current.status],
      status: 'failed',
      errorCode: code,
      errorMessage: safeErrorMessage(error),
    });
    if (failed) await this.updateActivity(failed);
  }

  private async updateActivity(run: UiAgentRunRow): Promise<void> {
    if (!run.activityId) return;
    // Product pause states remain `running` in collaboration_activity; the
    // precise awaiting_review/needs_rebase status is carried in runStatus.
    const terminal = isTerminal(run.status);
    await this.appData.updateCollaborationActivity(run.activityId, {
      status:
        run.status === 'failed'
          ? 'failed'
          : run.status === 'cancelled'
            ? 'cancelled'
            : terminal
              ? 'completed'
              : 'running',
      result: {
        runId: run.runId,
        threadId: run.threadId,
        messageId: run.messageId,
        runStatus: run.status,
        progress: runProgress(run.status),
        proposal: run.result,
        proposalHash: run.proposalHash,
      },
      errorMessage: run.errorMessage,
    });
  }

  private async recordUsage(
    run: UiAgentRunRow,
    step: UiAgentStepRow,
    result: AgentStageResult,
    preset: UiModelPreset,
    latencyMs: number,
  ): Promise<void> {
    if (!result.usage) return;
    const cfg = this.config.getOrThrow<UiAiConfig>('uiAi');
    const estimatedCostUsd =
      result.usage.providerCostUsd ??
      estimateTextCost(result.usage.inputTokens, result.usage.outputTokens);
    const telemetry = ModelInvocationTelemetrySchema.parse({
      invocationId: generateUiAgentId('uiinv'),
      projectId: run.projectId,
      documentId: run.documentId,
      threadId: run.threadId ?? run.runId,
      runId: run.runId,
      stageExecutionId: step.stageExecutionId,
      stage: step.stage,
      actorId: run.actorUserId,
      gateway: preset.workerPolicy.provider,
      requestedModel: preset.workerPolicy.model,
      actualModel: result.usage.model,
      promptVersion: cfg.promptVersion,
      schemaVersion: '1',
      contextManifestVersion: cfg.contextVersion,
      usage: result.usage,
      estimatedCostUsd,
      priceTableVersion: cfg.priceTableVersion,
      latencyMs,
      retryCount: Math.max(0, step.attempt - 1),
      repairAttempts: result.repairAttempts,
      outcome: 'completed',
      createdAt: new Date().toISOString(),
      modelPresetId: run.modelPresetId ?? preset.id,
      imageCount: result.usage.imageInputTokens > 0 ? 1 : undefined,
      cacheWriteTokens: 0,
      traceId: currentSpan()?.context.traceId,
      spanId: currentSpan()?.context.spanId,
    });
    await this.context.recordModelInvocation({
      telemetry,
      threadId: run.threadId,
      runId: run.runId,
      stepId: step.stepId,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
    });
    this.telemetry?.addAttributes(
      genAiAttributes({
        provider: result.usage.provider,
        requestedModel: preset.workerPolicy.model,
        actualModel: result.usage.model,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        imageInputTokens: result.usage.imageInputTokens,
        outputTokens: result.usage.outputTokens,
        reasoningTokens: result.usage.reasoningTokens,
        latencyMs,
        retryCount: Math.max(0, step.attempt - 1),
        repairAttempts: result.repairAttempts,
      }),
    );
    await this.costs.recordUsage({
      requestId: step.stageExecutionId,
      projectId: run.projectId,
      actorUserId: run.actorUserId,
      provider: preset.workerPolicy.provider,
      modelId: result.usage.model,
      surface: 'gui_screen',
      actionKind: step.stage,
      requestType: 'ui_agent_stage',
      usage: {
        text: {
          inputTokens: result.usage.inputTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
          imageInputTokens: result.usage.imageInputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          providerCostUsd: result.usage.providerCostUsd,
        },
      },
      estimatedCostUsd,
      documentId: run.documentId,
      threadId: run.threadId,
      runId: run.runId,
      stage: step.stage,
      providerRequestId: result.usage.providerRequestId,
      requestedModel: preset.workerPolicy.model,
      actualModel: result.usage.model,
      modelPresetId: run.modelPresetId ?? preset.id,
      promptVersion: cfg.promptVersion,
      schemaVersion: '1',
      contextManifestVersion: cfg.contextVersion,
      providerCostUsd: result.usage.providerCostUsd,
      priceTableVersion: cfg.priceTableVersion,
      latencyMs,
      retryCount: Math.max(0, step.attempt - 1),
      repairAttempts: result.repairAttempts,
      outcome: 'completed',
    });
    await this.quality?.record({
      run,
      metricKind: 'first_pass_valid',
      metricValue: result.repairAttempts === 0 ? 1 : 0,
      promptVersion: cfg.promptVersion,
      schemaVersion: '1',
    });
    await this.quality?.record({
      run,
      metricKind: 'repair_attempts',
      metricValue: result.repairAttempts,
      promptVersion: cfg.promptVersion,
      schemaVersion: '1',
    });
    if (result.repairAttempts > 0) {
      await this.quality?.record({
        run,
        metricKind: 'repair_success',
        metricValue: 1,
        promptVersion: cfg.promptVersion,
      });
    }
  }

  private requirePreset(id: string | undefined): UiModelPreset {
    const preset = listUiModelPresets().find((item) => item.id === id);
    if (!preset) {
      throw ProviderError.permanent(
        'vektre-ai',
        'Run references a disabled model preset',
      );
    }
    return preset;
  }
}

export function matchReviewNeedsDecision(review: {
  requiresReview?: boolean;
  alternatives?: Array<{
    candidates?: Array<{
      functionalNodeId?: string;
      visualNodeId?: string;
    }>;
  }>;
} | null | undefined): boolean {
  if (!review?.requiresReview) return false;
  return (review.alternatives ?? []).some((alternative) =>
    (alternative.candidates ?? []).some(
      (candidate) =>
        isRealMatchNode(candidate.functionalNodeId) &&
        isRealMatchNode(candidate.visualNodeId),
    ),
  );
}

function isRealMatchNode(id: string | undefined): boolean {
  return typeof id === 'string' && id.length > 0 && id !== 'none';
}

export function nextStatusAfterCritique(turn: {
  matchReview?: {
    requiresReview?: boolean;
    alternatives?: Array<{
      candidates?: Array<{
        functionalNodeId?: string;
        visualNodeId?: string;
      }>;
    }>;
  } | null;
}): 'awaiting_review' | 'completed' {
  return matchReviewNeedsDecision(turn.matchReview)
    ? 'awaiting_review'
    : 'completed';
}

function isTerminal(status: AgentRun['status']): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

function errorCode(error: unknown): string {
  if (error instanceof ProviderError) {
    return error.retryable ? 'worker_unavailable' : 'worker_result_invalid';
  }
  return 'ui_agent_transition_failed';
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2048);
}

function estimateTextCost(inputTokens: number, outputTokens: number): number {
  const inputRate = Number(process.env.COST_OPENAI_TEXT_INPUT_PER_1M ?? 5);
  const outputRate = Number(process.env.COST_OPENAI_TEXT_OUTPUT_PER_1M ?? 15);
  return Math.max(
    0,
    Math.round(
      ((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000) * 1e8,
    ) / 1e8,
  );
}

function runProgress(status: AgentRun['status']): number {
  const order: AgentRun['status'][] = [
    'created',
    'awaiting_context',
    'understanding',
    'awaiting_clarification',
    'planning',
    'generating_ux_visual',
    'awaiting_assets',
    'matching',
    'composing',
    'validating',
    'awaiting_review',
    'needs_rebase',
    'completed',
  ];
  if (status === 'failed' || status === 'cancelled') return 1;
  const index = order.indexOf(status);
  return index < 0 ? 0 : Math.round((index / (order.length - 1)) * 100) / 100;
}

function patchPreconditionsStillHold(
  proposal: DocumentPatchProposal,
  liveDocument: unknown,
): boolean {
  const tests = new Map<string, JsonValue>();
  for (const operation of proposal.operations) {
    if (operation.op === 'test') tests.set(operation.path, operation.value);
  }
  for (const operation of proposal.operations) {
    if (operation.op === 'test') continue;
    if (operation.op === 'add') {
      if (jsonPointerValue(liveDocument, operation.path) !== undefined) {
        return false;
      }
      continue;
    }
    const expected = tests.get(operation.path);
    if (
      expected === undefined ||
      !jsonValuesEqual(jsonPointerValue(liveDocument, operation.path), expected)
    ) {
      return false;
    }
    if (operation.op === 'move') {
      const expectedSource = tests.get(operation.from);
      if (
        expectedSource === undefined ||
        !jsonValuesEqual(
          jsonPointerValue(liveDocument, operation.from),
          expectedSource,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function jsonPointerValue(root: unknown, pointer: string): unknown {
  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (segment === '-') return undefined;
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseStorageRef(storageRef: string): {
  bucket: string;
  objectPath: string;
} {
  const match = /^supabase:\/\/([^/]+)\/(.+)$/.exec(storageRef);
  if (!match?.[1] || !match[2]) {
    throw new Error('Snapshot storage reference is invalid');
  }
  return { bucket: match[1], objectPath: match[2] };
}
