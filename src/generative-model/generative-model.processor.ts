import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject, Optional } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import {
  GENERATIVE_MODEL_QUEUE,
  JOB_REPLICATE_POLL_3D,
  JOB_OPENAI_DOCUMENT_SUGGESTION,
  JOB_OPENAI_CONCEPT_ART,
  JOB_REPLICATE_GENERATE_IMAGE,
  JOB_REPLICATE_POLL_IMAGE,
  JOB_OLLAMA_DOCUMENT_SUGGESTION,
  JOB_CANVAS_IMAGE_SPLIT,
} from '../queues/queue-names.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { ReplicateProviderAdapter } from '../integrations/replicate.provider.js';
import { outboundBinary } from '../integrations/outbound-http.js';
import { OpenAiProviderAdapter } from './providers/openai.provider.js';
import { OllamaProviderAdapter } from './providers/ollama.provider.js';
import { ProviderError } from '../integrations/provider-error.model.js';
import type { ModelProviderAdapter } from './providers/model-provider.interface.js';
import { MODEL_PROVIDER_ADAPTERS } from './providers/model-provider.interface.js';
import { bullJobId } from '../queues/bull-job-id.js';
import { defaultJobOptions } from '../queues/job-options.js';
import type { Replicate3dResultJson } from './models/replicate-3d-result.model.js';
import type {
  GenJobName,
  RunInferenceJob,
  ReplicateGenerate3dJob,
  ReplicatePoll3dJob,
  OpenAiDocumentSuggestionJob,
  OpenAiConceptArtJob,
  ReplicateGenerateImageJob,
  ReplicatePollImageJob,
  OllamaDocumentSuggestionJob,
  CanvasImageSplitJob,
} from './models/gen-job.model.js';
import { AssetsService } from '../projects/assets.service.js';
import { modelPreviewAssetId } from '../projects/asset-conventions.js';
import { CanvasImageSplitService } from '../canvas-workflows/canvas-image-split.service.js';
import { GenerationCostService } from './cost/generation-cost.service.js';
import {
  countMultiviewAssets,
  replicateModelIdForVariant,
} from './hunyuan-3d-model.js';
import {
  parseOpenAiImageUsage,
  parseReplicateMetrics,
} from './cost/generation-cost.estimator.js';
import type {
  GenerationCostSurface,
  GenerationUsagePayload,
} from './cost/generation-cost.types.js';

/** Polling interval for long-running Replicate predictions */
const REPLICATE_POLL_DELAY_MS = 5_000;
/** Max total age for a Replicate job before we give up */
const REPLICATE_MAX_AGE_MS = 20 * 60 * 1_000; // 20 min

const FLUX2_MODEL_ID = 'black-forest-labs/flux-2-pro';

function hunyuanModelIdForJob(
  variant: ReplicateGenerate3dJob['hunyuanModel'],
): string {
  return replicateModelIdForVariant(variant ?? '3.1');
}

@Processor(GENERATIVE_MODEL_QUEUE, { concurrency: 5 })
export class GenerativeModelProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerativeModelProcessor.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly replicate: ReplicateProviderAdapter,
    private readonly openai: OpenAiProviderAdapter,
    private readonly ollama: OllamaProviderAdapter,
    @Inject(MODEL_PROVIDER_ADAPTERS)
    private readonly adapters: Map<string, ModelProviderAdapter>,
    @InjectQueue(GENERATIVE_MODEL_QUEUE)
    private readonly genQueue: Queue,
    @Optional() private readonly assets?: AssetsService,
    @Optional() private readonly imageSplit?: CanvasImageSplitService,
    @Optional() private readonly generationCosts?: GenerationCostService,
  ) {
    super();
  }

  async process(job: Job<unknown, void, GenJobName>): Promise<void> {
    this.logger.log(
      JSON.stringify({ event: 'job_start', jobId: job.id, jobName: job.name }),
    );

    switch (job.name as GenJobName) {
      case 'run-inference':
        return this.handleRunInference(job as Job<RunInferenceJob>);
      case 'replicate-generate-3d':
        return this.handleReplicate3d(job as Job<ReplicateGenerate3dJob>);
      case 'replicate-poll-3d':
        return this.handleReplicatePoll(job as Job<ReplicatePoll3dJob>);
      case 'openai-document-suggestion':
        return this.handleOpenAiDocSuggestion(
          job as Job<OpenAiDocumentSuggestionJob>,
        );
      case 'openai-concept-art':
        return this.handleOpenAiConceptArt(job as Job<OpenAiConceptArtJob>);
      case 'replicate-generate-image':
        return this.handleReplicateGenerateImage(
          job as Job<ReplicateGenerateImageJob>,
        );
      case 'replicate-poll-image':
        return this.handleReplicatePollImage(job as Job<ReplicatePollImageJob>);
      case 'ollama-document-suggestion':
        return this.handleOllamaDocSuggestion(
          job as Job<OllamaDocumentSuggestionJob>,
        );
      case 'canvas-image-split':
        if (!this.imageSplit) {
          throw new Error('CanvasImageSplitService is not available');
        }
        return this.imageSplit.run(job.data as CanvasImageSplitJob);
      default:
        throw new Error(
          `Unknown generative-model job: ${(job as Job).name as string}`,
        );
    }
  }

  // ─── Replicate 3D ─────────────────────────────────────────────────────────

  private async handleReplicate3d(
    job: Job<ReplicateGenerate3dJob>,
  ): Promise<void> {
    const {
      requestId,
      userId,
      imageUrl,
      prompt,
      hunyuanOptions,
      hunyuan2mvOptions,
      multiviewUrls,
      hunyuanModel = '3.1',
    } = job.data;

    if (await this.isCancelled(requestId)) return;

    await this.appData.updateRequestStatus(requestId, 'processing');

    let predictionId: string;
    try {
      if (hunyuanModel === '2mv') {
        if (!multiviewUrls || countMultiviewAssets(multiviewUrls) < 1) {
          throw new Error('2mv job missing multiviewUrls');
        }
        predictionId = await this.replicate.startHunyuan2mvPrediction({
          views: multiviewUrls,
          generation: hunyuan2mvOptions,
          requestId,
          userId,
        });
      } else {
        predictionId = await this.replicate.startHunyuan3dPrediction({
          image: imageUrl,
          prompt,
          generation: hunyuanOptions,
          requestId,
          userId,
        });
      }
    } catch (err) {
      await this.markFailed(requestId, err);
      throw err;
    }

    // Persist the prediction ID so the poll job can resume after restart
    const processingResult: Replicate3dResultJson = { predictionId };
    await this.appData.updateRequestStatus(requestId, 'processing', {
      outputRef: `replicate-prediction:${predictionId}`,
      resultJson: processingResult as Record<string, unknown>,
    });

    await this.genQueue.add(
      JOB_REPLICATE_POLL_3D,
      {
        requestId,
        userId,
        predictionId,
        enqueuedAt: new Date().toISOString(),
        projectId: job.data.projectId,
        localProjectId: job.data.localProjectId,
        workflowId: job.data.workflowId,
        nodeId: job.data.nodeId,
        runId: job.data.runId,
        activityId: job.data.activityId,
        preferredAssetId: job.data.preferredAssetId,
        surface: job.data.surface,
        actionKind: job.data.actionKind,
        hunyuanModel: job.data.hunyuanModel,
      } satisfies ReplicatePoll3dJob,
      {
        ...defaultJobOptions,
        jobId: bullJobId('replicate-poll', predictionId),
        delay: REPLICATE_POLL_DELAY_MS,
      },
    );
  }

  private async handleReplicatePoll(
    job: Job<ReplicatePoll3dJob>,
  ): Promise<void> {
    const { requestId, userId, predictionId, enqueuedAt } = job.data;

    if (await this.isCancelled(requestId)) {
      await this.replicate.cancelPrediction(predictionId, requestId);
      return;
    }

    // Give up if the job has been in-flight too long
    const age = Date.now() - new Date(enqueuedAt).getTime();
    if (age > REPLICATE_MAX_AGE_MS) {
      const msg = `Replicate prediction ${predictionId} timed out after ${Math.round(age / 60_000)} min`;
      await this.markFailed(requestId, new Error(msg));
      throw new Error(msg);
    }

    const prediction = await this.replicate.pollPrediction({
      predictionId,
      requestId,
      userId,
    });

    switch (prediction.status) {
      case 'running':
        // Re-enqueue for another poll
        await this.genQueue.add(
          JOB_REPLICATE_POLL_3D,
          job.data,
          {
            ...defaultJobOptions,
            jobId: bullJobId('replicate-poll', predictionId, String(Date.now())),
            delay: REPLICATE_POLL_DELAY_MS,
          },
        );
        break;

      case 'succeeded': {
        const modelUrl = prediction.modelUrls[0];
        const previewUrl = prediction.previewUrls[0];

        if (!modelUrl) {
          const msg =
            'Replicate completed but returned no model file URL (.glb, .gltf, .obj, .zip)';
          await this.markFailed(requestId, new Error(msg));
          throw new Error(msg);
        }

        const resultJson: Replicate3dResultJson = {
          predictionId,
          modelUrl,
          previewUrl,
          modelUrls: prediction.modelUrls,
          previewUrls: prediction.previewUrls,
        };

        if (this.assets && (job.data.projectId || job.data.localProjectId)) {
          try {
            const assetId =
              job.data.preferredAssetId ?? `model-${requestId.slice(0, 8)}`;
            let importedAssetId = assetId;

            if (job.data.projectId) {
              const imported = await this.assets.importGeneratedAsset(
                userId,
                job.data.projectId,
                {
                  requestId,
                  assetId,
                  assetType: 'model',
                  name: `${assetId}.glb`,
                  sourceUrl: modelUrl,
                  sourceProvider: 'replicate',
                  mimeType: 'model/gltf-binary',
                  metadata: {
                    workflowId: job.data.workflowId,
                    nodeId: job.data.nodeId,
                    runId: job.data.runId,
                    canvasOutput: true,
                  },
                },
              );
              importedAssetId = imported.assetId;
              if (previewUrl) {
                await this.assets.importGeneratedAsset(
                  userId,
                  job.data.projectId,
                  {
                    requestId,
                    assetId: modelPreviewAssetId(assetId),
                    assetType: 'image',
                    name: `${assetId}-preview.png`,
                    sourceUrl: previewUrl,
                    sourceProvider: 'replicate',
                    mimeType: 'image/png',
                    metadata: {
                      parentAssetId: assetId,
                      assetRole: 'model_preview',
                      workflowId: job.data.workflowId,
                      nodeId: job.data.nodeId,
                      runId: job.data.runId,
                      canvasOutput: true,
                    },
                  },
                );
              }
            } else if (job.data.localProjectId) {
              const imported = await this.assets.materializeLocalGeneratedAsset(
                userId,
                job.data.localProjectId,
                {
                  assetId,
                  assetType: 'model',
                  name: `${assetId}.glb`,
                  mimeType: 'model/gltf-binary',
                  sourceUrl: modelUrl,
                  requestId,
                  sourceProvider: 'replicate',
                  metadata: {
                    localProjectId: job.data.localProjectId,
                    workflowId: job.data.workflowId,
                    nodeId: job.data.nodeId,
                    runId: job.data.runId,
                  },
                },
              );
              importedAssetId = imported.assetId;
              if (previewUrl) {
                await this.assets.materializeLocalGeneratedAsset(
                  userId,
                  job.data.localProjectId,
                  {
                    assetId: modelPreviewAssetId(assetId),
                    assetType: 'image',
                    name: `${assetId}-preview.png`,
                    mimeType: 'image/png',
                    sourceUrl: previewUrl,
                    requestId,
                    sourceProvider: 'replicate',
                    metadata: {
                      parentAssetId: assetId,
                      assetRole: 'model_preview',
                      localProjectId: job.data.localProjectId,
                    },
                  },
                );
              }
            }

            (resultJson as Record<string, unknown>).assetId = importedAssetId;
            (resultJson as Record<string, unknown>).previewAssetId =
              modelPreviewAssetId(assetId);
            (resultJson as Record<string, unknown>).localProjectId =
              job.data.localProjectId;
            if (job.data.activityId) {
              await this.appData.updateCollaborationActivity(job.data.activityId, {
                status: 'completed',
                result: {
                  ...resultJson,
                  assetId: importedAssetId,
                  previewAssetId: modelPreviewAssetId(assetId),
                  outputs: [
                    {
                      portId: 'model',
                      assetId: importedAssetId,
                      mimeType: 'model/gltf-binary',
                    },
                    {
                      portId: 'asset',
                      assetId: importedAssetId,
                    },
                  ],
                },
              });
            }
          } catch (importErr) {
            this.logger.error(
              JSON.stringify({
                event: 'canvas_3d_import_failed',
                requestId,
                error:
                  importErr instanceof Error
                    ? importErr.message
                    : String(importErr),
              }),
            );
          }
        }

        await this.appData.updateGenRequestOutput(requestId, modelUrl);
        await this.appData.updateRequestStatus(requestId, 'completed', {
          outputRef: modelUrl,
          resultJson: resultJson as Record<string, unknown>,
        });
        await this.recordGenerationUsage({
          requestId,
          projectId: job.data.projectId,
          actorUserId: userId,
          provider: 'replicate',
          modelId: hunyuanModelIdForJob(job.data.hunyuanModel),
          surface: job.data.surface,
          actionKind: job.data.actionKind ?? 'model_3d',
          requestType: 'replicate-3d',
          usage: {
            replicate: parseReplicateMetrics(prediction.metrics, predictionId),
          },
        });
        this.logger.log(
          JSON.stringify({
            event: 'replicate_3d_succeeded',
            requestId,
            userId,
            predictionId,
            modelUrl,
            previewUrl,
          }),
        );
        break;
      }

      case 'failed':
        await this.markFailed(
          requestId,
          new Error(prediction.errorMessage ?? 'Replicate prediction failed'),
        );
        if (job.data.activityId) {
          await this.appData.updateCollaborationActivity(job.data.activityId, {
            status: 'failed',
            errorMessage:
              prediction.errorMessage ?? 'Replicate prediction failed',
          });
        }
        throw new Error(prediction.errorMessage ?? 'Replicate prediction failed');

      case 'canceled':
        await this.appData.updateRequestStatus(requestId, 'cancelled');
        break;
    }
  }

  // ─── OpenAI ───────────────────────────────────────────────────────────────

  private async handleOpenAiDocSuggestion(
    job: Job<OpenAiDocumentSuggestionJob>,
  ): Promise<void> {
    const { requestId, userId, documentText, context } = job.data;

    if (await this.isCancelled(requestId)) return;

    await this.appData.updateRequestStatus(requestId, 'processing');

    try {
      const result = await this.openai.generateDocumentSuggestion({
        documentText,
        context,
        requestId,
        userId,
      });

      const outputRef = `doc-suggestion:${requestId}`;
      await this.appData.updateGenRequestOutput(requestId, outputRef);
      await this.appData.updateRequestStatus(requestId, 'completed', {
        outputRef: JSON.stringify(result),
      });
    } catch (err) {
      await this.handleProviderError(requestId, err);
      throw err;
    }
  }

  private async handleOpenAiConceptArt(
    job: Job<OpenAiConceptArtJob>,
  ): Promise<void> {
    const { requestId, userId, prompt, style } = job.data;

    if (await this.isCancelled(requestId)) return;

    await this.appData.updateRequestStatus(requestId, 'processing');
    if (job.data.activityId) {
      await this.appData.updateCollaborationActivity(job.data.activityId, {
        status: 'running',
      });
    }

    try {
      const result = await this.openai.generateImage({
        prompt,
        style,
        provider: 'gpt_image',
        quality: job.data.quality,
        size: job.data.size,
        variants: job.data.variants ?? 1,
        references: (job.data.referenceUrls ?? []).map((url, i) => ({
          url,
          assetId: job.data.referenceAssetIds?.[i],
        })),
        requestId,
        userId,
      });

      const materialized = await this.materializeConceptArtVariants({
        ctx: job.data,
        requestId,
        userId,
        provider: 'openai',
        modelId: result.modelId,
        composedPrompt: result.composedPrompt,
        variants: result.variants.map((v) => ({
          imageBytesBase64: v.imageBytesBase64,
          sourceUrl: v.sourceUrl,
          mimeType: v.mimeType,
          revisedPrompt: v.revisedPrompt,
        })),
      });

      await this.appData.updateGenRequestOutput(
        requestId,
        materialized.primaryStorageRef,
      );
      await this.appData.updateRequestStatus(requestId, 'completed', {
        outputRef: materialized.primaryStorageRef,
        resultJson: {
          assetId: materialized.primaryAssetId,
          assetIds: materialized.assetIds,
          storageRef: materialized.primaryStorageRef,
          revisedPrompt: materialized.revisedPrompt,
          provider: 'gpt_image',
          modelId: result.modelId,
        },
      });
      await this.recordGenerationUsage({
        requestId,
        projectId: job.data.projectId,
        actorUserId: userId,
        provider: 'openai',
        modelId: result.modelId,
        surface: job.data.surface,
        actionKind: job.data.actionKind ?? 'concept_art',
        requestType: 'openai-concept-art',
        usage: {
          openai: parseOpenAiImageUsage(result.providerUsage),
        },
      });
    } catch (err) {
      if (job.data.activityId) {
        await this.appData.updateCollaborationActivity(job.data.activityId, {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      await this.handleProviderError(requestId, err);
      throw err;
    }
  }

  private async handleReplicateGenerateImage(
    job: Job<ReplicateGenerateImageJob>,
  ): Promise<void> {
    const { requestId, userId, prompt } = job.data;

    if (await this.isCancelled(requestId)) return;

    await this.appData.updateRequestStatus(requestId, 'processing');
    if (job.data.activityId) {
      await this.appData.updateCollaborationActivity(job.data.activityId, {
        status: 'running',
      });
    }

    let predictionId: string;
    try {
      predictionId = await this.replicate.startFluxImagePrediction({
        prompt,
        inputImages: job.data.referenceUrls,
        aspectRatio: job.data.aspectRatio,
        resolution: job.data.resolution,
        seed: job.data.seed,
        outputFormat: 'png',
        requestId,
        userId,
      });
    } catch (err) {
      if (job.data.activityId) {
        await this.appData.updateCollaborationActivity(job.data.activityId, {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      await this.markFailed(requestId, err);
      throw err;
    }

    await this.appData.updateRequestStatus(requestId, 'processing', {
      outputRef: `replicate-prediction:${predictionId}`,
      resultJson: { predictionId, provider: 'flux2' },
    });

    await this.genQueue.add(
      JOB_REPLICATE_POLL_IMAGE,
      {
        requestId,
        userId,
        predictionId,
        enqueuedAt: new Date().toISOString(),
        provider: 'flux2',
        composedPrompt: prompt,
        referenceAssetIds: job.data.referenceAssetIds,
        projectId: job.data.projectId,
        workflowId: job.data.workflowId,
        nodeId: job.data.nodeId,
        runId: job.data.runId,
        activityId: job.data.activityId,
        preferredAssetId: job.data.preferredAssetId,
        surface: job.data.surface,
        actionKind: job.data.actionKind,
      } satisfies ReplicatePollImageJob,
      {
        ...defaultJobOptions,
        jobId: bullJobId('replicate-image-poll', predictionId),
        delay: REPLICATE_POLL_DELAY_MS,
      },
    );
  }

  private async handleReplicatePollImage(
    job: Job<ReplicatePollImageJob>,
  ): Promise<void> {
    const { requestId, userId, predictionId, enqueuedAt } = job.data;

    if (await this.isCancelled(requestId)) {
      await this.replicate.cancelPrediction(predictionId, requestId);
      return;
    }

    const age = Date.now() - new Date(enqueuedAt).getTime();
    if (age > REPLICATE_MAX_AGE_MS) {
      const msg = `Replicate image prediction ${predictionId} timed out after ${Math.round(age / 60_000)} min`;
      if (job.data.activityId) {
        await this.appData.updateCollaborationActivity(job.data.activityId, {
          status: 'failed',
          errorMessage: msg,
        });
      }
      await this.markFailed(requestId, new Error(msg));
      throw new Error(msg);
    }

    const prediction = await this.replicate.pollPrediction({
      predictionId,
      requestId,
      userId,
    });

    switch (prediction.status) {
      case 'running':
        await this.genQueue.add(JOB_REPLICATE_POLL_IMAGE, job.data, {
          ...defaultJobOptions,
          jobId: bullJobId(
            'replicate-image-poll',
            predictionId,
            String(Date.now()),
          ),
          delay: REPLICATE_POLL_DELAY_MS,
        });
        break;

      case 'succeeded': {
        const imageUrl =
          prediction.previewUrls[0] ??
          prediction.outputUrls.find((u) =>
            /\.(png|jpe?g|webp)(\?|$)/i.test(u),
          ) ??
          prediction.outputUrls[0];
        if (!imageUrl) {
          const msg =
            'Replicate FLUX completed but returned no image URL';
          if (job.data.activityId) {
            await this.appData.updateCollaborationActivity(job.data.activityId, {
              status: 'failed',
              errorMessage: msg,
            });
          }
          await this.markFailed(requestId, new Error(msg));
          throw new Error(msg);
        }

        const bytes = await outboundBinary({
          provider: 'replicate',
          url: imageUrl,
          timeoutMs: 60_000,
          requestId,
          userId,
        });

        const materialized = await this.materializeConceptArtVariants({
          ctx: job.data,
          requestId,
          userId,
          provider: 'replicate',
          modelId: 'flux2',
          composedPrompt: job.data.composedPrompt,
          variants: [
            {
              imageBytesBase64: bytes.toString('base64'),
              sourceUrl: imageUrl,
              mimeType: 'image/png',
            },
          ],
        });

        await this.appData.updateGenRequestOutput(
          requestId,
          materialized.primaryStorageRef,
        );
        await this.appData.updateRequestStatus(requestId, 'completed', {
          outputRef: materialized.primaryStorageRef,
          resultJson: {
            predictionId,
            assetId: materialized.primaryAssetId,
            assetIds: materialized.assetIds,
            storageRef: materialized.primaryStorageRef,
            sourceUrl: imageUrl,
            provider: 'flux2',
          },
        });
        await this.recordGenerationUsage({
          requestId,
          projectId: job.data.projectId,
          actorUserId: userId,
          provider: 'replicate',
          modelId: FLUX2_MODEL_ID,
          surface: job.data.surface,
          actionKind: job.data.actionKind ?? 'concept_art',
          requestType: 'replicate-image',
          usage: {
            replicate: parseReplicateMetrics(prediction.metrics, predictionId),
          },
        });
        break;
      }

      case 'failed':
      case 'canceled': {
        const msg =
          prediction.errorMessage ??
          `Replicate image prediction ${prediction.status}`;
        if (job.data.activityId) {
          await this.appData.updateCollaborationActivity(job.data.activityId, {
            status: 'failed',
            errorMessage: msg,
          });
        }
        await this.markFailed(requestId, new Error(msg));
        throw new Error(msg);
      }
    }
  }

  /**
   * Persist one or more concept-art variants as project assets and update
   * the canvas activity result when scoped.
   */
  private async materializeConceptArtVariants(opts: {
    ctx: {
      projectId?: string;
      workflowId?: string;
      nodeId?: string;
      runId?: string;
      activityId?: string;
      preferredAssetId?: string;
      referenceAssetIds?: string[];
    };
    requestId: string;
    userId: string;
    provider: string;
    modelId: string;
    composedPrompt: string;
    variants: Array<{
      imageBytesBase64?: string;
      sourceUrl?: string;
      mimeType: string;
      revisedPrompt?: string;
    }>;
  }): Promise<{
    primaryAssetId: string;
    primaryStorageRef: string;
    assetIds: string[];
    revisedPrompt?: string;
  }> {
    const { ctx, requestId, userId, variants } = opts;
    const assetIds: string[] = [];
    let primaryStorageRef = '';
    let primaryAssetId = '';
    let revisedPrompt: string | undefined;

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i]!;
      const baseId = ctx.preferredAssetId ?? `art-${requestId.slice(0, 12)}`;
      const assetId = i === 0 ? baseId : `${baseId}-v${i + 1}`;

      if (!variant.imageBytesBase64 && !variant.sourceUrl) {
        throw ProviderError.permanent(
          opts.provider,
          'Concept art variant has neither bytes nor source URL',
        );
      }

      let storageRef = `generated/concept-art/${userId}/${assetId}.png`;

      if (ctx.projectId && this.assets) {
        let bytes: Buffer;
        if (variant.imageBytesBase64) {
          bytes = Buffer.from(variant.imageBytesBase64, 'base64');
        } else {
          bytes = await outboundBinary({
            provider: opts.provider,
            url: variant.sourceUrl!,
            timeoutMs: 60_000,
            requestId,
            userId,
          });
        }

        const materialized = await this.assets.materializeGeneratedBytes(
          userId,
          ctx.projectId,
          {
            assetId,
            assetType: 'concept_art',
            name: `${assetId}.png`,
            mimeType: variant.mimeType || 'image/png',
            bytes,
            requestId,
            sourceProvider: opts.provider,
            metadata: {
              workflowId: ctx.workflowId,
              nodeId: ctx.nodeId,
              runId: ctx.runId,
              revisedPrompt: variant.revisedPrompt,
              canvasOutput: true,
              imageProvider: opts.provider,
              imageModel: opts.modelId,
              variantIndex: i,
              referenceAssetIds: ctx.referenceAssetIds,
            },
          },
        );
        storageRef = materialized.storageRef;
        assetIds.push(materialized.assetId);
        if (i === 0) {
          primaryAssetId = materialized.assetId;
          primaryStorageRef = storageRef;
          revisedPrompt = variant.revisedPrompt;
        }
      } else {
        await this.appData.createExternalAsset({
          assetId,
          userId,
          requestId,
          provider: opts.provider,
          assetType: 'image',
          mimeType: variant.mimeType || 'image/png',
          sourceUrl: variant.sourceUrl ?? '',
          storageRef,
        });
        assetIds.push(assetId);
        if (i === 0) {
          primaryAssetId = assetId;
          primaryStorageRef = storageRef;
          revisedPrompt = variant.revisedPrompt;
        }
      }
    }

    if (ctx.activityId && ctx.projectId) {
      const outputs = assetIds.flatMap((assetId, i) => {
        const ports =
          i === 0
            ? [
                { portId: 'image', assetId, mimeType: 'image/png' },
                { portId: 'asset', assetId },
              ]
            : [
                {
                  portId: `image_${i + 1}`,
                  assetId,
                  mimeType: 'image/png',
                },
              ];
        return ports;
      });

      await this.appData.updateCollaborationActivity(ctx.activityId, {
        status: 'completed',
        result: {
          assetId: primaryAssetId,
          assetIds,
          storageRef: primaryStorageRef,
          mimeType: 'image/png',
          revisedPrompt,
          composedPrompt: opts.composedPrompt,
          provider: opts.provider,
          modelId: opts.modelId,
          outputs,
        },
      });
    }

    return {
      primaryAssetId,
      primaryStorageRef,
      assetIds,
      revisedPrompt,
    };
  }

  // ─── Ollama ───────────────────────────────────────────────────────────────

  private async handleOllamaDocSuggestion(
    job: Job<OllamaDocumentSuggestionJob>,
  ): Promise<void> {
    const { requestId, userId, documentText, modelId } = job.data;

    if (await this.isCancelled(requestId)) return;

    await this.appData.updateRequestStatus(requestId, 'processing');

    try {
      const content = await this.ollama.generateDocumentSuggestion({
        documentText,
        modelId,
        requestId,
        userId,
      });

      await this.appData.updateGenRequestOutput(requestId, content);
      await this.appData.updateRequestStatus(requestId, 'completed', {
        outputRef: content,
      });
    } catch (err) {
      await this.handleProviderError(requestId, err);
      throw err;
    }
  }

  // ─── Legacy run-inference ─────────────────────────────────────────────────

  private async handleRunInference(job: Job<RunInferenceJob>): Promise<void> {
    const { requestId, userId, prompt, modelProvider, modelId, inputRefs } =
      job.data;

    if (await this.isCancelled(requestId)) return;

    await this.appData.updateRequestStatus(requestId, 'processing');

    const adapter = this.adapters.get(modelProvider);
    if (!adapter) {
      const msg = `No adapter for provider: ${modelProvider}`;
      await this.markFailed(requestId, new Error(msg));
      throw new Error(msg);
    }

    try {
      const outputRef = await adapter.runInference({
        requestId,
        userId,
        prompt,
        modelId,
        inputRefs,
      });

      await this.appData.updateGenRequestOutput(requestId, outputRef);
      await this.appData.updateRequestStatus(requestId, 'completed', {
        outputRef,
      });
    } catch (err) {
      await this.handleProviderError(requestId, err);
      throw err;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Persist estimated cost for a completed generation. No-ops when the job has
   * no projectId (legacy / unscoped) or cost service is unavailable.
   * Historical rows are never backfilled — only new completions are recorded.
   */
  private async recordGenerationUsage(opts: {
    requestId: string;
    projectId?: string;
    actorUserId: string;
    provider: 'openai' | 'replicate' | 'local';
    modelId?: string;
    surface?: string;
    actionKind?: string;
    requestType: string;
    usage: GenerationUsagePayload;
  }): Promise<void> {
    if (!this.generationCosts || !opts.projectId) return;
    const surface = (opts.surface ?? 'unknown') as GenerationCostSurface;
    await this.generationCosts.recordUsage({
      requestId: opts.requestId,
      projectId: opts.projectId,
      actorUserId: opts.actorUserId,
      provider: opts.provider,
      modelId: opts.modelId,
      surface,
      actionKind: opts.actionKind,
      requestType: opts.requestType,
      usage: opts.usage,
      billable: true,
    });
  }

  private async isCancelled(requestId: string): Promise<boolean> {
    const row = await this.appData.getRequestStatus(requestId);
    if (row?.status === 'cancelled') {
      this.logger.log(
        JSON.stringify({ event: 'job_cancelled', requestId }),
      );
      return true;
    }
    return false;
  }

  private async markFailed(requestId: string, err: unknown): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(
      JSON.stringify({ event: 'job_failed', requestId, error: msg }),
    );
    await this.appData.updateRequestStatus(requestId, 'failed', {
      errorMessage: msg,
    });
  }

  /** Re-throw retryable ProviderErrors so BullMQ will retry the job. */
  private async handleProviderError(
    requestId: string,
    err: unknown,
  ): Promise<void> {
    if (err instanceof ProviderError && !err.retryable) {
      await this.markFailed(requestId, err);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        JSON.stringify({
          event: 'job_retryable_error',
          requestId,
          error: msg,
        }),
      );
    }
  }
}
