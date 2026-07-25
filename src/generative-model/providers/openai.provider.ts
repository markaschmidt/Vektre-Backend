import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { OpenAiConfig } from '../../config/outbound.config.js';
import {
  outboundJson,
  outboundMultipart,
  outboundBinary,
} from '../../integrations/outbound-http.js';
import { ProviderError } from '../../integrations/provider-error.model.js';
import type {
  DesignDocumentSuggestion,
  ConceptArtResult,
} from '../models/gen-output.model.js';
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  GeneratedImageVariant,
} from '../image-generation/image-generation.types.js';

const PROVIDER = 'openai';

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
}

interface ImageGenerationResponse {
  data: { b64_json?: string; url?: string; revised_prompt?: string }[];
  usage?: Record<string, unknown>;
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

  private authHeadersNoContentType(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
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
   * Generate concept art via the configured GPT Image model.
   * Prefer {@link generateImage} for new callers; this wrapper preserves the
   * legacy ConceptArtResult shape used by older tests/call sites.
   */
  async generateConceptArt(opts: {
    prompt: string;
    style?: string;
    requestId: string;
    userId: string;
    quality?: ImageGenerationRequest['quality'];
    size?: ImageGenerationRequest['size'];
    references?: ImageGenerationRequest['references'];
    variants?: number;
  }): Promise<ConceptArtResult> {
    const result = await this.generateImage({
      prompt: opts.prompt,
      style: opts.style,
      provider: 'gpt_image',
      quality: opts.quality,
      size: opts.size,
      references: opts.references,
      variants: opts.variants ?? 1,
      requestId: opts.requestId,
      userId: opts.userId,
    });

    const first = result.variants[0];
    if (!first?.imageBytesBase64) {
      throw ProviderError.permanent(PROVIDER, 'OpenAI returned no image data');
    }

    const assetId = randomUUID();
    const storageRef = `generated/concept-art/${opts.userId}/${assetId}.png`;

    return {
      assetRef: {
        assetId,
        storageRef,
        mimeType: first.mimeType,
        sourceUrl: first.sourceUrl,
      },
      revisedPrompt: first.revisedPrompt,
      imageBytesBase64: first.imageBytesBase64,
    };
  }

  /**
   * Modular GPT Image generation (text-to-image) or edits (with references).
   * Uses OPENAI_IMAGE_MODEL (default gpt-image-2).
   */
  async generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const composedPrompt = request.style
      ? `${request.prompt}\n\nStyle: ${request.style}`
      : request.prompt;

    const model = this.cfg.imageModel;
    const quality = request.quality ?? this.cfg.imageQuality;
    const size = request.size ?? this.cfg.imageSize;
    const n = Math.min(Math.max(request.variants ?? 1, 1), 4);
    const refs = request.references ?? [];

    const imageTimeoutMs = this.resolveImageTimeoutMs(quality);

    const data =
      refs.length > 0
        ? await this.callImageEdits({
            model,
            prompt: composedPrompt,
            quality,
            size,
            n,
            references: refs,
            requestId: request.requestId,
            userId: request.userId,
            timeoutMs: imageTimeoutMs,
          })
        : await this.callImageGenerations({
            model,
            prompt: composedPrompt,
            quality,
            size,
            n,
            requestId: request.requestId,
            userId: request.userId,
            timeoutMs: imageTimeoutMs,
          });

    const variants = await this.normalizeImageData(data, request);

    if (variants.length === 0) {
      throw ProviderError.permanent(PROVIDER, 'OpenAI returned no image data');
    }

    this.logger.log(
      JSON.stringify({
        event: 'openai_image_generation_complete',
        requestId: request.requestId,
        userId: request.userId,
        model,
        variantCount: variants.length,
        usedReferences: refs.length,
      }),
    );

    return {
      provider: 'gpt_image',
      modelId: model,
      variants,
      composedPrompt,
      providerUsage: data.usage,
    };
  }

  /** OpenAI `quality: high` can exceed 3 min; use a longer outbound timeout. */
  private resolveImageTimeoutMs(quality: string): number {
    if (quality === 'high') {
      return this.cfg.imageHighTimeoutMs;
    }
    return this.cfg.imageTimeoutMs;
  }

  private async callImageGenerations(opts: {
    model: string;
    prompt: string;
    quality: string;
    size: string;
    n: number;
    requestId: string;
    userId: string;
    timeoutMs: number;
  }): Promise<ImageGenerationResponse> {
    const url = `${this.cfg.baseUrl}/v1/images/generations`;
    const body: Record<string, unknown> = {
      model: opts.model,
      prompt: opts.prompt,
      n: opts.n,
      size: opts.size,
      quality: opts.quality,
    };

    // Legacy dall-e-3 still supports response_format; GPT Image returns b64 by default.
    if (opts.model.startsWith('dall-e')) {
      body.response_format = 'b64_json';
      // DALL-E 3 only allows n=1
      body.n = 1;
    }

    const { data } = await outboundJson<ImageGenerationResponse>({
      provider: PROVIDER,
      url,
      method: 'POST',
      headers: this.authHeaders(),
      body,
      timeoutMs: opts.timeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });
    return data;
  }

  private async callImageEdits(opts: {
    model: string;
    prompt: string;
    quality: string;
    size: string;
    n: number;
    references: NonNullable<ImageGenerationRequest['references']>;
    requestId: string;
    userId: string;
    timeoutMs: number;
  }): Promise<ImageGenerationResponse> {
    const url = `${this.cfg.baseUrl}/v1/images/edits`;

    // Download reference images so we can multipart-upload them.
    const imageBuffers: Buffer[] = [];
    for (const ref of opts.references.slice(0, 10)) {
      const bytes = await outboundBinary({
        provider: PROVIDER,
        url: ref.url,
        timeoutMs: 60_000,
        requestId: opts.requestId,
        userId: opts.userId,
      });
      imageBuffers.push(bytes);
    }

    if (imageBuffers.length === 0) {
      throw ProviderError.permanent(
        PROVIDER,
        'No reference image bytes available for GPT Image edits',
      );
    }

    const form: Record<
      string,
      string | Blob | Buffer | Array<string | Blob | Buffer>
    > = {
      model: opts.model,
      prompt: opts.prompt,
      n: String(opts.n),
      size: opts.size,
      quality: opts.quality,
      image: imageBuffers.map(
        (buf, i) =>
          new Blob([new Uint8Array(buf)], { type: 'image/png' }) as Blob,
      ),
    };

    // Attach filenames via File when available (Node 20+).
    if (typeof File !== 'undefined') {
      form.image = imageBuffers.map(
        (buf, i) =>
          new File([new Uint8Array(buf)], `reference-${i}.png`, {
            type: 'image/png',
          }),
      );
    }

    const { data } = await outboundMultipart<ImageGenerationResponse>({
      provider: PROVIDER,
      url,
      method: 'POST',
      headers: this.authHeadersNoContentType(),
      form,
      timeoutMs: opts.timeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });
    return data;
  }

  private async normalizeImageData(
    data: ImageGenerationResponse,
    request: ImageGenerationRequest,
  ): Promise<GeneratedImageVariant[]> {
    const variants: GeneratedImageVariant[] = [];
    for (const item of data.data ?? []) {
      if (item.b64_json) {
        variants.push({
          imageBytesBase64: item.b64_json,
          mimeType: 'image/png',
          revisedPrompt: item.revised_prompt,
        });
        continue;
      }
      if (item.url) {
        const bytes = await outboundBinary({
          provider: PROVIDER,
          url: item.url,
          timeoutMs: 60_000,
          requestId: request.requestId,
          userId: request.userId,
        });
        variants.push({
          imageBytesBase64: bytes.toString('base64'),
          sourceUrl: item.url,
          mimeType: 'image/png',
          revisedPrompt: item.revised_prompt,
        });
      }
    }
    return variants;
  }
}
