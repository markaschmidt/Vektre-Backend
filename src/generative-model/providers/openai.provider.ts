import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { OpenAiConfig } from '../../config/outbound.config.js';
import { outboundJson } from '../../integrations/outbound-http.js';
import { ProviderError } from '../../integrations/provider-error.model.js';
import type {
  DesignDocumentSuggestion,
  ConceptArtResult,
} from '../models/gen-output.model.js';

const PROVIDER = 'openai';

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

interface ImageGenerationResponse {
  data: { b64_json?: string; revised_prompt?: string }[];
}

@Injectable()
export class OpenAiProviderAdapter {
  private readonly logger = new Logger(OpenAiProviderAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get cfg(): OpenAiConfig {
    return this.config.get<OpenAiConfig>('outbound.openai')!;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Generate structured document suggestions using GPT chat completions.
   * Preserves the JSON output contract for DesignDocumentSuggestion.
   */
  async generateDocumentSuggestion(opts: {
    documentText: string;
    context?: string;
    requestId: string;
    userId: string;
  }): Promise<DesignDocumentSuggestion> {
    const url = `${this.cfg.baseUrl}/v1/chat/completions`;

    const systemPrompt = `You are a helpful design assistant. Analyse the provided design document and return a structured JSON object with the following shape:
{"title": string, "summary": string, "suggestions": string[], "tags": string[]}
Only return the JSON object, no surrounding text.`;

    const userContent = opts.context
      ? `Context: ${opts.context}\n\nDocument:\n${opts.documentText}`
      : opts.documentText;

    const { data } = await outboundJson<ChatCompletionResponse>({
      provider: PROVIDER,
      url,
      method: 'POST',
      headers: this.authHeaders(),
      body: {
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      },
      timeoutMs: this.cfg.timeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      throw ProviderError.permanent(PROVIDER, 'OpenAI returned empty content');
    }

    let parsed: DesignDocumentSuggestion;
    try {
      parsed = JSON.parse(raw) as DesignDocumentSuggestion;
    } catch {
      throw ProviderError.permanent(
        PROVIDER,
        `Failed to parse OpenAI JSON response: ${raw.slice(0, 200)}`,
      );
    }

    if (!Array.isArray(parsed.suggestions)) {
      parsed.suggestions = [];
    }

    this.logger.log(
      JSON.stringify({
        event: 'openai_document_suggestion_complete',
        requestId: opts.requestId,
        userId: opts.userId,
        tagCount: parsed.tags?.length ?? 0,
        suggestionCount: parsed.suggestions.length,
      }),
    );

    return parsed;
  }

  /**
   * Generate concept art using DALL-E 3 (images/generations).
   * Returns a base64-encoded PNG normalised into a stored output reference.
   */
  async generateConceptArt(opts: {
    prompt: string;
    style?: string;
    requestId: string;
    userId: string;
  }): Promise<ConceptArtResult> {
    const url = `${this.cfg.baseUrl}/v1/images/generations`;

    const fullPrompt = opts.style
      ? `${opts.prompt}, style: ${opts.style}`
      : opts.prompt;

    const { data } = await outboundJson<ImageGenerationResponse>({
      provider: PROVIDER,
      url,
      method: 'POST',
      headers: this.authHeaders(),
      body: {
        model: 'dall-e-3',
        prompt: fullPrompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      },
      timeoutMs: this.cfg.timeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });

    const imageData = data.data?.[0];
    if (!imageData?.b64_json) {
      throw ProviderError.permanent(PROVIDER, 'OpenAI returned no image data');
    }

    const assetId = randomUUID();
    // In production, write the base64 buffer to SpacetimeDB-backed asset storage.
    // and return the storage reference. For now we use a placeholder ref.
    const storageRef = `generated/concept-art/${opts.userId}/${assetId}.png`;

    this.logger.log(
      JSON.stringify({
        event: 'openai_concept_art_complete',
        requestId: opts.requestId,
        userId: opts.userId,
        assetId,
      }),
    );

    return {
      assetRef: {
        assetId,
        storageRef,
        mimeType: 'image/png',
      },
      revisedPrompt: imageData.revised_prompt,
    };
  }
}
