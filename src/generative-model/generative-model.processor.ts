import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import {
  GENERATIVE_MODEL_QUEUE,
  JOB_REPLICATE_GENERATE_3D,
  JOB_REPLICATE_POLL_3D,
  JOB_OPENAI_DOCUMENT_SUGGESTION,
  JOB_OPENAI_CONCEPT_ART,
  JOB_OLLAMA_DOCUMENT_SUGGESTION,
} from '../queues/queue-names.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { ReplicateProviderAdapter } from '../integrations/replicate.provider.js';
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
  OllamaDocumentSuggestionJob,
} from './models/gen-job.model.js';

/** Polling interval for long-running Replicate predictions */
const REPLICATE_POLL_DELAY_MS = 5_000;
/** Max total age for a Replicate job before we give up */
const REPLICATE_MAX_AGE_MS = 20 * 60 * 1_000; // 20 min

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
      case 'ollama-document-suggestion':
        return this.handleOllamaDocSuggestion(
          job as Job<OllamaDocumentSuggestionJob>,
        );
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
    const { requestId, userId, imageUrl, prompt } = job.data;

    if (await this.isCancelled(requestId)) return;

    await this.appData.updateRequestStatus(requestId, 'processing');

    let predictionId: string;
    try {
      predictionId = await this.replicate.startHunyuan3dPrediction({
        image: imageUrl,
        prompt,
        requestId,
        userId,
      });
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

        await this.appData.updateGenRequestOutput(requestId, modelUrl);
        await this.appData.updateRequestStatus(requestId, 'completed', {
          outputRef: modelUrl,
          resultJson: resultJson as Record<string, unknown>,
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

    try {
      const result = await this.openai.generateConceptArt({
        prompt,
        style,
        requestId,
        userId,
      });

      await this.appData.createExternalAsset({
        assetId: result.assetRef.assetId,
        userId,
        requestId,
        provider: 'openai',
        assetType: 'image',
        mimeType: result.assetRef.mimeType,
        sourceUrl: '',
        storageRef: result.assetRef.storageRef,
      });

      await this.appData.updateGenRequestOutput(
        requestId,
        result.assetRef.storageRef,
      );
      await this.appData.updateRequestStatus(requestId, 'completed', {
        outputRef: result.assetRef.storageRef,
      });
    } catch (err) {
      await this.handleProviderError(requestId, err);
      throw err;
    }
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
