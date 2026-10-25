/**
 * Modular concept-art / image-generation contract.
 *
 * Canvas actions compose a provider-agnostic ImageGenerationRequest; the
 * generative-model service routes to OpenAI GPT Image or Replicate FLUX.2.
 * Results always normalize to PNG (or provider mime) bytes + optional URLs
 * so the processor can materialize project_asset rows identically.
 */

export const IMAGE_PROVIDER_IDS = ['gpt_image', 'flux2'] as const;
export type ImageProviderId = (typeof IMAGE_PROVIDER_IDS)[number];

export const DEFAULT_IMAGE_PROVIDER: ImageProviderId = 'gpt_image';

export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';
export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

export type FluxAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | 'match_input_image'
  | 'custom';

export interface ImageReferenceInput {
  /** Public or signed HTTPS URL the provider can fetch. */
  url: string;
  /** Optional project asset id (for metadata / audit). */
  assetId?: string;
  mimeType?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  /** Optional style hint composed into the final prompt when the provider lacks a native style field. */
  style?: string;
  provider: ImageProviderId;
  quality?: ImageQuality;
  size?: ImageSize;
  /** FLUX.2 aspect ratio (ignored by GPT Image). */
  aspectRatio?: FluxAspectRatio;
  /** Number of variants to generate in this job (1–4). */
  variants?: number;
  /** Reference / edit images (GPT Image edits, FLUX input_images). */
  references?: ImageReferenceInput[];
  seed?: number;
  requestId: string;
  userId: string;
}

export interface GeneratedImageVariant {
  /** Base64-encoded image bytes when the provider returns inline data. */
  imageBytesBase64?: string;
  /** Remote URL when the provider returns a delivery URI (e.g. Replicate). */
  sourceUrl?: string;
  mimeType: string;
  revisedPrompt?: string;
}

export interface ImageGenerationResult {
  provider: ImageProviderId;
  modelId: string;
  variants: GeneratedImageVariant[];
  /** Final prompt string sent upstream (after rich-text composition). */
  composedPrompt: string;
  /** OpenAI Images `usage` object when present (tokens; no dollar field). */
  providerUsage?: Record<string, unknown>;
}

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return (
    typeof value === 'string' &&
    (IMAGE_PROVIDER_IDS as readonly string[]).includes(value)
  );
}
