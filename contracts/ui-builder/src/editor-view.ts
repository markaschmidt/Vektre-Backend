import { z } from 'zod';
import {
  UIBlockInstanceSchema,
  UIComponentSchema,
  UIGroupSchema,
} from './blocks.js';
import { canonicalJson } from './canonical-json.js';
import { JsonValueSchema, SemanticIdSchema, Sha256Schema } from './common.js';
import {
  DataBindingSchema,
  StyleDefinitionSchema,
  UIStateSchema,
  VektreUIDocumentV2Schema,
  type VektreUIDocumentV2,
} from './document.js';

export const DesignRectSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export const EditorFieldOfViewSchema = z.strictObject({
  screenId: SemanticIdSchema,
  surfaceId: SemanticIdSchema.optional(),
  visibleRect: DesignRectSchema,
  zoom: z.number().finite().positive().max(64),
  selectedIds: z.array(SemanticIdSchema).max(256),
  inspectorPath: z.string().max(2048).optional(),
  activeStateId: SemanticIdSchema.optional(),
});

export const ElementKindSchema = z.enum([
  'group',
  'component',
  'block_instance',
]);

export const ElementStateSnapshotSchema = z.strictObject({
  id: SemanticIdSchema,
  kind: ElementKindSchema,
  node: z.union([UIGroupSchema, UIComponentSchema, UIBlockInstanceSchema]),
  resolvedStyle: StyleDefinitionSchema.optional(),
  content: JsonValueSchema.optional(),
  bindings: z.array(DataBindingSchema).max(128),
  activeState: UIStateSchema.optional(),
});

/** What the desktop sends with a prompt. Nest rebuilds element records from Yjs. */
export const EditorViewSubmissionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  documentHash: Sha256Schema,
  fieldOfView: EditorFieldOfViewSchema,
  elements: z.array(ElementStateSnapshotSchema).max(512).optional(),
});

/** Frozen slice Nest hands to the UI worker as `currentUISlice`. */
export const EditorViewStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  documentHash: Sha256Schema,
  documentRevision: z.string().min(1).max(256),
  fieldOfView: EditorFieldOfViewSchema,
  elements: z.array(ElementStateSnapshotSchema).max(512),
  document: VektreUIDocumentV2Schema,
});

export type DesignRect = z.infer<typeof DesignRectSchema>;
export type EditorFieldOfView = z.infer<typeof EditorFieldOfViewSchema>;
export type ElementStateSnapshot = z.infer<typeof ElementStateSnapshotSchema>;
export type EditorViewSubmission = z.infer<typeof EditorViewSubmissionSchema>;
export type EditorViewState = z.infer<typeof EditorViewStateSchema>;

export interface EditorViewIssue {
  code: string;
  path: string;
  message: string;
}

const MAX_ELEMENTS = 512;

type PlacedNode = {
  id: string;
  kind: ElementStateSnapshot['kind'];
  parentId?: string;
  screenId: string;
  surfaceId: string;
  layout: {
    position?: { x: number; y: number };
    size?: { width: number; height: number };
  };
  node: Record<string, unknown>;
};

export function editorViewIssues(input: {
  document: VektreUIDocumentV2;
  documentHash: string;
  submission: EditorViewSubmission;
}): EditorViewIssue[] {
  const issues: EditorViewIssue[] = [];
  const { document, submission } = input;
  if (submission.documentHash !== input.documentHash) {
    issues.push({
      code: 'document_hash_mismatch',
      path: '/documentHash',
      message: 'Editor view hash does not match the frozen GUI revision',
    });
  }
  const fov = submission.fieldOfView;
  const screen = document.screens[fov.screenId];
  if (!screen) {
    issues.push({
      code: 'missing_screen',
      path: '/fieldOfView/screenId',
      message: `Field of view references missing screen "${fov.screenId}"`,
    });
  } else if (fov.surfaceId && !screen.surfaceIds.includes(fov.surfaceId)) {
    issues.push({
      code: 'missing_surface',
      path: '/fieldOfView/surfaceId',
      message: `Screen "${fov.screenId}" does not include surface "${fov.surfaceId}"`,
    });
  }
  if (fov.activeStateId && !document.states[fov.activeStateId]) {
    issues.push({
      code: 'missing_state',
      path: '/fieldOfView/activeStateId',
      message: `Field of view references missing state "${fov.activeStateId}"`,
    });
  }
  const index = indexNodes(document);
  for (const id of fov.selectedIds) {
    if (!index.has(id)) {
      issues.push({
        code: 'missing_selection',
        path: '/fieldOfView/selectedIds',
        message: `Selected id "${id}" is not a group, component, or block instance`,
      });
    }
  }
  for (const element of submission.elements ?? []) {
    const live = index.get(element.id);
    if (!live || live.kind !== element.kind) {
      issues.push({
        code: 'element_mismatch',
        path: `/elements/${element.id}`,
        message: `Element "${element.id}" is not a ${element.kind} in the frozen GUI`,
      });
      continue;
    }
    if (canonicalJson(live.node) !== canonicalJson(element.node)) {
      issues.push({
        code: 'element_mismatch',
        path: `/elements/${element.id}/node`,
        message: `Element "${element.id}" does not match the frozen GUI record`,
      });
    }
  }
  return issues;
}

export function buildEditorViewState(input: {
  document: VektreUIDocumentV2;
  documentHash: string;
  documentRevision: string;
  fieldOfView?: EditorFieldOfView;
  extraIds?: string[];
}): EditorViewState {
  const index = indexNodes(input.document);
  const fieldOfView = resolveFieldOfView(
    input.document,
    input.fieldOfView,
    input.extraIds ?? [],
    index,
  );
  const elements = elementsInView(input.document, fieldOfView, index);
  return EditorViewStateSchema.parse({
    schemaVersion: 1,
    documentHash: input.documentHash,
    documentRevision: input.documentRevision,
    fieldOfView,
    elements,
    document: input.document,
  });
}

function resolveFieldOfView(
  document: VektreUIDocumentV2,
  requested: EditorFieldOfView | undefined,
  extraIds: string[],
  index: Map<string, PlacedNode>,
): EditorFieldOfView {
  const screenId = pickScreenId(document, requested?.screenId);
  const screen = document.screens[screenId];
  const surfaceId = pickSurfaceId(document, screen, requested?.surfaceId);
  const surface = surfaceId ? document.surfaces[surfaceId] : undefined;
  const visibleRect =
    requested?.visibleRect ??
    (surface
      ? { x: 0, y: 0, width: surface.size.width, height: surface.size.height }
      : { x: 0, y: 0, width: 1920, height: 1080 });
  const selected = new Set<string>();
  for (const id of [...(requested?.selectedIds ?? []), ...extraIds]) {
    if (index.has(id)) selected.add(id);
  }
  const activeStateId =
    requested?.activeStateId && document.states[requested.activeStateId]
      ? requested.activeStateId
      : undefined;
  return {
    screenId,
    surfaceId,
    visibleRect,
    zoom: requested?.zoom ?? 1,
    selectedIds: [...selected],
    inspectorPath: requested?.inspectorPath,
    activeStateId,
  };
}

function pickScreenId(
  document: VektreUIDocumentV2,
  requested: string | undefined,
): string {
  if (requested && document.screens[requested]) return requested;
  for (const flow of Object.values(document.flows)) {
    if (document.screens[flow.entryScreenId]) return flow.entryScreenId;
  }
  const first = Object.keys(document.screens)[0];
  if (!first) {
    throw new Error('GUI document has no screen for a field of view');
  }
  return first;
}

function pickSurfaceId(
  document: VektreUIDocumentV2,
  screen: VektreUIDocumentV2['screens'][string] | undefined,
  requested: string | undefined,
): string | undefined {
  if (!screen) return undefined;
  if (requested && screen.surfaceIds.includes(requested)) return requested;
  return screen.surfaceIds.find((id) => document.surfaces[id]);
}

function elementsInView(
  document: VektreUIDocumentV2,
  fieldOfView: EditorFieldOfView,
  index: Map<string, PlacedNode>,
): ElementStateSnapshot[] {
  const onScreen = [...index.values()].filter((node) => {
    if (node.screenId !== fieldOfView.screenId) return false;
    if (fieldOfView.surfaceId && node.surfaceId !== fieldOfView.surfaceId) {
      return false;
    }
    return true;
  });
  const selected = new Set(fieldOfView.selectedIds);
  const chosen = new Set<string>();
  const take = (id: string) => {
    if (chosen.size >= MAX_ELEMENTS) return;
    if (index.has(id)) chosen.add(id);
  };
  for (const id of selected) take(id);
  for (const node of onScreen) {
    if (intersects(boundsOf(node), fieldOfView.visibleRect)) take(node.id);
  }
  for (const node of onScreen) {
    if (!boundsOf(node)) take(node.id);
  }
  for (const id of [...chosen]) {
    for (const ancestor of ancestorIds(id, index)) take(ancestor);
  }
  return [...chosen].map((id) => snapshotOf(document, index.get(id)!, fieldOfView));
}

function snapshotOf(
  document: VektreUIDocumentV2,
  placed: PlacedNode,
  fieldOfView: EditorFieldOfView,
): ElementStateSnapshot {
  const styleId =
    typeof placed.node.styleId === 'string' ? placed.node.styleId : undefined;
  const style = styleId ? document.styles[styleId] : undefined;
  const activeId = fieldOfView.activeStateId;
  const stateIds = Array.isArray(placed.node.stateIds)
    ? placed.node.stateIds.filter((id): id is string => typeof id === 'string')
    : [];
  const activeState =
    activeId && stateIds.includes(activeId)
      ? document.states[activeId]
      : undefined;
  const override =
    activeId && style?.stateOverrides
      ? style.stateOverrides[activeId]
      : undefined;
  const resolvedStyle =
    style && override && isRecord(override)
      ? {
          ...style,
          properties: { ...style.properties, ...override },
        }
      : style;
  const bindingIds = Array.isArray(placed.node.bindingIds)
    ? placed.node.bindingIds.filter((id): id is string => typeof id === 'string')
    : [];
  const bindings = bindingIds
    .map((id) => document.bindings[id])
    .filter((binding) => binding !== undefined)
    .slice(0, 128);
  const snapshot: ElementStateSnapshot = {
    id: placed.id,
    kind: placed.kind,
    node: placed.node as ElementStateSnapshot['node'],
    bindings,
  };
  if (resolvedStyle) snapshot.resolvedStyle = resolvedStyle;
  if (placed.node.content !== undefined) {
    snapshot.content = placed.node.content as ElementStateSnapshot['content'];
  }
  if (activeState) snapshot.activeState = activeState;
  return snapshot;
}

function indexNodes(document: VektreUIDocumentV2): Map<string, PlacedNode> {
  const index = new Map<string, PlacedNode>();
  const add = (
    kind: PlacedNode['kind'],
    values: Record<string, { id: string; screenId: string; surfaceId: string }>,
  ) => {
    for (const [id, node] of Object.entries(values)) {
      const record = node as unknown as PlacedNode['node'] & {
        parentId?: string;
        layout: PlacedNode['layout'];
      };
      index.set(id, {
        id,
        kind,
        parentId: record.parentId,
        screenId: node.screenId,
        surfaceId: node.surfaceId,
        layout: record.layout,
        node: record,
      });
    }
  };
  add('group', document.groups);
  add('component', document.components);
  add('block_instance', document.blockInstances);
  return index;
}

function ancestorIds(id: string, index: Map<string, PlacedNode>): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>([id]);
  let current = index.get(id)?.parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    ancestors.push(current);
    current = index.get(current)?.parentId;
  }
  return ancestors;
}

function boundsOf(
  node: PlacedNode,
): { x: number; y: number; width: number; height: number } | undefined {
  const size = node.layout?.size;
  if (!size) return undefined;
  const position = node.layout.position ?? { x: 0, y: 0 };
  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

function intersects(
  node: { x: number; y: number; width: number; height: number } | undefined,
  view: DesignRect,
): boolean {
  if (!node) return false;
  return (
    node.x < view.x + view.width &&
    node.x + node.width > view.x &&
    node.y < view.y + view.height &&
    node.y + node.height > view.y
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
