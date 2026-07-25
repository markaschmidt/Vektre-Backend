import type { CanvasActionKind } from '../collaboration-documents/models/canvas-graph.model.js';
import type { CollaborationActivityRow } from '../integrations/app-data.types.js';

export interface CanvasActionInputAsset {
  assetId: string;
  portId?: string;
}

export interface CanvasActionInputText {
  text: string;
  portId?: string;
  contentHash?: string;
}

export interface CanvasActionRunContext {
  projectId: string;
  documentId: string;
  userId: string;
  workflowId: string;
  nodeId: string;
  runId: string;
  actionKind: CanvasActionKind;
  activityId: string;
  requestId: string;
  config: Record<string, unknown>;
  inputs: {
    texts: CanvasActionInputText[];
    assets: CanvasActionInputAsset[];
  };
}

export interface CanvasActionEnqueueResult {
  /** Whether work was newly enqueued (false when returning an existing run). */
  enqueued: boolean;
  requestId: string;
  activity: CollaborationActivityRow;
}

/**
 * Each canvas action kind registers one handler. Handlers validate inputs,
 * enqueue provider/queue work, and never write Yjs graph topology.
 */
export interface CanvasActionHandler {
  readonly kind: CanvasActionKind;

  validate(ctx: CanvasActionRunContext): void | Promise<void>;

  /**
   * Reserve/start work for this action. Must be safe to call again for the
   * same runId (idempotent at the activity layer).
   */
  enqueue(ctx: CanvasActionRunContext): Promise<void>;
}

export const CANVAS_ACTION_HANDLERS = Symbol('CANVAS_ACTION_HANDLERS');
