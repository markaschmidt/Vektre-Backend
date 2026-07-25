import {
  CANVAS_IMAGE_EDIT_MAX_IMAGES,
  CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
  CANVAS_NODE_PORT_DEFS,
  CANVAS_RUN_PROMPT_MAX_LENGTH,
  CANVAS_YJS_SCHEMA_VERSION,
  type CanvasActionKind,
  type CanvasNodeKind,
} from '../../collaboration-documents/models/canvas-graph.model.js';

export interface CanvasNodeCapability {
  kind: CanvasNodeKind;
  label: string;
  category: 'source' | 'action' | 'output';
  actionKind?: CanvasActionKind;
  ports: (typeof CANVAS_NODE_PORT_DEFS)[CanvasNodeKind];
  configSchema: Record<string, unknown>;
}

export interface CanvasCapabilitiesResponse {
  schemaVersion: typeof CANVAS_YJS_SCHEMA_VERSION;
  documentType: 'canvas';
  yjsLayout: {
    description: string;
    rootMaps: string[];
  };
  nodes: CanvasNodeCapability[];
  actions: Array<{
    actionKind: CanvasActionKind;
    activityType: string;
    providers: string[];
    constraints: Record<string, unknown>;
  }>;
  limits: {
    promptMaxLength: number;
    imageSplitMaxOutputs: number;
    imageEditMaxImages: number;
    batchMaxActions: number;
  };
}

export function buildCanvasCapabilitiesResponse(): CanvasCapabilitiesResponse {
  return {
    schemaVersion: CANVAS_YJS_SCHEMA_VERSION,
    documentType: 'canvas',
    yjsLayout: {
      description:
        'Nested Yjs maps: workflows -> {meta, nodes, edges}. One canvas room per project; switch workflows via awareness.activeWorkflowId.',
      rootMaps: ['workflows'],
    },
    nodes: [
      {
        kind: 'storyboard_section',
        label: 'Storyboard section',
        category: 'source',
        ports: CANVAS_NODE_PORT_DEFS.storyboard_section,
        configSchema: {
          source: {
            documentId: 'string',
            headerBlockId: 'string',
            sectionText: 'string',
            contentHash: 'string',
            documentVersion: 'number?',
          },
        },
      },
      {
        kind: 'repository_asset',
        label: 'Repository asset',
        category: 'source',
        ports: CANVAS_NODE_PORT_DEFS.repository_asset,
        configSchema: {
          source: { assetId: 'string', assetType: 'string?', name: 'string?' },
        },
      },
      {
        kind: 'concept_art',
        label: 'Concept art',
        category: 'action',
        actionKind: 'concept_art',
        ports: CANVAS_NODE_PORT_DEFS.concept_art,
        configSchema: {
          prompt: 'string? — override; otherwise connected rich-text / storyboard',
          style: 'string?',
          useConnectedSectionText: 'boolean? — default true',
          provider: '"gpt_image" | "flux2" — default gpt_image',
          quality: '"low"|"medium"|"high"|"auto" — GPT Image only',
          size: '"1024x1024"|"1024x1536"|"1536x1024"|"auto" — GPT Image only',
          aspectRatio: 'string? — FLUX.2 only',
          resolution: 'string? — FLUX.2 only',
          seed: 'number? — FLUX.2 only',
          variants: 'number? — 1–4, GPT Image only',
          referenceAssetIds: 'string[]? — extra refs beyond connected ports',
        },
      },
      {
        kind: 'image_edit',
        label: 'Image edit',
        category: 'action',
        actionKind: 'image_edit',
        ports: CANVAS_NODE_PORT_DEFS.image_edit,
        configSchema: {
          prompt: 'string? — edit instruction override',
          style: 'string?',
          useConnectedSectionText: 'boolean? — default true',
          provider: '"gpt_image" | "flux2" — default gpt_image',
          quality: '"low"|"medium"|"high"|"auto" — GPT Image only',
          size: '"1024x1024"|"1024x1536"|"1536x1024"|"auto" — GPT Image only',
          aspectRatio: 'string? — FLUX.2 only',
          resolution: 'string? — FLUX.2 only',
          seed: 'number? — FLUX.2 only',
          variants: 'number? — 1–4, GPT Image only',
          imageAssetIds: 'string[]? — extra source images beyond connected ports',
        },
      },
      {
        kind: 'model_3d',
        label: '3D model',
        category: 'action',
        actionKind: 'model_3d',
        ports: CANVAS_NODE_PORT_DEFS.model_3d,
        configSchema: {
          prompt: 'string? — Hunyuan 3.1 text-to-3D only',
          preferImageInput: 'boolean? — 3.1: default true when an image is connected',
          hunyuanModel:
            '"3.1"|"2mv" — default 3.1; auto 2mv when ≥2 multiview ports wired',
          multiviewAssetIds:
            '{ front?, back?, left?, right? }? — alternative to multiview ports',
          qualityTier: '"prop"|"hero" — 3.1 only; default prop (40k / Geometry)',
          faceCount: 'number? — 3.1: 40000–1500000; 2mv fallback via targetFaceNum',
          targetFaceNum: 'number? — 2mv only: 100–1000000; default 10000',
          generateType:
            '"Normal"|"Geometry"|"LowPoly" — 3.1 only; LowPoly → Geometry',
          enablePbr: 'boolean? — 3.1 only; default false',
          octreeResolution: 'number? — 2mv only: 16–512',
          useCustomFaceCount: 'boolean?',
          customFaceCount: 'number? — when useCustomFaceCount',
        },
      },
      {
        kind: 'image_split',
        label: 'Image split',
        category: 'action',
        actionKind: 'image_split',
        ports: CANVAS_NODE_PORT_DEFS.image_split,
        configSchema: {
          mode: '"regions" | "grid"',
          regions: 'CanvasCropRegion[]?',
          grid: '{ rows, columns }?',
          maxOutputs: 'number?',
        },
      },
      {
        kind: 'asset_output',
        label: 'Asset output',
        category: 'output',
        ports: CANVAS_NODE_PORT_DEFS.asset_output,
        configSchema: { assetId: 'string?' },
      },
    ],
    actions: [
      {
        actionKind: 'concept_art',
        activityType: 'image_generation',
        providers: ['openai', 'replicate'],
        constraints: {
          promptMaxLength: CANVAS_RUN_PROMPT_MAX_LENGTH,
          requiresTextOrConfigPrompt: true,
          imageProviders: ['gpt_image', 'flux2'],
          defaultImageProvider: 'gpt_image',
          maxVariants: 4,
          maxReferenceImages: 8,
          supportsReferenceImages: true,
          realtime: true,
          staysOnCanvas: true,
        },
      },
      {
        actionKind: 'image_edit',
        activityType: 'image_generation',
        providers: ['openai', 'replicate'],
        constraints: {
          promptMaxLength: CANVAS_RUN_PROMPT_MAX_LENGTH,
          requiresPrompt: true,
          requiresImageInput: true,
          multimodal: true,
          imageProviders: ['gpt_image', 'flux2'],
          defaultImageProvider: 'gpt_image',
          maxSourceImages: CANVAS_IMAGE_EDIT_MAX_IMAGES,
          maxVariants: 4,
          openaiEndpoint: '/v1/images/edits',
          fluxUsesInputImages: true,
          realtime: true,
          staysOnCanvas: true,
          note: 'Text + ≥1 image required. Reuses enqueueConceptArt / project_asset materialization.',
        },
      },
      {
        actionKind: 'model_3d',
        activityType: 'model_generation',
        providers: ['replicate'],
        constraints: {
          promptMaxLength: CANVAS_RUN_PROMPT_MAX_LENGTH,
          requiresPromptOrImage: true,
          exclusiveModes: true,
          hunyuanModels: [
            {
              id: '3.1',
              replicateModel: 'tencent/hunyuan-3d-3.1',
              modes: ['text', 'single_image'],
              faceCountRange: { min: 40_000, max: 1_500_000 },
            },
            {
              id: '2mv',
              replicateModel: 'tencent/hunyuan3d-2mv',
              modes: ['multiview_image'],
              minViews: 2,
              maxViews: 4,
              viewPorts: ['front', 'back', 'left', 'right'],
              targetFaceNumRange: { min: 100, max: 1_000_000 },
            },
          ],
          defaultHunyuanModel: '3.1',
          autoSelect2mvWhenMultiviewPorts: 2,
          model: 'tencent/hunyuan-3d-3.1',
          realtime: true,
          staysOnCanvas: true,
          note: 'Pick hunyuanModel or wire ≥2 view ports for 2mv. GLB imported as project_asset.',
        },
      },
      {
        actionKind: 'image_split',
        activityType: 'ai_task',
        providers: ['local'],
        constraints: {
          maxOutputs: CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
          requiresImageInput: true,
          supportedFormats: ['image/png'],
          notes: '8-bit PNG only (built-in cropper)',
        },
      },
    ],
    limits: {
      promptMaxLength: CANVAS_RUN_PROMPT_MAX_LENGTH,
      imageSplitMaxOutputs: CANVAS_IMAGE_SPLIT_MAX_OUTPUTS,
      imageEditMaxImages: CANVAS_IMAGE_EDIT_MAX_IMAGES,
      batchMaxActions: 16,
    },
  };
}
