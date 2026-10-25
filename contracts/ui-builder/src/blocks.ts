import { z } from 'zod';
import {
  JsonObjectSchema,
  JsonValueSchema,
  OpaqueIdSchema,
  SemanticIdSchema,
} from './common.js';

export const Vector2Schema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const Vector3Schema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const Size2Schema = z.strictObject({
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const InsetsSchema = z.strictObject({
  top: z.number().finite(),
  right: z.number().finite(),
  bottom: z.number().finite(),
  left: z.number().finite(),
});

export const LayoutSchema = z.strictObject({
  mode: z.enum(['absolute', 'row', 'column', 'grid', 'stack']),
  position: Vector2Schema.optional(),
  size: Size2Schema.optional(),
  minSize: Size2Schema.optional(),
  maxSize: Size2Schema.optional(),
  padding: InsetsSchema.optional(),
  gap: z.number().finite().nonnegative().optional(),
  align: z
    .enum(['start', 'center', 'end', 'stretch', 'space_between'])
    .optional(),
  justify: z
    .enum(['start', 'center', 'end', 'stretch', 'space_between'])
    .optional(),
  gridColumns: z.number().int().positive().max(64).optional(),
  anchor: z
    .enum([
      'top_left',
      'top',
      'top_right',
      'left',
      'center',
      'right',
      'bottom_left',
      'bottom',
      'bottom_right',
      'stretch',
    ])
    .optional(),
});

export const TransformSchema = z.strictObject({
  translation: Vector3Schema.optional(),
  rotationDegrees: Vector3Schema.optional(),
  scale: Vector3Schema.optional(),
  pivot: Vector2Schema.optional(),
});

export const AccessibilitySchema = z.strictObject({
  label: z.string().max(512).optional(),
  hint: z.string().max(1024).optional(),
  role: z.string().max(64).optional(),
  focusOrder: z.number().int().nonnegative().optional(),
  hidden: z.boolean().optional(),
});

export const ComponentKindSchema = z.enum([
  'container',
  'text',
  'image',
  'button',
  'progress_bar',
  'meter',
  'counter',
  'reticle',
  'minimap',
  'compass',
  'objective_list',
  'ability_slot',
  'inventory_grid',
  'radial_menu',
  'dialogue',
  'subtitle',
  'notification',
  'status_effect',
  'input',
  'slider',
  'toggle',
  'list',
  'spacer',
]);

export const NodeReferenceSchema = z.strictObject({
  kind: z.enum(['group', 'component', 'block_instance']),
  id: SemanticIdSchema,
});

export const UIGroupSchema = z.strictObject({
  id: SemanticIdSchema,
  name: z.string().min(1).max(256),
  screenId: SemanticIdSchema,
  surfaceId: SemanticIdSchema,
  parentId: SemanticIdSchema.optional(),
  children: z.array(NodeReferenceSchema).max(2048),
  layout: LayoutSchema,
  transform: TransformSchema.optional(),
  zIndex: z.number().int(),
  styleId: SemanticIdSchema.optional(),
  visibilityRuleIds: z.array(SemanticIdSchema).max(128).optional(),
  accessibility: AccessibilitySchema.optional(),
  metadata: JsonObjectSchema.optional(),
});

export const UIComponentSchema = z.strictObject({
  id: SemanticIdSchema,
  kind: ComponentKindSchema,
  name: z.string().min(1).max(256),
  screenId: SemanticIdSchema,
  surfaceId: SemanticIdSchema,
  parentId: SemanticIdSchema.optional(),
  layout: LayoutSchema,
  transform: TransformSchema.optional(),
  zIndex: z.number().int(),
  styleId: SemanticIdSchema.optional(),
  assetIds: z.array(SemanticIdSchema).max(128).optional(),
  content: JsonObjectSchema.optional(),
  bindingIds: z.array(SemanticIdSchema).max(128).optional(),
  stateIds: z.array(SemanticIdSchema).max(128).optional(),
  interactionIds: z.array(SemanticIdSchema).max(128).optional(),
  visibilityRuleIds: z.array(SemanticIdSchema).max(128).optional(),
  accessibility: AccessibilitySchema.optional(),
  metadata: JsonObjectSchema.optional(),
});

export const BlockParameterSchema = z.strictObject({
  id: SemanticIdSchema,
  label: z.string().min(1).max(256),
  valueType: z.enum(['string', 'number', 'boolean', 'color', 'asset', 'json']),
  required: z.boolean(),
  defaultValue: JsonValueSchema.optional(),
});

export const BlockTemplateNodeSchema = z.strictObject({
  id: SemanticIdSchema,
  kind: z.enum(['group', 'component']),
  componentKind: ComponentKindSchema.optional(),
  parentId: SemanticIdSchema.optional(),
  children: z.array(SemanticIdSchema).max(2048),
  layout: LayoutSchema,
  zIndex: z.number().int(),
  styleId: SemanticIdSchema.optional(),
  content: JsonObjectSchema.optional(),
  parameterBindings: z.record(z.string(), z.string().max(512)).optional(),
});

export const UIBlockDefinitionSchema = z.strictObject({
  id: SemanticIdSchema,
  version: z.number().int().positive(),
  name: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  rootNodeIds: z.array(SemanticIdSchema).min(1).max(128),
  nodes: z.record(z.string(), BlockTemplateNodeSchema),
  parameters: z.record(z.string(), BlockParameterSchema),
  tags: z.array(z.string().min(1).max(64)).max(64).optional(),
  sourceBlockId: OpaqueIdSchema.optional(),
});

export const BlockOverrideSchema = z.strictObject({
  path: z.string().regex(/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/),
  value: JsonValueSchema,
});

export const UIBlockInstanceSchema = z.strictObject({
  id: SemanticIdSchema,
  definitionId: SemanticIdSchema,
  definitionVersion: z.number().int().positive(),
  screenId: SemanticIdSchema,
  surfaceId: SemanticIdSchema,
  parentId: SemanticIdSchema.optional(),
  layout: LayoutSchema,
  transform: TransformSchema.optional(),
  zIndex: z.number().int(),
  parameterValues: z.record(z.string(), JsonValueSchema),
  overrides: z.array(BlockOverrideSchema).max(1024),
  metadata: JsonObjectSchema.optional(),
});

export type UIGroup = z.infer<typeof UIGroupSchema>;
export type UIComponent = z.infer<typeof UIComponentSchema>;
export type UIBlockDefinition = z.infer<typeof UIBlockDefinitionSchema>;
export type UIBlockInstance = z.infer<typeof UIBlockInstanceSchema>;
