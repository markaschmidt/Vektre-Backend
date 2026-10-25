import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CanvasWorkflowsService } from './canvas-workflows.service.js';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { CanvasActionHandler } from './canvas-action.interface.js';
import { CANVAS_ACTION_HANDLERS } from './canvas-action.interface.js';

function makeCanvasDoc() {
  return {
    documentKey: 'project:proj-1:doc:canvas:doc-canvas',
    documentId: 'doc-canvas',
    projectId: 'proj-1',
    documentType: 'canvas' as const,
    title: 'Canvas',
    storageRef: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    activityId: 'act-1',
    projectId: 'proj-1',
    documentId: 'doc-canvas',
    documentType: 'canvas' as const,
    requestId: 'req-1',
    actorUserId: 'user-1',
    activityType: 'image_generation' as const,
    status: 'pending' as const,
    workflowId: 'wf-1',
    nodeId: 'node-1',
    runId: 'run-1',
    actionKind: 'concept_art',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('CanvasWorkflowsService', () => {
  const appData = {
    resolveProjectAccessForUser: jest.fn(),
    getProjectMembership: jest.fn(),
    getCollaborationDocumentById: jest.fn(),
    getCollaborationActivityByRunId: jest.fn(),
    createCollaborationActivity: jest.fn(),
    updateCollaborationActivity: jest.fn(),
    getCollaborationActivity: jest.fn(),
  };

  const handler: CanvasActionHandler = {
    kind: 'concept_art',
    validate: jest.fn(),
    enqueue: jest.fn().mockResolvedValue(undefined),
  };

  let service: CanvasWorkflowsService;

  beforeEach(() => {
    jest.clearAllMocks();
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: { projectId: 'proj-1', ownerUserId: 'user-1', name: 'Demo' },
    });
    appData.getProjectMembership.mockResolvedValue(null);
    appData.getCollaborationDocumentById.mockResolvedValue(makeCanvasDoc());
    appData.getCollaborationActivityByRunId.mockResolvedValue(null);
    appData.createCollaborationActivity.mockImplementation(async (row) =>
      makeActivity(row),
    );
    appData.updateCollaborationActivity.mockImplementation(async (id, patch) =>
      makeActivity({
        activityId: id,
        ...patch,
        status: patch.status ?? 'running',
      }),
    );
    appData.getCollaborationActivity.mockResolvedValue(
      makeActivity({ status: 'running' }),
    );

    service = new CanvasWorkflowsService(appData as unknown as AppDataService, [
      handler,
    ]);
  });

  it('returns capabilities for a canvas document', async () => {
    const caps = await service.getCapabilities(
      'proj-1',
      'doc-canvas',
      'user-1',
    );
    expect(caps.schemaVersion).toBe('canvas.v2');
    expect(caps.actions.map((a) => a.actionKind)).toEqual([
      'concept_art',
      'image_edit',
      'model_3d',
      'image_split',
    ]);
  });

  it('rejects non-canvas documents', async () => {
    appData.getCollaborationDocumentById.mockResolvedValue({
      ...makeCanvasDoc(),
      documentType: 'storyboard',
    });
    await expect(
      service.getCapabilities('proj-1', 'doc-canvas', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects viewers from running actions', async () => {
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: { projectId: 'proj-1', ownerUserId: 'owner-x', name: 'Demo' },
    });
    appData.getProjectMembership.mockResolvedValue({
      role: 'viewer',
      status: 'active',
    });
    await expect(
      service.runAction('proj-1', 'doc-canvas', 'user-2', {
        workflowId: 'wf-1',
        nodeId: 'node-1',
        runId: 'run-1',
        actionKind: 'concept_art',
        config: { prompt: 'a hero' },
        inputs: { texts: [{ text: 'a hero' }] },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('enqueues a new action run', async () => {
    const result = await service.runAction('proj-1', 'doc-canvas', 'user-1', {
      workflowId: 'wf-1',
      nodeId: 'node-1',
      runId: 'run-new',
      actionKind: 'concept_art',
      config: { prompt: 'a sword' },
      inputs: {},
    });
    expect(result.enqueued).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(handler.validate).toHaveBeenCalled();
    expect(handler.enqueue).toHaveBeenCalled();
    expect(appData.createCollaborationActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-new',
        actionKind: 'concept_art',
        workflowId: 'wf-1',
        nodeId: 'node-1',
      }),
    );
  });

  it('returns the existing activity for the same runId (idempotent)', async () => {
    appData.getCollaborationActivityByRunId.mockResolvedValue(
      makeActivity({ runId: 'run-1', status: 'running' }),
    );
    const result = await service.runAction('proj-1', 'doc-canvas', 'user-1', {
      workflowId: 'wf-1',
      nodeId: 'node-1',
      runId: 'run-1',
      actionKind: 'concept_art',
      config: { prompt: 'a sword' },
    });
    expect(result.idempotent).toBe(true);
    expect(result.enqueued).toBe(false);
    expect(handler.enqueue).not.toHaveBeenCalled();
  });

  it('marks activity failed when enqueue throws', async () => {
    (handler.enqueue as jest.Mock).mockRejectedValueOnce(
      new Error('provider down'),
    );
    await expect(
      service.runAction('proj-1', 'doc-canvas', 'user-1', {
        workflowId: 'wf-1',
        nodeId: 'node-1',
        runId: 'run-fail',
        actionKind: 'concept_art',
        config: { prompt: 'x' },
      }),
    ).rejects.toThrow('provider down');
    expect(appData.updateCollaborationActivity).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('404s when the document is missing', async () => {
    appData.getCollaborationDocumentById.mockResolvedValue(null);
    await expect(
      service.getCapabilities('proj-1', 'missing', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });
});

// Ensure the DI token still exists for module wiring.
describe('CANVAS_ACTION_HANDLERS token', () => {
  it('is a unique symbol', () => {
    expect(typeof CANVAS_ACTION_HANDLERS).toBe('symbol');
  });
});
