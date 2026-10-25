import { z } from 'zod';
import {
  ComponentKindSchema,
  type UIComponent,
  type UIGroup,
} from './blocks.js';
import { JsonObjectSchema, SemanticIdSchema } from './common.js';
import {
  VektreUIDocumentV2Schema,
  type VektreUIDocumentV2,
} from './document.js';

const HUDNodeV1Schema = z.strictObject({
  id: SemanticIdSchema,
  kind: z.string().min(1).max(128),
  parentId: SemanticIdSchema.optional(),
  surfaceId: SemanticIdSchema.optional(),
  layout: JsonObjectSchema.optional(),
  transform: JsonObjectSchema.optional(),
  anchor: z.string().max(64).optional(),
  zIndex: z.number().int().optional(),
  styleRef: SemanticIdSchema.optional(),
  assetRefs: z.array(SemanticIdSchema).optional(),
  content: JsonObjectSchema.optional(),
  binding: z.string().max(512).optional(),
  states: JsonObjectSchema.optional(),
  interactions: z.array(JsonObjectSchema).optional(),
  visibilityRules: z.array(JsonObjectSchema).optional(),
  accessibility: JsonObjectSchema.optional(),
});

export const HUDDocumentV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  metadata: JsonObjectSchema,
  platformProfiles: z.array(JsonObjectSchema),
  surfaces: z.array(JsonObjectSchema),
  designTokens: JsonObjectSchema,
  assets: z.record(z.string(), JsonObjectSchema),
  nodes: z.array(HUDNodeV1Schema),
  bindings: z.array(JsonObjectSchema),
  states: z.array(JsonObjectSchema),
  animations: z.array(JsonObjectSchema),
  constraints: z.array(JsonObjectSchema),
});

export type HUDDocumentV1 = z.infer<typeof HUDDocumentV1Schema>;

function isComponentKind(value: string): value is UIComponent['kind'] {
  return ComponentKindSchema.safeParse(value).success;
}

function legacyAssets(legacy: HUDDocumentV1): VektreUIDocumentV2['assets'] {
  const roles = new Set([
    'icon',
    'frame',
    'background',
    'mask',
    'texture',
    'illustration',
  ]);

  return Object.fromEntries(
    Object.entries(legacy.assets).map(([id, value]) => {
      const assetId =
        typeof value.assetId === 'string' ? value.assetId : `legacy-${id}`;
      const role =
        typeof value.role === 'string' && roles.has(value.role)
          ? value.role
          : 'illustration';
      return [
        id,
        {
          id,
          assetId,
          role,
          layer: typeof value.layer === 'number' ? value.layer : 0,
          altText:
            typeof value.altText === 'string' ? value.altText : undefined,
        },
      ];
    }),
  ) as VektreUIDocumentV2['assets'];
}

/**
 * Compatibility migration for the historical HUD-shaped proposal. Legacy
 * fields remain available under node/document metadata when no v2 equivalent
 * exists, so migration is non-destructive.
 */
export function migrateHUDDocumentV1(input: unknown): VektreUIDocumentV2 {
  const legacy = HUDDocumentV1Schema.parse(input);
  const surfaceId =
    (legacy.surfaces[0]?.id as string | undefined) ?? 'main_surface';
  const groups: Record<string, UIGroup> = {};
  const components: Record<string, UIComponent> = {};
  const childRefs = new Map<
    string,
    Array<{ kind: 'group' | 'component'; id: string }>
  >();

  for (const node of legacy.nodes) {
    if (node.parentId) {
      const refs = childRefs.get(node.parentId) ?? [];
      refs.push({
        kind: node.kind === 'group' ? 'group' : 'component',
        id: node.id,
      });
      childRefs.set(node.parentId, refs);
    }
  }

  for (const node of legacy.nodes) {
    if (node.kind === 'group') {
      groups[node.id] = {
        id: node.id,
        name: node.id,
        screenId: 'main_screen',
        surfaceId: node.surfaceId ?? surfaceId,
        parentId: node.parentId,
        children: childRefs.get(node.id) ?? [],
        layout: {
          mode: 'absolute',
          position: { x: 0, y: 0 },
          size: { width: 0, height: 0 },
        },
        zIndex: node.zIndex ?? 0,
        styleId: node.styleRef,
        metadata: { legacyNode: node },
      };
      continue;
    }

    components[node.id] = {
      id: node.id,
      kind: isComponentKind(node.kind) ? node.kind : 'container',
      name: node.id,
      screenId: 'main_screen',
      surfaceId: node.surfaceId ?? surfaceId,
      parentId: node.parentId,
      layout: {
        mode: 'absolute',
        position: { x: 0, y: 0 },
        size: { width: 0, height: 0 },
      },
      zIndex: node.zIndex ?? 0,
      styleId: node.styleRef,
      assetIds: node.assetRefs,
      content: node.content,
      accessibility: node.accessibility,
      metadata: {
        legacyKind: node.kind,
        legacyNode: node,
      },
    };
  }

  const rootNodes = legacy.nodes
    .filter((node) => !node.parentId)
    .map((node) => ({
      kind: node.kind === 'group' ? ('group' as const) : ('component' as const),
      id: node.id,
    }));

  return VektreUIDocumentV2Schema.parse({
    schemaVersion: 2,
    documentKind: 'hud',
    metadata: {
      documentId:
        (legacy.metadata.documentId as string | undefined) ?? 'legacy-hud',
      title: (legacy.metadata.title as string | undefined) ?? 'Migrated HUD',
      description: 'Migrated from HUDDocument v1',
    },
    platformProfiles: {
      desktop: {
        id: 'desktop',
        platform: 'desktop',
        viewport: { width: 1920, height: 1080 },
        inputModes: ['mouse', 'keyboard', 'gamepad'],
      },
    },
    spatialProfiles: {
      screen: { id: 'screen', mode: 'screen', units: 'pixels' },
    },
    screens: {
      main_screen: {
        id: 'main_screen',
        name: 'Main',
        surfaceIds: [surfaceId],
        rootNodes,
        metadata: { legacyMetadata: legacy.metadata },
      },
    },
    surfaces: {
      [surfaceId]: {
        id: surfaceId,
        name: surfaceId,
        kind: 'screen',
        size: { width: 1920, height: 1080 },
        platformProfileIds: ['desktop'],
        spatialProfileId: 'screen',
        metadata: { legacySurfaces: legacy.surfaces },
      },
    },
    flows: {},
    groups,
    components,
    blockDefinitions: {},
    blockInstances: {},
    designTokens: {
      colors: {},
      typography: {},
      spacing: {},
      radii: {},
      shadows: {},
      motion: {},
    },
    styles: {},
    assets: legacyAssets(legacy),
    bindings: {},
    states: {},
    interactions: {},
    visibilityRules: {},
    animations: {},
    constraints: {},
    provenance: {
      createdBy: 'migration',
      createdAt: '1970-01-01T00:00:00.000Z',
    },
  });
}
