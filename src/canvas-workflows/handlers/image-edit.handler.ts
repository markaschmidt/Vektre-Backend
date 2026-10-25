import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  CanvasActionHandler,
  CanvasActionRunContext,
} from '../canvas-action.interface.js';
import { GenerativeModelService } from '../../generative-model/generative-model.service.js';
import { CanvasAssetOutputService } from '../canvas-asset-output.service.js';
import { AppDataService } from '../../integrations/app-data.service.js';
import {
  CANVAS_IMAGE_EDIT_MAX_IMAGES,
  CANVAS_RUN_PROMPT_MAX_LENGTH,
} from '../../collaboration-documents/models/canvas-graph.model.js';
import {
  DEFAULT_IMAGE_PROVIDER,
  isImageProviderId,
  type ImageProviderId,
} from '../../generative-model/image-generation/image-generation.types.js';
import { composeImagePrompt } from '../../generative-model/image-generation/prompt-composer.js';

const MAX_VARIANTS = 4;

/**
 * Explicit multimodal image edit action: text instruction + ≥1 source image.
 * Reuses GenerativeModelService.enqueueConceptArt (GPT Image edits / FLUX.2).
 */
@Injectable()
export class ImageEditActionHandler implements CanvasActionHandler {
  readonly kind = 'image_edit' as const;

  constructor(
    private readonly generative: GenerativeModelService,
    private readonly outputs: CanvasAssetOutputService,
    private readonly appData: AppDataService,
  ) {}

  async validate(ctx: CanvasActionRunContext): Promise<void> {
    const prompt = this.resolvePrompt(ctx);
    if (!prompt) {
      throw new BadRequestException(
        'image_edit requires an edit instruction (config.prompt or connected text on port "prompt")',
      );
    }
    if (prompt.length > CANVAS_RUN_PROMPT_MAX_LENGTH) {
      throw new BadRequestException(
        `image_edit prompt exceeds ${CANVAS_RUN_PROMPT_MAX_LENGTH} characters`,
      );
    }

    const imageAssetIds = this.resolveImageAssetIds(ctx);
    if (imageAssetIds.length === 0) {
      throw new BadRequestException(
        'image_edit requires at least one source image on port "image" (or config.imageAssetIds)',
      );
    }

    const provider = this.resolveProvider(ctx);
    const variants = this.resolveVariants(ctx);
    if (provider === 'flux2' && variants > 1) {
      throw new BadRequestException(
        'FLUX.2 does not support variants>1 in a single run — use actions/run-batch',
      );
    }

    for (const assetId of imageAssetIds) {
      const asset = await this.appData.getProjectAsset(assetId);
      if (!asset || asset.projectId !== ctx.projectId) {
        throw new BadRequestException(
          `Source image asset ${assetId} not found in this project`,
        );
      }
      if (!asset.objectPath) {
        throw new BadRequestException(
          `Source image asset ${assetId} has no bytes available`,
        );
      }
    }
  }

  async enqueue(ctx: CanvasActionRunContext): Promise<void> {
    const prompt = this.resolvePrompt(ctx);
    const style =
      typeof ctx.config.style === 'string' ? ctx.config.style : undefined;
    const provider = this.resolveProvider(ctx);
    const preferredAssetId = `edit-${ctx.runId.slice(0, 12)}`;

    const imageAssetIds = this.resolveImageAssetIds(ctx);
    const referenceUrls: string[] = [];
    for (const assetId of imageAssetIds) {
      const signed = await this.outputs.createSignedAssetUrl(
        ctx.projectId,
        assetId,
      );
      referenceUrls.push(signed.signedUrl);
    }

    await this.generative.enqueueConceptArt({
      requestId: ctx.requestId,
      userId: ctx.userId,
      prompt,
      style,
      provider,
      quality: this.optionalString(ctx.config.quality) as
        | 'low'
        | 'medium'
        | 'high'
        | 'auto'
        | undefined,
      size: this.optionalString(ctx.config.size) as
        | '1024x1024'
        | '1024x1536'
        | '1536x1024'
        | 'auto'
        | undefined,
      aspectRatio: this.optionalString(ctx.config.aspectRatio),
      resolution: this.optionalString(ctx.config.resolution),
      seed: typeof ctx.config.seed === 'number' ? ctx.config.seed : undefined,
      variants: this.resolveVariants(ctx),
      referenceUrls,
      referenceAssetIds: imageAssetIds,
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      nodeId: ctx.nodeId,
      runId: ctx.runId,
      activityId: ctx.activityId,
      preferredAssetId,
      surface: 'canvas',
      actionKind: 'image_edit',
    });
  }

  private resolvePrompt(ctx: CanvasActionRunContext): string {
    const configPrompt =
      typeof ctx.config.prompt === 'string' ? ctx.config.prompt : '';
    const connectedTexts = ctx.inputs.texts
      .filter((t) => !t.portId || t.portId === 'prompt')
      .map((t) => t.text);
    return composeImagePrompt({
      configPrompt,
      connectedTexts,
      useConnectedSectionText: ctx.config.useConnectedSectionText !== false,
      maxLength: CANVAS_RUN_PROMPT_MAX_LENGTH,
    });
  }

  private resolveProvider(ctx: CanvasActionRunContext): ImageProviderId {
    const raw = ctx.config.provider;
    if (raw == null || raw === '') return DEFAULT_IMAGE_PROVIDER;
    if (!isImageProviderId(raw)) {
      throw new BadRequestException(
        `image_edit provider must be one of: gpt_image, flux2 (got ${String(raw)})`,
      );
    }
    return raw;
  }

  private resolveVariants(ctx: CanvasActionRunContext): number {
    const raw = ctx.config.variants;
    if (raw == null) return 1;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > MAX_VARIANTS) {
      throw new BadRequestException(
        `image_edit variants must be an integer 1–${MAX_VARIANTS}`,
      );
    }
    return Math.floor(n);
  }

  private resolveImageAssetIds(ctx: CanvasActionRunContext): string[] {
    const fromPorts = ctx.inputs.assets
      .filter(
        (a) =>
          !a.portId ||
          a.portId === 'image' ||
          a.portId === 'reference' ||
          a.portId === 'asset',
      )
      .map((a) => a.assetId);

    const fromConfig = Array.isArray(ctx.config.imageAssetIds)
      ? ctx.config.imageAssetIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : [];

    return [...new Set([...fromPorts, ...fromConfig])].slice(
      0,
      CANVAS_IMAGE_EDIT_MAX_IMAGES,
    );
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
