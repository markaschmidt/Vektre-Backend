import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  GENERATIVE_MODEL_QUEUE,
  JOB_REPLICATE_GENERATE_3D,
  JOB_OPENAI_DOCUMENT_SUGGESTION,
  JOB_OPENAI_CONCEPT_ART,
  JOB_OLLAMA_DOCUMENT_SUGGESTION,
} from '../queues/queue-names.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { OllamaProviderAdapter } from './providers/ollama.provider.js';
import { bullJobId } from '../queues/bull-job-id.js';
import { heavyJobOptions } from '../queues/job-options.js';
import type { CreateGenRequestDto } from './dto/create-gen-request.dto.js';
import type {
  RunInferenceJob,
  ReplicateGenerate3dJob,
  OpenAiDocumentSuggestionJob,
  OpenAiConceptArtJob,
  OllamaDocumentSuggestionJob,
} from './models/gen-job.model.js';
import type { Create3dRequestDto, CreateDocumentSuggestionDto, CreateConceptArtDto } from './dto/generative-requests.dto.js';
import { mapGenerativeRequestStatus } from './generative-request-status.mapper.js';
import type { GenerativeRequestStatusResponse } from './models/generative-request-status.model.js';

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
    if (!dto.imageUrl && !dto.prompt) {
      throw new BadRequestException('Either imageUrl or prompt is required for Hunyuan 3D');
    }
    if (dto.imageUrl && dto.prompt) {
      throw new BadRequestException('Provide either imageUrl or prompt, not both — Hunyuan 3D uses one mode per request');
    }

    const requestId = randomUUID();
    const jobId = bullJobId('replicate-3d', userId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: 'replicate-3d',
      status: 'queued',
    });

    const payload: ReplicateGenerate3dJob = {
      requestId,
      userId,
      imageUrl: dto.imageUrl,
      prompt: dto.prompt,
    };

    await this.genQueue.add(JOB_REPLICATE_GENERATE_3D, payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({ event: 'replicate_3d_enqueued', jobId, userId }),
    );
    return { requestId, status: 'queued' };
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
      JSON.stringify({ event: 'openai_doc_suggestion_enqueued', jobId, userId }),
    );
    return { requestId, status: 'queued' };
  }

  // ─── OpenAI concept art ───────────────────────────────────────────────────

  async createConceptArt(
    userId: string,
    dto: CreateConceptArtDto,
  ): Promise<{ requestId: string; status: string }> {
    const requestId = randomUUID();
    const jobId = bullJobId('openai-art', userId, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: 'openai-concept-art',
      status: 'queued',
    });

    const payload: OpenAiConceptArtJob = {
      requestId,
      userId,
      prompt: dto.prompt,
      style: dto.style,
    };

    await this.genQueue.add(JOB_OPENAI_CONCEPT_ART, payload, {
      ...heavyJobOptions,
      jobId,
    });

    this.logger.log(
      JSON.stringify({ event: 'openai_concept_art_enqueued', jobId, userId }),
    );
    return { requestId, status: 'queued' };
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
      JSON.stringify({ event: 'ollama_doc_suggestion_enqueued', jobId, userId }),
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
  ): Promise<GenerativeRequestStatusResponse | { requestId: string; status: 'forbidden' } | null> {
    const row = await this.appData.waitForRequestStatus(requestId, {
      timeoutMs: Math.min(Math.max(timeoutMs ?? 25_000, 1_000), 60_000),
      terminalOnly: true,
    });

    if (!row) return null;
    if (row.userId !== userId) return { requestId, status: 'forbidden' };
    return mapGenerativeRequestStatus(row);
  }
}
