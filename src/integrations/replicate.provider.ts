import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReplicateConfig } from '../config/outbound.config.js';
import {
  HUNYUAN_2MV_DEFAULT_OPTIONS,
  type Hunyuan2mvGenerationOptions,
} from '../generative-model/hunyuan-2mv-options.js';
import {
  HUNYUAN_3D_DEFAULT_OPTIONS,
  type Hunyuan3dGenerationOptions,
  type HunyuanGenerateType,
} from '../generative-model/hunyuan-3d-options.js';
import {
  HUNYUAN_REPLICATE_MODEL_2MV,
  HUNYUAN_REPLICATE_MODEL_3_1,
  type HunyuanMultiviewUrls,
} from '../generative-model/hunyuan-3d-model.js';
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
export type NormalisedStatus = 'running' | 'succeeded' | 'failed' | 'canceled';

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
  /**
   * Present on terminated predictions. Includes predict_time / total_time
   * (seconds). Replicate does NOT return a dollar cost field.
   */
  metrics?: {
    predict_time?: number;
    total_time?: number;
    [k: string]: unknown;
  };
}

export interface NormalisedPrediction {
  predictionId: string;
  status: NormalisedStatus;
  modelUrls: string[];
  previewUrls: string[];
  /** All http(s) URLs found in the output, regardless of extension. */
  outputUrls: string[];
  errorMessage?: string;
  cancelUrl?: string;
  /** Raw Replicate metrics (predict_time, total_time) when present. */
  metrics?: {
    predict_time?: number;
    total_time?: number;
    [k: string]: unknown;
  };
}

/**
 * Fixed Hunyuan 3D 3.1 input parameters sent to Replicate.
 * Matches the Rust prepare_hunyuan_input() / ai_generate_3d_model behaviour.
 */
export interface HunyuanInput {
  enable_pbr: boolean;
  face_count: number;
  generate_type: HunyuanGenerateType;
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
   * - Sends face_count / generate_type / enable_pbr from caller (Prop default: 40k / Geometry).
   * - Sends exactly ONE of `image` or `prompt` — never both.
   * - Does NOT forward requestId/userId into the Replicate input body.
   */
  async startHunyuan3dPrediction(opts: {
    image?: string;
    prompt?: string;
    generation?: Hunyuan3dGenerationOptions;
    requestId: string;
    userId: string;
  }): Promise<string> {
    const url = `${this.cfg.baseUrl}/v1/models/${HUNYUAN_REPLICATE_MODEL_3_1}/predictions`;

    const input = buildHunyuanInput(
      opts.image,
      opts.prompt,
      opts.generation ?? HUNYUAN_3D_DEFAULT_OPTIONS,
    );

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
      throw ProviderError.permanent(
        PROVIDER,
        'Replicate did not return prediction ID',
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'replicate_prediction_started',
        predictionId: data.id,
        requestId: opts.requestId,
        userId: opts.userId,
        model: HUNYUAN_REPLICATE_MODEL_3_1,
      }),
    );

    return data.id;
  }

  /**
   * Kick off a Hunyuan3D-2mv multiview prediction on Replicate.
   * Requires at least one view URL; best results with front/back/left/right.
   */
  async startHunyuan2mvPrediction(opts: {
    views: HunyuanMultiviewUrls;
    generation?: Hunyuan2mvGenerationOptions;
    requestId: string;
    userId: string;
  }): Promise<string> {
    const url = `${this.cfg.baseUrl}/v1/models/${HUNYUAN_REPLICATE_MODEL_2MV}/predictions`;
    const input = buildHunyuan2mvInput(opts.views, opts.generation);

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
      throw ProviderError.permanent(
        PROVIDER,
        'Replicate did not return prediction ID',
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'replicate_prediction_started',
        predictionId: data.id,
        requestId: opts.requestId,
        userId: opts.userId,
        model: HUNYUAN_REPLICATE_MODEL_2MV,
        viewCount: Object.keys(input).filter((k) => k.endsWith('_image'))
          .length,
      }),
    );

    return data.id;
  }

  /**
   * Kick off a FLUX.2 image prediction on Replicate.
   * Poll via {@link pollPrediction}; image URLs land in previewUrls.
   */
  async startFluxImagePrediction(opts: {
    prompt: string;
    inputImages?: string[];
    aspectRatio?: string;
    resolution?: string;
    seed?: number;
    outputFormat?: 'png' | 'jpg' | 'webp';
    requestId: string;
    userId: string;
  }): Promise<string> {
    const model = this.cfg.fluxModel;
    const url = `${this.cfg.baseUrl}/v1/models/${model}/predictions`;

    const input: Record<string, unknown> = {
      prompt: opts.prompt,
      output_format: opts.outputFormat ?? 'png',
      safety_tolerance: 2,
    };
    if (opts.inputImages && opts.inputImages.length > 0) {
      input.input_images = opts.inputImages.slice(0, 8);
    }
    if (opts.aspectRatio) input.aspect_ratio = opts.aspectRatio;
    if (opts.resolution) input.resolution = opts.resolution;
    if (opts.seed != null) input.seed = opts.seed;

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
      throw ProviderError.permanent(
        PROVIDER,
        'Replicate did not return prediction ID',
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'replicate_flux_prediction_started',
        predictionId: data.id,
        requestId: opts.requestId,
        userId: opts.userId,
        model,
        referenceCount: opts.inputImages?.length ?? 0,
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
  async cancelPrediction(
    predictionId: string,
    requestId: string,
  ): Promise<void> {
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
      outputUrls: allUrls,
      errorMessage: raw.error ?? undefined,
      cancelUrl: raw.urls?.cancel,
      metrics: raw.metrics,
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
export function buildHunyuanInput(
  image?: string,
  prompt?: string,
  generation: Hunyuan3dGenerationOptions = HUNYUAN_3D_DEFAULT_OPTIONS,
): HunyuanInput {
  const base: HunyuanInput = {
    enable_pbr: generation.enable_pbr,
    face_count: generation.face_count,
    generate_type: generation.generate_type,
  };
  if (image) return { ...base, image };
  return { ...base, prompt };
}

export function buildHunyuan2mvInput(
  views: HunyuanMultiviewUrls,
  generation?: Hunyuan2mvGenerationOptions,
): Record<string, unknown> {
  const opts = generation ?? HUNYUAN_2MV_DEFAULT_OPTIONS;

  const input: Record<string, unknown> = {
    steps: opts.steps,
    guidance_scale: opts.guidance_scale,
    target_face_num: opts.target_face_num,
    octree_resolution: opts.octree_resolution,
    remove_background: opts.remove_background,
    randomize_seed: opts.randomize_seed,
    file_type: opts.file_type,
  };

  if (views.front) input.front_image = views.front;
  if (views.back) input.back_image = views.back;
  if (views.left) input.left_image = views.left;
  if (views.right) input.right_image = views.right;

  if (opts.seed != null && !opts.randomize_seed) {
    input.seed = opts.seed;
  }

  return input;
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
    return Object.values(value as Record<string, unknown>).flatMap(
      collectOutputUrls,
    );
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
