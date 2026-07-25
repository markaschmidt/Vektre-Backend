import type { CollaborationDocumentType } from '../../collaboration-yjs/document-name.js';

export { CollaborationDocumentType };

export const COLLABORATION_DOCUMENT_TYPES: readonly CollaborationDocumentType[] = [
  'storyboard',
  'foundry',
  'canvas',
  'gui_screen',
];

export function isCollaborationDocumentType(
  value: unknown,
): value is CollaborationDocumentType {
  return (
    typeof value === 'string' &&
    (COLLABORATION_DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Every collaborative area (Storyboard, Foundry, Canvas, GUI maker) implements
 * this contract. The backend only validates shape, never editor semantics —
 * new surfaces should not need a new collaboration subsystem, only a new
 * entry here plus frontend Yjs bindings.
 */
export interface CollaborationSurface {
  documentType: CollaborationDocumentType;
  label: string;
  /** Versioned schema name so old clients fail clearly instead of corrupting state. */
  yjsSchemaVersion: string;
  /** Documented shape of the Yjs awareness payload local to this surface's document room. */
  awarenessSchema: {
    description: string;
    fields: string[];
  };
  /** Documented shape of `project_comment.anchor_json` for this surface. */
  commentAnchorSchema: {
    description: string;
    requiredFields: string[];
    optionalFields: string[];
  };
  /** What a `collaboration_activity` target/result can reference for this surface. */
  generationTargets: {
    description: string;
    activityTypes: string[];
    targetFields: string[];
  };
  /** How a durable, completed activity gets reconciled into this surface's Yjs state. */
  reconciliationStrategy: string;
}

export const SURFACE_REGISTRY: Record<CollaborationDocumentType, CollaborationSurface> = {
  storyboard: {
    documentType: 'storyboard',
    label: 'Storyboard',
    yjsSchemaVersion: 'storyboard.v1',
    awarenessSchema: {
      description:
        'Cursor/selection inside the rich text tree, plus optional local generation status.',
      fields: ['cursor', 'selectionRange', 'activeBlockId', 'localActivityId'],
    },
    commentAnchorSchema: {
      description: 'Anchors a comment to a scene/card/block and an optional text range.',
      requiredFields: ['blockId'],
      optionalFields: ['sceneId', 'range'],
    },
    generationTargets: {
      description:
        'AI writing suggestions and linked concept art/model assets attached to a scene or card.',
      activityTypes: ['ai_task', 'image_generation', 'model_generation'],
      targetFields: ['sceneId', 'blockId', 'promptHash'],
    },
    reconciliationStrategy:
      'On completion, insert an asset reference/annotation node at the target blockId exactly once (guarded by activityId).',
  },
  foundry: {
    documentType: 'foundry',
    label: 'Foundry',
    yjsSchemaVersion: 'foundry.v1',
    awarenessSchema: {
      description:
        'Shared 3D/asset viewer selection and collaborative item labels in the foundry room.',
      fields: ['selectedItemId', 'localActivityId'],
    },
    commentAnchorSchema: {
      description: 'Anchors a comment to a foundry item, asset, or 3D point.',
      requiredFields: [],
      optionalFields: ['objectId', 'assetId', 'region', 'point'],
    },
    generationTargets: {
      description:
        'Generated 3D models referenced by project_asset id and placed in the foundry scene.',
      activityTypes: ['model_generation', 'asset_import'],
      targetFields: ['objectId', 'placement', 'assetId'],
    },
    reconciliationStrategy:
      'On completion, reference the resulting project_asset in the foundry room exactly once, guarded by activityId/objectId.',
  },
  canvas: {
    documentType: 'canvas',
    label: 'Canvas',
    yjsSchemaVersion: 'canvas.v2',
    awarenessSchema: {
      description:
        'Multi-workflow block graph: active workflow, selected nodes, viewport, and in-progress action runs.',
      fields: [
        'activeWorkflowId',
        'selectedNodeIds',
        'viewport',
        'activeNodeId',
        'localActivityId',
        'localRunId',
      ],
    },
    commentAnchorSchema: {
      description:
        'Anchors a comment to a workflow, node, edge, or canvas region.',
      requiredFields: [],
      optionalFields: ['workflowId', 'nodeId', 'edgeId', 'blockId', 'region'],
    },
    generationTargets: {
      description:
        'Concept art, 3D models, and image-split outputs from orchestrator/action blocks.',
      activityTypes: [
        'image_generation',
        'model_generation',
        'ai_task',
        'asset_import',
      ],
      targetFields: [
        'workflowId',
        'nodeId',
        'runId',
        'actionKind',
        'assetId',
        'promptHash',
      ],
    },
    reconciliationStrategy:
      'On completion, attach activity.result output asset IDs to the target workflow node exactly once, guarded by activityId/runId.',
  },
  gui_screen: {
    documentType: 'gui_screen',
    label: 'GUI Maker',
    yjsSchemaVersion: 'gui_screen.v1',
    awarenessSchema: {
      description:
        'Cursor/selection over screen components, inspector panel focus, and local generation status.',
      fields: ['cursor', 'selectedComponentIds', 'inspectorFocus', 'localActivityId'],
    },
    commentAnchorSchema: {
      description: 'Anchors a comment to a screen/component and an optional prop path.',
      requiredFields: [],
      optionalFields: ['screenId', 'componentId', 'propPath'],
    },
    generationTargets: {
      description: 'Reserved for future component/screen generation.',
      activityTypes: ['ai_task'],
      targetFields: ['screenId', 'componentId'],
    },
    reconciliationStrategy:
      'Reserved: on completion, insert the generated component/layout node exactly once, guarded by activityId.',
  },
};

export function getSurface(documentType: CollaborationDocumentType): CollaborationSurface {
  return SURFACE_REGISTRY[documentType];
}

export function listSurfaces(): CollaborationSurface[] {
  return COLLABORATION_DOCUMENT_TYPES.map((type) => SURFACE_REGISTRY[type]);
}
