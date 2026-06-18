import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReplicateConfig } from '../config/outbound.config.js';
import { outboundJson } from './outbound-http.js';
import { ProviderError } from './provider-error.model.js';

/** Replicate prediction status as returned by the API. */
type ReplicateRawStatus =
  | 'starting'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/** Normalised internal status shared across all providers. */
export type NormalisedStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/** 3D model file extensions extracted from prediction output URLs. */
const MODEL_EXTENSIONS = new Set(['.glb', '.gltf', '.obj', '.zip']);
/**
 * Preview image extensions — matches Rust's is_image_output_url().
 * Intentionally excludes .gif (Rust never included it).
 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export interface ReplicatePrediction {
  id: string;
  status: ReplicateRawStatus;
  /** Replicate output can be a flat string[], a nested object, or a single
   *  string depending on the model. Use collectOutputUrls() to extract URLs. */
  output?: unknown;
  error?: string | null;
  urls?: { get?: string; cancel?: string };
}

export interface NormalisedPrediction {
  predictionId: string;
  status: NormalisedStatus;
  modelUrls: string[];
  previewUrls: string[];
  errorMessage?: string;
  cancelUrl?: string;
}

/**
 * Fixed Hunyuan 3D 3.1 input parameters sent to Replicate.
 * Matches the Rust prepare_hunyuan_input() / ai_generate_3d_model behaviour.
 */
export interface HunyuanInput {
  enable_pbr: false;
  face_count: 500000;
  generate_type: 'Normal';
  /** Present for image-to-3D mode. Never set alongside prompt. */
  image?: string;
  /** Present for text-to-3D mode. Never set alongside image. */
  prompt?: string;
}

const PROVIDER = 'replicate';

@Injectable()
export class ReplicateProviderAdapter {
  private readonly logger = new Logger(ReplicateProviderAdapter.name);

  constructor(private readonly config: ConfigService) {}

  private get cfg(): ReplicateConfig {
    return this.config.get<ReplicateConfig>('outbound.replicate')!;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Kick off a Hunyuan 3D prediction on Replicate.
   * Returns the prediction ID for polling via `pollPrediction`.
   *
   * Mirrors Rust ai_generate_3d_model():
   * - Always sends enable_pbr=false, face_count=500000, generate_type=Normal.
   * - Sends exactly ONE of `image` or `prompt` — never both.
   * - Does NOT forward requestId/userId into the Replicate input body.
   */
  async startHunyuan3dPrediction(opts: {
    image?: string;
    prompt?: string;
    requestId: string;
    userId: string;
  }): Promise<string> {
    const url = `${this.cfg.baseUrl}/v1/models/tencent/hunyuan-3d-3.1/predictions`;

    const input = buildHunyuanInput(opts.image, opts.prompt);

    const { data } = await outboundJson<ReplicatePrediction>({
      provider: PROVIDER,
      url,
      method: 'POST',
      headers: this.authHeaders(),
      body: { input },
      timeoutMs: this.cfg.timeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });

    if (!data.id) {
      throw ProviderError.permanent(PROVIDER, 'Replicate did not return prediction ID');
    }

    this.logger.log(
      JSON.stringify({
        event: 'replicate_prediction_started',
        predictionId: data.id,
        requestId: opts.requestId,
        userId: opts.userId,
      }),
    );

    return data.id;
  }

  /**
   * Poll the status of an existing prediction.
   */
  async pollPrediction(opts: {
    predictionId: string;
    requestId: string;
    userId: string;
  }): Promise<NormalisedPrediction> {
    const url = `${this.cfg.baseUrl}/v1/predictions/${opts.predictionId}`;

    const { data } = await outboundJson<ReplicatePrediction>({
      provider: PROVIDER,
      url,
      method: 'GET',
      headers: this.authHeaders(),
      timeoutMs: this.cfg.timeoutMs,
      requestId: opts.requestId,
      userId: opts.userId,
    });

    return this.normalise(data);
  }

  /**
   * Cancel a running prediction.
   */
  async cancelPrediction(predictionId: string, requestId: string): Promise<void> {
    const url = `${this.cfg.baseUrl}/v1/predictions/${predictionId}/cancel`;
    await outboundJson({
      provider: PROVIDER,
      url,
      method: 'POST',
      headers: this.authHeaders(),
      timeoutMs: 15_000,
      requestId,
    });
  }

  /**
   * Normalise a raw Replicate prediction into the internal status model.
   *
   * Status mapping (mirrors Rust replicate_status_to_job()):
   *   starting / processing → running
   *   succeeded             → succeeded
   *   failed                → failed
   *   canceled              → canceled
   *   unknown               → running
   *
   * URL extraction uses recursive collect_output_urls() to handle both
   * flat string[] and nested { model, images } output shapes that
   * Hunyuan 3D 3.1 can return.
   */
  normalise(raw: ReplicatePrediction): NormalisedPrediction {
    let status: NormalisedStatus;
    switch (raw.status) {
      case 'starting':
      case 'processing':
        status = 'running';
        break;
      case 'succeeded':
        status = 'succeeded';
        break;
      case 'failed':
        status = 'failed';
        break;
      case 'canceled':
        status = 'canceled';
        break;
      default:
        status = 'running';
    }

    const allUrls = collectOutputUrls(raw.output);
    const modelUrls = allUrls.filter((u) => MODEL_EXTENSIONS.has(extOf(u)));
    const previewUrls = allUrls.filter((u) => IMAGE_EXTENSIONS.has(extOf(u)));

    return {
      predictionId: raw.id,
      status,
      modelUrls,
      previewUrls,
      errorMessage: raw.error ?? undefined,
      cancelUrl: raw.urls?.cancel,
    };
  }
}

/**
 * Build a Hunyuan-specific Replicate input body.
 * Always includes the fixed model defaults; adds exactly one of image or
 * prompt.  image takes priority when both are provided (caller should
 * already enforce XOR — this is a safety fallback).
 *
 * Exported for unit testing.
 */
export function buildHunyuanInput(image?: string, prompt?: string): HunyuanInput {
  const base = {
    enable_pbr: false as const,
    face_count: 500_000 as const,
    generate_type: 'Normal' as const,
  };
  if (image) return { ...base, image };
  return { ...base, prompt };
}

/**
 * Recursively collect all http(s):// strings from a Replicate output value.
 * Handles: string, string[], { model: string, images: string[] }, and any
 * other arbitrary nesting.  Mirrors Rust collect_output_urls().
 */
export function collectOutputUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.startsWith('http://') || value.startsWith('https://')
      ? [value]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectOutputUrls);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(collectOutputUrls);
  }
  return [];
}

function extOf(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    // Strip query string / fragment from pathname before looking at extension
    const clean = pathname.split('?')[0].split('#')[0];
    const dot = clean.lastIndexOf('.');
    return dot >= 0 ? clean.slice(dot).toLowerCase() : '';
  } catch {
    return '';
  }
}
