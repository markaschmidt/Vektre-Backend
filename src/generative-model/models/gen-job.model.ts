export type GenJobName =
  | 'run-inference'
  | 'replicate-generate-3d'
  | 'replicate-poll-3d'
  | 'openai-document-suggestion'
  | 'openai-concept-art'
  | 'replicate-generate-image'
  | 'replicate-poll-image'
  | 'ollama-document-suggestion'
  | 'canvas-image-split';

export interface RunInferenceJob {
  requestId: string;
  userId: string;
  prompt: string;
  modelProvider: string;
  modelId: string;
  inputRefs: string[];
}

export interface CanvasActionJobContext {
  projectId?: string;
  /** Owner-scoped local desktop project (mutually exclusive with projectId). */
  localProjectId?: string;
  workflowId?: string;
  nodeId?: string;
  runId?: string;
  activityId?: string;
  preferredAssetId?: string;
  /** Foundry asset name — imported prop display title (`metadata.displayName`). */
  displayName?: string;
  /**
   * Attribution surface for cost analytics.
   * storyboard | foundry | canvas | direct
   */
  surface?:
    | 'storyboard'
    | 'foundry'
    | 'canvas'
    | 'gui_screen'
    | 'direct'
    | 'unknown';
  actionKind?: string;
}

import type { Hunyuan2mvGenerationOptions } from '../hunyuan-2mv-options.js';
import type { Hunyuan3dGenerationOptions } from '../hunyuan-3d-options.js';
import type {
  HunyuanModelVariant,
  HunyuanMultiviewUrls,
} from '../hunyuan-3d-model.js';

export interface ReplicateGenerate3dJob extends CanvasActionJobContext {
  requestId: string;
  userId: string;
  hunyuanModel?: HunyuanModelVariant;
  imageUrl?: string;
  prompt?: string;
  multiviewUrls?: HunyuanMultiviewUrls;
  hunyuanOptions?: Hunyuan3dGenerationOptions;
  hunyuan2mvOptions?: Hunyuan2mvGenerationOptions;
}

export interface ReplicatePoll3dJob extends CanvasActionJobContext {
  requestId: string;
  userId: string;
  predictionId: string;
  hunyuanModel?: HunyuanModelVariant;
  /** Original text prompt (for prop file naming on import). */
  prompt?: string;
  /** Foundry asset name override for `metadata.displayName` on import. */
  displayName?: string;
  /** ISO timestamp – processor skips if job queued time is too old */
  enqueuedAt: string;
}

export interface OpenAiConceptArtJob extends CanvasActionJobContext {
  requestId: string;
  userId: string;
  prompt: string;
  style?: string;
  /** gpt_image (default) — routed through OpenAI GPT Image. */
  provider?: 'gpt_image';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  /** Signed HTTPS URLs for reference / edit images. */
  referenceUrls?: string[];
  referenceAssetIds?: string[];
  /** 1–4 variants in a single OpenAI request. */
  variants?: number;
}

export interface ReplicateGenerateImageJob extends CanvasActionJobContext {
  requestId: string;
  userId: string;
  prompt: string;
  style?: string;
  provider: 'flux2';
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  referenceUrls?: string[];
  referenceAssetIds?: string[];
}

export interface ReplicatePollImageJob extends CanvasActionJobContext {
  requestId: string;
  userId: string;
  predictionId: string;
  enqueuedAt: string;
  provider: 'flux2';
  composedPrompt: string;
  referenceAssetIds?: string[];
}

export interface OpenAiDocumentSuggestionJob {
  requestId: string;
  userId: string;
  documentText: string;
  context?: string;
}

export interface OllamaDocumentSuggestionJob {
  requestId: string;
  userId: string;
  documentText: string;
  modelId: string;
}

export interface CanvasImageSplitJob extends CanvasActionJobContext {
  requestId: string;
  userId: string;
  projectId: string;
  workflowId: string;
  nodeId: string;
  runId: string;
  activityId: string;
  sourceAssetId: string;
  config: {
    mode: 'regions' | 'grid';
    regions?: Array<{ x: number; y: number; width: number; height: number }>;
    grid?: { rows: number; columns: number };
    maxOutputs?: number;
  };
}
