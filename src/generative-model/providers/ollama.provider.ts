import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OllamaConfig } from '../../config/outbound.config.js';
import { outboundJson } from '../../integrations/outbound-http.js';
import { ProviderError } from '../../integrations/provider-error.model.js';

const PROVIDER = 'ollama';

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

interface OllamaChatResponse {
  message?: { content: string };
  done: boolean;
}

export interface OllamaModelInfo {
  name: string;
  modifiedAt: string;
  sizeBytes: number;
}

@Injectable()
export class OllamaProviderAdapter {
  private readonly logger = new Logger(OllamaProviderAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get cfg(): OllamaConfig {
    return this.config.get<OllamaConfig>('outbound.ollama')!;
  }

  /** Returns true only when OLLAMA_BASE_URL is configured. */
  get isEnabled(): boolean {
    return this.cfg.enabled;
  }

  /**
   * List models available on the backend-local Ollama instance.
   * Throws if Ollama is not configured.
   */
  async listModels(): Promise<OllamaModelInfo[]> {
    this.requireEnabled();

    const url = `${this.cfg.baseUrl}/api/tags`;
    const { data } = await outboundJson<OllamaTagsResponse>({
      provider: PROVIDER,
      url,
      timeoutMs: 10_000,
    });

    return (data.models ?? []).map((m) => ({
      name: m.name,
      modifiedAt: m.modified_at,
      sizeBytes: m.size,
    }));
  }

  /**
   * Generate a document suggestion using a backend-local Ollama model.
   * Note: 'localhost' here refers to the NestJS server's network, not the
   * end-user's machine. Only use in self-hosted/dev deployments.
   */
  async generateDocumentSuggestion(opts: {
    documentText: string;
    modelId: string;
    requestId: string;
    userId: string;
  }): Promise<string> {
    this.requireEnabled();

    const url = `${this.cfg.baseUrl}/api/chat`;

    const { data } = await outboundJson<OllamaChatResponse>({
      provider: PROVIDER,
      url,
      method: 'POST',
      body: {
        model: opts.modelId,
        messages: [
          {
            role: 'user',
            content: `Please analyse the following document and suggest improvements:\n\n${opts.documentText}`,
          },
        ],
        stream: false,
      },
      timeoutMs: this.cfg.timeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });

    const content = data.message?.content;
    if (!content) {
      throw ProviderError.permanent(PROVIDER, 'Ollama returned empty response');
    }

    this.logger.log(
      JSON.stringify({
        event: 'ollama_document_suggestion_complete',
        requestId: opts.requestId,
        userId: opts.userId,
        modelId: opts.modelId,
      }),
    );

    return content;
  }

  private requireEnabled(): void {
    if (!this.isEnabled) {
      throw ProviderError.permanent(
        PROVIDER,
        'Ollama is not available in this deployment. OLLAMA_BASE_URL is not configured.',
      );
    }
  }
}
