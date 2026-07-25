import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  GENERATIVE_MODEL_QUEUE,
  JOB_REPLICATE_GENERATE_3D,
  JOB_OPENAI_DOCUMENT_SUGGESTION,
  JOB_OPENAI_CONCEPT_ART,
  JOB_REPLICATE_GENERATE_IMAGE,
  JOB_OLLAMA_DOCUMENT_SUGGESTION,
} from '../queues/queue-names.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { resolveHunyuan3dOptions } from './hunyuan-3d-options.js';
import { resolveHunyuan2mvOptions } from './hunyuan-2mv-options.js';
import {
  countMultiviewAssets,
  normalizeMultiviewImageUrls,
  resolveHunyuanModelVariant,
  type HunyuanModelVariant,
  type HunyuanMultiviewUrls,
} from './hunyuan-3d-model.js';
import { OllamaProviderAdapter } from './providers/ollama.provider.js';
import { bullJobId } from '../queues/bull-job-id.js';
import { heavyJobOptions } from '../queues/job-options.js';
import type { CreateGenRequestDto } from './dto/create-gen-request.dto.js';
import type {
  RunInferenceJob,
  ReplicateGenerate3dJob,
  OpenAiDocumentSuggestionJob,
  OpenAiConceptArtJob,
  ReplicateGenerateImageJob,
  OllamaDocumentSuggestionJob,
} from './models/gen-job.model.js';
import type {
  Create3dRequestDto,
  CreateDocumentSuggestionDto,
  CreateConceptArtDto,
} from './dto/generative-requests.dto.js';
import { mapGenerativeRequestStatus } from './generative-request-status.mapper.js';
import type { GenerativeRequestStatusResponse } from './models/generative-request-status.model.js';
import {
  DEFAULT_IMAGE_PROVIDER,
  isImageProviderId,
  type ImageProviderId,
} from './image-generation/image-generation.types.js';
import { composeImagePrompt } from './image-generation/prompt-composer.js';

export interface EnqueueConceptArtOpts {
  requestId: string;
  userId: string;
  prompt: string;
  style?: string;
  provider?: ImageProviderId;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  referenceUrls?: string[];
  referenceAssetIds?: string[];
  variants?: number;
  projectId?: string;
  workflowId?: string;
  nodeId?: string;
  runId?: string;
  activityId?: string;
  preferredAssetId?: string;
  surface?: 'storyboard' | 'foundry' | 'canvas' | 'direct' | 'unknown';
  actionKind?: string;
}

@Injectable()
export class GenerativeModelService {
  private readonly logger = new Logger(GenerativeModelService.name);

  constructor(
    @InjectQueue(GENERATIVE_MODEL_QUEUE)
    private readonly genQueue: Queue,
    private readonly appData: AppDataService,
    private readonly ollama: OllamaProviderAdapter,
  ) {}

  // ─── Legacy generic request ───────────────────────────────────────────────

  async createRequest(
    userId: string,
    dto: CreateGenRequestDto,
  ): Promise<{ requestId: string; status: string }> {
    const requestId = randomUUID();
    const jobId = bullJobId('gen', userId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: 'generative-model',
      status: 'queued',
    });

    await this.appData.createGenRequest({
      requestId,
      userId,
      prompt: dto.prompt,
      modelProvider: dto.modelProvider,
      modelId: dto.modelId,
      inputRefs: dto.inputRefs ?? [],
    });

    const payload: RunInferenceJob = {
      requestId,
      userId,
      prompt: dto.prompt,
      modelProvider: dto.modelProvider,
      modelId: dto.modelId,
      inputRefs: dto.inputRefs ?? [],
    };

    await this.genQueue.add('run-inference', payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({ event: 'gen_request_enqueued', jobId, userId }),
    );
    return { requestId, status: 'queued' };
  }

  // ─── Replicate 3D ─────────────────────────────────────────────────────────

  async create3dRequest(
    userId: string,
    dto: Create3dRequestDto,
  ): Promise<{ requestId: string; status: string }> {
    const multiviewUrls = normalizeMultiviewImageUrls(dto.multiviewImageUrls);
    const multiviewCount = countMultiviewAssets(multiviewUrls);
    const hunyuanModel = resolveHunyuanModelVariant(
      { hunyuanModel: dto.hunyuanModel },
      multiviewCount,
    );

    if (hunyuanModel === '2mv') {
      if (multiviewCount < 2) {
        throw new BadRequestException(
          'hunyuanModel 2mv requires multiviewImageUrls with at least two of front/back/left/right',
        );
      }
      if (dto.imageUrl || dto.prompt) {
        throw new BadRequestException(
          'hunyuanModel 2mv uses multiviewImageUrls only — omit imageUrl and prompt',
        );
      }
    } else {
      if (multiviewCount > 0) {
        throw new BadRequestException(
          'multiviewImageUrls requires hunyuanModel "2mv" (or ≥2 views for auto-selection)',
        );
      }
      if (!dto.imageUrl && !dto.prompt) {
        throw new BadRequestException(
          'Either imageUrl or prompt is required for Hunyuan 3.1',
        );
      }
      if (dto.imageUrl && dto.prompt) {
        throw new BadRequestException(
          'Provide either imageUrl or prompt, not both — Hunyuan 3.1 uses one mode per request',
        );
      }
    }

    if (dto.projectId && dto.localProjectId) {
      throw new BadRequestException(
        'Provide either projectId (cloud) or localProjectId (local), not both',
      );
    }

    const requestId = randomUUID();
    const configRecord = dto as unknown as Record<string, unknown>;
    await this.enqueue3dRequest({
      requestId,
      userId,
      imageUrl: dto.imageUrl,
      prompt: dto.prompt,
      multiviewUrls: multiviewCount > 0 ? multiviewUrls : undefined,
      projectId: dto.projectId,
      localProjectId: dto.localProjectId,
      surface:
        dto.surface ??
        (dto.projectId || dto.localProjectId ? 'foundry' : 'direct'),
      actionKind: 'model_3d',
      hunyuanModel,
      hunyuanOptions:
        hunyuanModel === '3.1'
          ? resolveHunyuan3dOptions(configRecord)
          : undefined,
      hunyuan2mvOptions:
        hunyuanModel === '2mv'
          ? resolveHunyuan2mvOptions(configRecord)
          : undefined,
    });
    return { requestId, status: 'queued' };
  }

  /**
   * Enqueue a Hunyuan 3D job with a caller-reserved requestId (canvas actions).
   */
  async enqueue3dRequest(opts: {
    requestId: string;
    userId: string;
    hunyuanModel?: HunyuanModelVariant;
    imageUrl?: string;
    prompt?: string;
    multiviewUrls?: HunyuanMultiviewUrls;
    projectId?: string;
    localProjectId?: string;
    workflowId?: string;
    nodeId?: string;
    runId?: string;
    activityId?: string;
    preferredAssetId?: string;
    surface?: 'storyboard' | 'foundry' | 'canvas' | 'direct' | 'unknown';
    actionKind?: string;
    hunyuanOptions?: ReturnType<typeof resolveHunyuan3dOptions>;
    hunyuan2mvOptions?: ReturnType<typeof resolveHunyuan2mvOptions>;
  }): Promise<void> {
    const hunyuanModel = opts.hunyuanModel ?? '3.1';
    const jobId = bullJobId('replicate-3d', opts.userId, opts.requestId);

    await this.appData.createRequestStatus({
      requestId: opts.requestId,
      userId: opts.userId,
      type: 'replicate-3d',
      status: 'queued',
    });

    const payload: ReplicateGenerate3dJob = {
      requestId: opts.requestId,
      userId: opts.userId,
      hunyuanModel,
      imageUrl: opts.imageUrl,
      prompt: opts.prompt,
      multiviewUrls: opts.multiviewUrls,
      projectId: opts.projectId,
      localProjectId: opts.localProjectId,
      workflowId: opts.workflowId,
      nodeId: opts.nodeId,
      runId: opts.runId,
      activityId: opts.activityId,
      preferredAssetId: opts.preferredAssetId,
      surface:
        opts.surface ??
        (opts.projectId || opts.localProjectId ? 'canvas' : 'direct'),
      actionKind: opts.actionKind ?? 'model_3d',
      hunyuanOptions:
        hunyuanModel === '3.1'
          ? (opts.hunyuanOptions ?? resolveHunyuan3dOptions())
          : undefined,
      hunyuan2mvOptions:
        hunyuanModel === '2mv'
          ? (opts.hunyuan2mvOptions ?? resolveHunyuan2mvOptions())
          : undefined,
    };

    await this.genQueue.add(JOB_REPLICATE_GENERATE_3D, payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({
        event: 'replicate_3d_enqueued',
        jobId,
        userId: opts.userId,
        requestId: opts.requestId,
        projectId: opts.projectId,
        hunyuanModel,
      }),
    );
  }

  // ─── OpenAI document suggestion ───────────────────────────────────────────

  async createDocumentSuggestion(
    userId: string,
    dto: CreateDocumentSuggestionDto,
  ): Promise<{ requestId: string; status: string }> {
    const requestId = randomUUID();
    const jobId = bullJobId('openai-doc', userId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: 'openai-document-suggestion',
      status: 'queued',
    });

    const payload: OpenAiDocumentSuggestionJob = {
      requestId,
      userId,
      documentText: dto.documentText,
      context: dto.context,
    };

    await this.genQueue.add(JOB_OPENAI_DOCUMENT_SUGGESTION, payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({
        event: 'openai_doc_suggestion_enqueued',
        jobId,
        userId,
      }),
    );
    return { requestId, status: 'queued' };
  }

  // ─── Concept art (GPT Image / FLUX.2) ─────────────────────────────────────

  async createConceptArt(
    userId: string,
    dto: CreateConceptArtDto,
  ): Promise<{ requestId: string; status: string }> {
    const requestId = randomUUID();
    let provider: ImageProviderId = DEFAULT_IMAGE_PROVIDER;
    if (dto.provider) {
      if (!isImageProviderId(dto.provider)) {
        throw new BadRequestException(
          `Unsupported image provider: ${dto.provider}`,
        );
      }
      provider = dto.provider;
    }

    await this.enqueueConceptArt({
      requestId,
      userId,
      prompt: dto.prompt,
      style: dto.style,
      provider,
      quality: dto.quality,
      size: dto.size,
      aspectRatio: dto.aspectRatio,
      variants: dto.variants,
      projectId: dto.projectId,
      surface: dto.surface ?? (dto.projectId ? 'storyboard' : 'direct'),
      actionKind: 'concept_art',
    });
    return { requestId, status: 'queued' };
  }

  /**
   * Enqueue concept-art generation with a caller-reserved requestId.
   * Single source of truth for Storyboard (`POST /concept-art`) and Canvas
   * (`concept_art` action). Routes to OpenAI GPT Image or Replicate FLUX.2.
   */
  async enqueueConceptArt(opts: EnqueueConceptArtOpts): Promise<void> {
    const provider = opts.provider ?? DEFAULT_IMAGE_PROVIDER;
    const composed = composeImagePrompt({
      configPrompt: opts.prompt,
      style: opts.style,
      maxLength: provider === 'flux2' ? 8_000 : 4_000,
    });
    if (!composed) {
      throw new BadRequestException(
        'Concept art prompt is empty after composition',
      );
    }

    const variants = Math.min(Math.max(opts.variants ?? 1, 1), 4);

    if (provider === 'flux2') {
      await this.enqueueFluxConceptArt({ ...opts, prompt: composed, variants });
      return;
    }

    await this.enqueueGptImageConceptArt({
      ...opts,
      prompt: composed,
      variants,
    });
  }

  private async enqueueGptImageConceptArt(
    opts: EnqueueConceptArtOpts & { prompt: string; variants: number },
  ): Promise<void> {
    const jobId = bullJobId('openai-art', opts.userId, opts.requestId);

    await this.appData.createRequestStatus({
      requestId: opts.requestId,
      userId: opts.userId,
      type: 'openai-concept-art',
      status: 'queued',
    });

    const payload: OpenAiConceptArtJob = {
      requestId: opts.requestId,
      userId: opts.userId,
      prompt: opts.prompt,
      style: undefined,
      provider: 'gpt_image',
      quality: opts.quality,
      size: opts.size,
      referenceUrls: opts.referenceUrls,
      referenceAssetIds: opts.referenceAssetIds,
      variants: opts.variants,
      projectId: opts.projectId,
      workflowId: opts.workflowId,
      nodeId: opts.nodeId,
      runId: opts.runId,
      activityId: opts.activityId,
      preferredAssetId: opts.preferredAssetId,
      surface: opts.surface ?? (opts.projectId ? 'canvas' : 'direct'),
      actionKind: opts.actionKind ?? 'concept_art',
    };

    await this.genQueue.add(JOB_OPENAI_CONCEPT_ART, payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({
        event: 'openai_concept_art_enqueued',
        jobId,
        userId: opts.userId,
        requestId: opts.requestId,
        projectId: opts.projectId,
        variants: opts.variants,
        referenceCount: opts.referenceUrls?.length ?? 0,
      }),
    );
  }

  private async enqueueFluxConceptArt(
    opts: EnqueueConceptArtOpts & { prompt: string; variants: number },
  ): Promise<void> {
    if (opts.variants > 1) {
      throw new BadRequestException(
        'FLUX.2 variants>1 is not supported in a single run yet — enqueue parallel canvas runs via actions/run-batch',
      );
    }

    const jobId = bullJobId('replicate-image', opts.userId, opts.requestId);

    await this.appData.createRequestStatus({
      requestId: opts.requestId,
      userId: opts.userId,
      type: 'replicate-image',
      status: 'queued',
    });

    const payload: ReplicateGenerateImageJob = {
      requestId: opts.requestId,
      userId: opts.userId,
      prompt: opts.prompt,
      provider: 'flux2',
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      seed: opts.seed,
      referenceUrls: opts.referenceUrls,
      referenceAssetIds: opts.referenceAssetIds,
      projectId: opts.projectId,
      workflowId: opts.workflowId,
      nodeId: opts.nodeId,
      runId: opts.runId,
      activityId: opts.activityId,
      preferredAssetId: opts.preferredAssetId,
      surface: opts.surface ?? (opts.projectId ? 'canvas' : 'direct'),
      actionKind: opts.actionKind ?? 'concept_art',
    };

    await this.genQueue.add(JOB_REPLICATE_GENERATE_IMAGE, payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({
        event: 'replicate_flux_image_enqueued',
        jobId,
        userId: opts.userId,
        requestId: opts.requestId,
        projectId: opts.projectId,
        referenceCount: opts.referenceUrls?.length ?? 0,
      }),
    );
  }

  // ─── Ollama document suggestion ───────────────────────────────────────────

  async createOllamaDocumentSuggestion(
    userId: string,
    dto: { documentText: string; modelId: string },
  ): Promise<{ requestId: string; status: string }> {
    if (!this.ollama.isEnabled) {
      throw new BadRequestException(
        'Ollama is not available in this deployment. Use openai or replicate instead.',
      );
    }

    const requestId = randomUUID();
    const jobId = bullJobId('ollama-doc', userId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: 'ollama-document-suggestion',
      status: 'queued',
    });

    const payload: OllamaDocumentSuggestionJob = {
      requestId,
      userId,
      documentText: dto.documentText,
      modelId: dto.modelId,
    };

    await this.genQueue.add(JOB_OLLAMA_DOCUMENT_SUGGESTION, payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({
        event: 'ollama_doc_suggestion_enqueued',
        jobId,
        userId,
      }),
    );
    return { requestId, status: 'queued' };
  }

  async listOllamaModels() {
    if (!this.ollama.isEnabled) {
      throw new BadRequestException(
        'Ollama is not available in this deployment.',
      );
    }
    return this.ollama.listModels();
  }

  // ─── Shared ───────────────────────────────────────────────────────────────

  async cancelRequest(
    requestId: string,
    userId: string,
  ): Promise<{ requestId: string; status: string }> {
    const current = await this.appData.getRequestStatus(requestId);

    if (!current) return { requestId, status: 'not_found' };
    if (current.userId !== userId) return { requestId, status: 'forbidden' };
    if (['completed', 'failed', 'cancelled'].includes(current.status)) {
      return { requestId, status: current.status };
    }

    await this.appData.updateRequestStatus(requestId, 'cancelled');

    const job = await this.genQueue.getJob(bullJobId('gen', userId, requestId));
    if (job) await job.remove();

    return { requestId, status: 'cancelled' };
  }

  async getRequestStatus(
    requestId: string,
  ): Promise<GenerativeRequestStatusResponse | null> {
    const row = await this.appData.getRequestStatus(requestId);
    return row ? mapGenerativeRequestStatus(row) : null;
  }

  async waitForRequestStatus(
    requestId: string,
    userId: string,
    timeoutMs?: number,
  ): Promise<
    | GenerativeRequestStatusResponse
    | { requestId: string; status: 'forbidden' }
    | null
  > {
    const row = await this.appData.waitForRequestStatus(requestId, {
      timeoutMs: Math.min(Math.max(timeoutMs ?? 25_000, 1_000), 60_000),
      terminalOnly: true,
    });

    if (!row) return null;
    if (row.userId !== userId) return { requestId, status: 'forbidden' };
    return mapGenerativeRequestStatus(row);
  }
}
