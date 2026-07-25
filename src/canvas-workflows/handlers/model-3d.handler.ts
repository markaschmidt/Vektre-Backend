import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  CanvasActionHandler,
  CanvasActionRunContext,
} from '../canvas-action.interface.js';
import { GenerativeModelService } from '../../generative-model/generative-model.service.js';
import { resolveHunyuan2mvOptions } from '../../generative-model/hunyuan-2mv-options.js';
import {
  isValidHunyuanGenerateType,
  isValidHunyuanQualityTier,
  resolveHunyuan3dOptions,
} from '../../generative-model/hunyuan-3d-options.js';
import {
  countMultiviewAssets,
  HUNYUAN_MULTIVIEW_PORTS,
  isValidHunyuanModelVariant,
  resolveHunyuanModelVariant,
  resolveMultiviewAssetIds,
  type HunyuanMultiviewAssetIds,
  type HunyuanMultiviewUrls,
} from '../../generative-model/hunyuan-3d-model.js';
import { CanvasAssetOutputService } from '../canvas-asset-output.service.js';
import { AppDataService } from '../../integrations/app-data.service.js';
import { CANVAS_RUN_PROMPT_MAX_LENGTH } from '../../collaboration-documents/models/canvas-graph.model.js';

@Injectable()
export class Model3dActionHandler implements CanvasActionHandler {
  readonly kind = 'model_3d' as const;

  constructor(
    private readonly generative: GenerativeModelService,
    private readonly outputs: CanvasAssetOutputService,
    private readonly appData: AppDataService,
  ) {}

  async validate(ctx: CanvasActionRunContext): Promise<void> {
    const multiviewAssetIds = resolveMultiviewAssetIds(
      ctx.config,
      ctx.inputs.assets,
    );
    const multiviewCount = countMultiviewAssets(multiviewAssetIds);
    const hunyuanModel = resolveHunyuanModelVariant(ctx.config, multiviewCount);

    if (
      typeof ctx.config.hunyuanModel === 'string' &&
      !isValidHunyuanModelVariant(ctx.config.hunyuanModel)
    ) {
      throw new BadRequestException(
        `Invalid model_3d hunyuanModel: ${ctx.config.hunyuanModel}`,
      );
    }

    const configPrompt =
      typeof ctx.config.prompt === 'string' ? ctx.config.prompt.trim() : '';
    const textParts = ctx.inputs.texts.map((t) => t.text.trim()).filter(Boolean);
    const prompt = configPrompt || textParts.join('\n\n');
    const imageAssetId = this.resolveSingleImageAssetId(ctx);

    if (hunyuanModel === '2mv') {
      if (prompt) {
        throw new BadRequestException(
          'model_3d multiview (hunyuanModel 2mv) does not support text prompts — wire front/back/left/right image assets',
        );
      }
      if (multiviewCount < 2) {
        throw new BadRequestException(
          'model_3d multiview (2mv) requires at least two view images (ports front/back/left/right or config.multiviewAssetIds)',
        );
      }
      await this.validateMultiviewAssets(ctx, multiviewAssetIds);
      return;
    }

    if (!prompt && !imageAssetId) {
      throw new BadRequestException(
        'model_3d requires either a prompt/section text or an image asset input (hunyuanModel 3.1)',
      );
    }
    if (prompt.length > CANVAS_RUN_PROMPT_MAX_LENGTH) {
      throw new BadRequestException(
        `model_3d prompt exceeds ${CANVAS_RUN_PROMPT_MAX_LENGTH} characters`,
      );
    }

    const qualityTier =
      typeof ctx.config.qualityTier === 'string' ? ctx.config.qualityTier : undefined;
    if (qualityTier && !isValidHunyuanQualityTier(qualityTier)) {
      throw new BadRequestException(
        `Invalid model_3d qualityTier: ${qualityTier}`,
      );
    }
    const generateType =
      typeof ctx.config.generateType === 'string'
        ? ctx.config.generateType
        : undefined;
    if (generateType && !isValidHunyuanGenerateType(generateType)) {
      throw new BadRequestException(
        `Invalid model_3d generateType: ${generateType}`,
      );
    }
    if (imageAssetId) {
      await this.validateImageAsset(ctx, imageAssetId);
    }
  }

  async enqueue(ctx: CanvasActionRunContext): Promise<void> {
    const multiviewAssetIds = resolveMultiviewAssetIds(
      ctx.config,
      ctx.inputs.assets,
    );
    const multiviewCount = countMultiviewAssets(multiviewAssetIds);
    const hunyuanModel = resolveHunyuanModelVariant(ctx.config, multiviewCount);

    const base = {
      requestId: ctx.requestId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      nodeId: ctx.nodeId,
      runId: ctx.runId,
      activityId: ctx.activityId,
      preferredAssetId: `model-${ctx.runId.slice(0, 12)}`,
      surface: 'canvas' as const,
      actionKind: 'model_3d',
      hunyuanModel,
    };

    if (hunyuanModel === '2mv') {
      const multiviewUrls = await this.signMultiviewUrls(
        ctx.projectId,
        multiviewAssetIds,
      );
      await this.generative.enqueue3dRequest({
        ...base,
        multiviewUrls,
        hunyuan2mvOptions: resolveHunyuan2mvOptions(ctx.config),
      });
      return;
    }

    const configPrompt =
      typeof ctx.config.prompt === 'string' ? ctx.config.prompt.trim() : '';
    const textParts = ctx.inputs.texts.map((t) => t.text.trim()).filter(Boolean);
    const prompt = configPrompt || textParts.join('\n\n');
    const imageAssetId = this.resolveSingleImageAssetId(ctx);
    const preferImage = ctx.config.preferImageInput !== false;

    let imageUrl: string | undefined;
    let finalPrompt: string | undefined;

    if (imageAssetId && (preferImage || !prompt)) {
      const signed = await this.outputs.createSignedAssetUrl(
        ctx.projectId,
        imageAssetId,
      );
      imageUrl = signed.signedUrl;
    } else {
      finalPrompt = prompt;
    }

    if (imageUrl && finalPrompt) {
      finalPrompt = undefined;
    }

    await this.generative.enqueue3dRequest({
      ...base,
      imageUrl,
      prompt: finalPrompt,
      hunyuanOptions: resolveHunyuan3dOptions(ctx.config),
    });
  }

  private resolveSingleImageAssetId(
    ctx: CanvasActionRunContext,
  ): string | undefined {
    const imagePort = ctx.inputs.assets.find(
      (a) => !a.portId || a.portId === 'image' || a.portId === 'asset',
    );
    return imagePort?.assetId;
  }

  private async validateImageAsset(
    ctx: CanvasActionRunContext,
    assetId: string,
  ): Promise<void> {
    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== ctx.projectId) {
      throw new BadRequestException(
        `Image asset ${assetId} not found in this project`,
      );
    }
    if (!asset.objectPath) {
      throw new BadRequestException(
        `Image asset ${assetId} has no bytes available`,
      );
    }
  }

  private async validateMultiviewAssets(
    ctx: CanvasActionRunContext,
    ids: HunyuanMultiviewAssetIds,
  ): Promise<void> {
    for (const port of HUNYUAN_MULTIVIEW_PORTS) {
      const assetId = ids[port];
      if (!assetId) continue;
      await this.validateImageAsset(ctx, assetId);
    }
  }

  private async signMultiviewUrls(
    projectId: string,
    ids: HunyuanMultiviewAssetIds,
  ): Promise<HunyuanMultiviewUrls> {
    const urls: HunyuanMultiviewUrls = {};
    for (const port of HUNYUAN_MULTIVIEW_PORTS) {
      const assetId = ids[port];
      if (!assetId) continue;
      const signed = await this.outputs.createSignedAssetUrl(projectId, assetId);
      urls[port] = signed.signedUrl;
    }
    return urls;
  }
}
