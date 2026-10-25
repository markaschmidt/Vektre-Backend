/**
 * Versioned Canvas workflow graph contract.
 *
 * Cloud truth lives in the singleton `canvas` collaboration document room as
 * nested Yjs maps. The backend does not mutate graph topology over REST —
 * clients write nodes/edges via Hocuspocus. Action side-effects go through
 * POST .../canvas/actions/run and durable collaboration_activity rows.
 *
 * Yjs layout (recommended):
 *   root
 *     schemaVersion: Y.Text | string field "canvas.v2"
 *     workflows: Y.Map<workflowId, Y.Map>
 *       workflow.meta: { name, origin, createdAt, updatedAt, ... }
 *       workflow.nodes: Y.Map<nodeId, CanvasNode>
 *       workflow.edges: Y.Map<edgeId, CanvasEdge>
 *
 * Offline/export (.vkt) may snapshot the same JSON shape under
 * `metadata.canvasWorkflows` / a dedicated canvas section — cloud Yjs wins.
 */

export const CANVAS_YJS_SCHEMA_VERSION = 'canvas.v2' as const;

export type CanvasPortDataType = 'text' | 'image' | 'model' | 'asset' | 'any';

export type CanvasNodeKind =
  | 'storyboard_section'
  | 'repository_asset'
  | 'concept_art'
  | 'image_edit'
  | 'model_3d'
  | 'image_split'
  | 'asset_output';

export type CanvasActionKind =
  | 'concept_art'
  | 'image_edit'
  | 'model_3d'
  | 'image_split';

export type CanvasWorkflowOrigin = 'user' | 'ai';

export interface CanvasPortDef {
  portId: string;
  label: string;
  dataType: CanvasPortDataType;
  /** Max edges that may connect to this port (1 = single, >1 = fan-in/out). */
  maxConnections: number;
  required?: boolean;
}

export interface CanvasNodePosition {
  x: number;
  y: number;
}

/** Stable storyboard header-section reference (client extracts headers). */
export interface StoryboardSectionSource {
  documentId: string;
  /** Stable block/heading id inside the storyboard Yjs tree. */
  headerBlockId: string;
  title?: string;
  /** Snapshot of section text used for generation (reproducibility). */
  sectionText: string;
  contentHash: string;
  documentVersion?: number;
}

export interface RepositoryAssetSource {
  assetId: string;
  assetType?: string;
  name?: string;
  mimeType?: string;
}

export interface CanvasCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSplitGridConfig {
  rows: number;
  columns: number;
}

export interface ImageSplitConfig {
  mode: 'regions' | 'grid';
  regions?: CanvasCropRegion[];
  grid?: ImageSplitGridConfig;
  /** Hard cap on child assets created per run. */
  maxOutputs?: number;
}

export interface ConceptArtConfig {
  prompt?: string;
  style?: string;
  /** When set, prompt is composed from connected storyboard / rich-text inputs. */
  useConnectedSectionText?: boolean;
  /** Image provider: gpt_image (OpenAI GPT Image) or flux2 (Replicate FLUX.2). */
  provider?: 'gpt_image' | 'flux2';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  /** FLUX.2 aspect ratio. */
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  /** 1–4 variants (GPT Image only in a single run). */
  variants?: number;
  referenceAssetIds?: string[];
}

/**
 * Multimodal image edit: required text prompt + one or more source images.
 * Same providers as concept_art; routes to GPT Image edits / FLUX input_images.
 */
export interface ImageEditConfig {
  prompt?: string;
  style?: string;
  /** Compose connected text ports into the edit instruction (default true). */
  useConnectedSectionText?: boolean;
  provider?: 'gpt_image' | 'flux2';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  variants?: number;
  /** Extra source images beyond connected `image` ports. */
  imageAssetIds?: string[];
}

export interface Model3dConfig {
  prompt?: string;
  /** Prefer connected image input over text when both present. */
  preferImageInput?: boolean;
}

export type CanvasNodeConfig =
  | ConceptArtConfig
  | ImageEditConfig
  | Model3dConfig
  | ImageSplitConfig
  | Record<string, unknown>;

export interface CanvasNodeBase {
  nodeId: string;
  kind: CanvasNodeKind;
  label: string;
  position: CanvasNodePosition;
  /** Last completed/failed run id for this node (client-updated from activity). */
  lastRunId?: string;
  lastActivityId?: string;
  updatedAt?: string;
}

export interface StoryboardSectionNode extends CanvasNodeBase {
  kind: 'storyboard_section';
  source: StoryboardSectionSource;
}

export interface RepositoryAssetNode extends CanvasNodeBase {
  kind: 'repository_asset';
  source: RepositoryAssetSource;
}

export interface ConceptArtNode extends CanvasNodeBase {
  kind: 'concept_art';
  config: ConceptArtConfig;
}

export interface ImageEditNode extends CanvasNodeBase {
  kind: 'image_edit';
  config: ImageEditConfig;
}

export interface Model3dNode extends CanvasNodeBase {
  kind: 'model_3d';
  config: Model3dConfig;
}

export interface ImageSplitNode extends CanvasNodeBase {
  kind: 'image_split';
  config: ImageSplitConfig;
}

export interface AssetOutputNode extends CanvasNodeBase {
  kind: 'asset_output';
  /** Filled after reconcile from action result. */
  assetId?: string;
  assetRole?: string;
}

export type CanvasNode =
  | StoryboardSectionNode
  | RepositoryAssetNode
  | ConceptArtNode
  | ImageEditNode
  | Model3dNode
  | ImageSplitNode
  | AssetOutputNode;

export interface CanvasEdge {
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface CanvasWorkflowMeta {
  workflowId: string;
  name: string;
  origin: CanvasWorkflowOrigin;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export interface CanvasWorkflow {
  meta: CanvasWorkflowMeta;
  nodes: Record<string, CanvasNode>;
  edges: Record<string, CanvasEdge>;
}

export interface CanvasDocument {
  schemaVersion: typeof CANVAS_YJS_SCHEMA_VERSION;
  /** Map of workflowId → workflow. Empty object is valid for a new project. */
  workflows: Record<string, CanvasWorkflow>;
}

/** Offline/export snapshot fragment for project manifests (.vkt). */
export interface CanvasProjectFileFragment {
  schemaVersion: typeof CANVAS_YJS_SCHEMA_VERSION;
  activeWorkflowId?: string;
  workflows: CanvasWorkflow[];
}

export const CANVAS_NODE_PORT_DEFS: Record<
  CanvasNodeKind,
  { inputs: CanvasPortDef[]; outputs: CanvasPortDef[] }
> = {
  storyboard_section: {
    inputs: [],
    outputs: [
      {
        portId: 'text',
        label: 'Section text',
        dataType: 'text',
        maxConnections: 16,
      },
    ],
  },
  repository_asset: {
    inputs: [],
    outputs: [
      {
        portId: 'asset',
        label: 'Asset',
        dataType: 'asset',
        maxConnections: 16,
      },
      {
        portId: 'image',
        label: 'Image',
        dataType: 'image',
        maxConnections: 16,
      },
    ],
  },
  concept_art: {
    inputs: [
      {
        portId: 'prompt',
        label: 'Prompt / section',
        dataType: 'text',
        maxConnections: 4,
        required: false,
      },
      {
        portId: 'reference',
        label: 'Reference image',
        dataType: 'image',
        maxConnections: 4,
        required: false,
      },
    ],
    outputs: [
      {
        portId: 'image',
        label: 'Concept art',
        dataType: 'image',
        maxConnections: 16,
      },
      {
        portId: 'asset',
        label: 'Asset',
        dataType: 'asset',
        maxConnections: 16,
      },
    ],
  },
  image_edit: {
    inputs: [
      {
        portId: 'prompt',
        label: 'Edit instruction',
        dataType: 'text',
        maxConnections: 4,
        required: true,
      },
      {
        portId: 'image',
        label: 'Source image(s)',
        dataType: 'image',
        maxConnections: 8,
        required: true,
      },
    ],
    outputs: [
      {
        portId: 'image',
        label: 'Edited image',
        dataType: 'image',
        maxConnections: 16,
      },
      {
        portId: 'asset',
        label: 'Asset',
        dataType: 'asset',
        maxConnections: 16,
      },
    ],
  },
  model_3d: {
    inputs: [
      {
        portId: 'prompt',
        label: 'Prompt',
        dataType: 'text',
        maxConnections: 2,
        required: false,
      },
      {
        portId: 'image',
        label: 'Image',
        dataType: 'image',
        maxConnections: 1,
        required: false,
      },
      {
        portId: 'front',
        label: 'Front',
        dataType: 'image',
        maxConnections: 1,
        required: false,
      },
      {
        portId: 'back',
        label: 'Back',
        dataType: 'image',
        maxConnections: 1,
        required: false,
      },
      {
        portId: 'left',
        label: 'Left',
        dataType: 'image',
        maxConnections: 1,
        required: false,
      },
      {
        portId: 'right',
        label: 'Right',
        dataType: 'image',
        maxConnections: 1,
        required: false,
      },
    ],
    outputs: [
      {
        portId: 'model',
        label: '3D model',
        dataType: 'model',
        maxConnections: 16,
      },
      {
        portId: 'asset',
        label: 'Asset',
        dataType: 'asset',
        maxConnections: 16,
      },
    ],
  },
  image_split: {
    inputs: [
      {
        portId: 'image',
        label: 'Image',
        dataType: 'image',
        maxConnections: 1,
        required: true,
      },
    ],
    outputs: [
      {
        portId: 'slices',
        label: 'Slices',
        dataType: 'image',
        maxConnections: 64,
      },
      {
        portId: 'assets',
        label: 'Assets',
        dataType: 'asset',
        maxConnections: 64,
      },
    ],
  },
  asset_output: {
    inputs: [
      {
        portId: 'asset',
        label: 'Asset',
        dataType: 'asset',
        maxConnections: 1,
        required: true,
      },
    ],
    outputs: [],
  },
};

export const CANVAS_ACTION_KINDS: readonly CanvasActionKind[] = [
  'concept_art',
  'image_edit',
  'model_3d',
  'image_split',
] as const;

export const CANVAS_IMAGE_EDIT_MAX_IMAGES = 8;

export function isCanvasActionKind(value: unknown): value is CanvasActionKind {
  return (
    typeof value === 'string' &&
    (CANVAS_ACTION_KINDS as readonly string[]).includes(value)
  );
}

export function actionKindToActivityType(
  kind: CanvasActionKind,
): 'image_generation' | 'model_generation' | 'ai_task' {
  switch (kind) {
    case 'concept_art':
    case 'image_edit':
      return 'image_generation';
    case 'model_3d':
      return 'model_generation';
    case 'image_split':
      return 'ai_task';
  }
}

/** Port compatibility for execution validation (draft graphs may still be invalid). */
export function arePortsCompatible(
  source: CanvasPortDataType,
  target: CanvasPortDataType,
): boolean {
  if (source === 'any' || target === 'any') return true;
  if (source === target) return true;
  if (source === 'asset' && (target === 'image' || target === 'model'))
    return true;
  if ((source === 'image' || source === 'model') && target === 'asset')
    return true;
  return false;
}

export const CANVAS_IMAGE_SPLIT_MAX_OUTPUTS = 64;
/** Soft cap for composed concept-art / 3D prompts (rich text after stripping). */
export const CANVAS_RUN_PROMPT_MAX_LENGTH = 4000;
