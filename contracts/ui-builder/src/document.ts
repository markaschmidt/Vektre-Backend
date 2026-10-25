import { z } from 'zod';
import {
  DocumentKindSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  SCHEMA_VERSION,
  SemanticIdSchema,
} from './common.js';
import {
  NodeReferenceSchema,
  Size2Schema,
  UIBlockDefinitionSchema,
  UIBlockInstanceSchema,
  UIComponentSchema,
  UIGroupSchema,
  Vector3Schema,
} from './blocks.js';

export const PlatformProfileSchema = z.strictObject({
  id: SemanticIdSchema,
  platform: z.enum(['desktop', 'mobile', 'console', 'web', 'vr', 'ar']),
  viewport: Size2Schema,
  safeArea: z
    .strictObject({
      top: z.number().finite().nonnegative(),
      right: z.number().finite().nonnegative(),
      bottom: z.number().finite().nonnegative(),
      left: z.number().finite().nonnegative(),
    })
    .optional(),
  inputModes: z
    .array(z.enum(['mouse', 'keyboard', 'touch', 'gamepad', 'gaze', 'motion']))
    .min(1),
});

export const SpatialProfileSchema = z.strictObject({
  id: SemanticIdSchema,
  mode: z.enum(['screen', 'world', 'head_locked', 'wrist', 'controller']),
  units: z.enum(['pixels', 'meters']),
  pixelsPerMeter: z.number().finite().positive().optional(),
});

export const SurfaceSchema = z.strictObject({
  id: SemanticIdSchema,
  name: z.string().min(1).max(256),
  kind: z.enum(['screen', 'world', 'head_locked', 'wrist', 'controller']),
  size: Size2Schema,
  position: Vector3Schema.optional(),
  rotationDegrees: Vector3Schema.optional(),
  platformProfileIds: z.array(SemanticIdSchema).min(1),
  spatialProfileId: SemanticIdSchema.optional(),
  metadata: JsonObjectSchema.optional(),
});

export const ScreenSchema = z.strictObject({
  id: SemanticIdSchema,
  name: z.string().min(1).max(256),
  surfaceIds: z.array(SemanticIdSchema).min(1),
  rootNodes: z.array(NodeReferenceSchema).max(2048),
  initialStateId: SemanticIdSchema.optional(),
  metadata: JsonObjectSchema.optional(),
});

export const FlowTransitionSchema = z.strictObject({
  id: SemanticIdSchema,
  fromScreenId: SemanticIdSchema,
  toScreenId: SemanticIdSchema,
  triggerInteractionId: SemanticIdSchema.optional(),
  condition: z.string().max(2048).optional(),
});

export const FlowSchema = z.strictObject({
  id: SemanticIdSchema,
  name: z.string().min(1).max(256),
  entryScreenId: SemanticIdSchema,
  screenIds: z.array(SemanticIdSchema).min(1),
  transitions: z.record(z.string(), FlowTransitionSchema),
});

export const DesignTokensSchema = z.strictObject({
  colors: z.record(z.string(), z.string().min(1).max(128)),
  typography: z.record(z.string(), JsonObjectSchema),
  spacing: z.record(z.string(), z.number().finite()),
  radii: z.record(z.string(), z.number().finite().nonnegative()),
  shadows: z.record(z.string(), JsonObjectSchema),
  motion: z.record(z.string(), JsonObjectSchema),
});

export const StyleDefinitionSchema = z.strictObject({
  id: SemanticIdSchema,
  name: z.string().min(1).max(256),
  properties: JsonObjectSchema,
  stateOverrides: z.record(z.string(), JsonObjectSchema).optional(),
});

export const LayeredAssetReferenceSchema = z.strictObject({
  id: SemanticIdSchema,
  assetId: z.string().min(1).max(256),
  role: z.enum([
    'icon',
    'frame',
    'background',
    'mask',
    'texture',
    'illustration',
  ]),
  layer: z.number().int(),
  nineSlice: z
    .strictObject({
      top: z.number().finite().nonnegative(),
      right: z.number().finite().nonnegative(),
      bottom: z.number().finite().nonnegative(),
      left: z.number().finite().nonnegative(),
    })
    .optional(),
  altText: z.string().max(512).optional(),
});

export const DataBindingSchema = z.strictObject({
  id: SemanticIdSchema,
  path: z.string().min(1).max(512),
  valueType: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  fallback: z.json().optional(),
  formatter: z.string().max(256).optional(),
});

export const UIStateSchema = z.strictObject({
  id: SemanticIdSchema,
  name: z.string().min(1).max(256),
  values: JsonObjectSchema,
});

export const InteractionSchema = z.strictObject({
  id: SemanticIdSchema,
  event: z.enum([
    'click',
    'submit',
    'change',
    'focus',
    'blur',
    'hover',
    'game_event',
    'timer',
  ]),
  action: z.enum([
    'navigate',
    'set_state',
    'emit_event',
    'invoke_binding',
    'open',
    'close',
  ]),
  targetId: SemanticIdSchema.optional(),
  parameters: JsonObjectSchema,
});

export const VisibilityRuleSchema = z.strictObject({
  id: SemanticIdSchema,
  expression: z.string().min(1).max(2048),
  description: z.string().max(512).optional(),
});

export const AnimationSchema = z.strictObject({
  id: SemanticIdSchema,
  targetId: SemanticIdSchema,
  property: z.string().min(1).max(256),
  durationMs: z.number().int().nonnegative().max(300000),
  easing: z.string().min(1).max(128),
  keyframes: z
    .array(
      z.strictObject({
        offset: z.number().finite().min(0).max(1),
        value: z.json(),
      }),
    )
    .min(2)
    .max(256),
});

export const LayoutConstraintSchema = z.strictObject({
  id: SemanticIdSchema,
  kind: z.enum([
    'align',
    'distance',
    'aspect_ratio',
    'inside_safe_area',
    'min_size',
    'max_size',
  ]),
  targetIds: z.array(SemanticIdSchema).min(1).max(128),
  parameters: JsonObjectSchema,
  priority: z.enum(['required', 'strong', 'medium', 'weak']),
});

export const ProvenanceSchema = z.strictObject({
  createdBy: z.enum(['human', 'ai', 'import', 'migration']),
  actorId: z.string().min(1).max(256).optional(),
  runId: z.string().min(1).max(256).optional(),
  sourceDocumentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  createdAt: IsoDateTimeSchema,
});

export const VektreUIDocumentV2Schema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  documentKind: DocumentKindSchema,
  metadata: z.strictObject({
    documentId: z.string().min(1).max(256),
    title: z.string().min(1).max(256),
    description: z.string().max(4096).optional(),
    tags: z.array(z.string().min(1).max(64)).max(64).optional(),
    createdAt: IsoDateTimeSchema.optional(),
    updatedAt: IsoDateTimeSchema.optional(),
  }),
  platformProfiles: z.record(z.string(), PlatformProfileSchema),
  spatialProfiles: z.record(z.string(), SpatialProfileSchema),
  screens: z.record(z.string(), ScreenSchema),
  surfaces: z.record(z.string(), SurfaceSchema),
  flows: z.record(z.string(), FlowSchema),
  groups: z.record(z.string(), UIGroupSchema),
  components: z.record(z.string(), UIComponentSchema),
  blockDefinitions: z.record(z.string(), UIBlockDefinitionSchema),
  blockInstances: z.record(z.string(), UIBlockInstanceSchema),
  designTokens: DesignTokensSchema,
  styles: z.record(z.string(), StyleDefinitionSchema),
  assets: z.record(z.string(), LayeredAssetReferenceSchema),
  bindings: z.record(z.string(), DataBindingSchema),
  states: z.record(z.string(), UIStateSchema),
  interactions: z.record(z.string(), InteractionSchema),
  visibilityRules: z.record(z.string(), VisibilityRuleSchema),
  animations: z.record(z.string(), AnimationSchema),
  constraints: z.record(z.string(), LayoutConstraintSchema),
  provenance: ProvenanceSchema.optional(),
});

/** Compatibility name for consumers migrating from the HUD-only vocabulary. */
export const HUDDocumentV2Schema = VektreUIDocumentV2Schema;

export type VektreUIDocumentV2 = z.infer<typeof VektreUIDocumentV2Schema>;
export type HUDDocumentV2 = VektreUIDocumentV2;
