import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ContextManifest } from '@markaschmidt/ui-builder-contracts';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { UiContextRepository } from './repositories/ui-context.repository.js';
import type { UiConversationRepository } from './repositories/ui-conversation.repository.js';
import type { UiMemoryRepository } from './repositories/ui-memory.repository.js';
import { UiAgentService } from './ui-agent.service.js';
import type { UiContextFreshnessService } from './indexer/ui-context-freshness.service.js';
import type { UiContextIndexQueue } from './indexer/ui-context-index.queue.js';
import type { UsageCreditsService } from '../billing/usage-credits.service.js';
import type { UiAgentWorkflowService } from './ui-agent-workflow.service.js';

describe('UiAgentService', () => {
  const appData = {
    resolveProjectAccessForUser: jest.fn(),
    getProjectMembership: jest.fn(),
    getCollaborationDocumentById: jest.fn(),
    getProjectAsset: jest.fn(),
    getProjectComment: jest.fn(),
    createCollaborationActivity: jest.fn(),
    updateCollaborationActivity: jest.fn(),
    getCollaborationActivity: jest.fn(),
  };
  const conversations = {
    createThread: jest.fn(),
    getThread: jest.fn(),
    listVisibleThreads: jest.fn(),
    updateThread: jest.fn(),
    publishPrivateThread: jest.fn(),
    deletePrivateThread: jest.fn(),
    appendMessage: jest.fn(),
    getMessage: jest.fn(),
    listMessages: jest.fn(),
    exportMessages: jest.fn(),
  };
  const memories = {
    createMemory: jest.fn(),
    getMemory: jest.fn(),
    listVisibleMemory: jest.fn(),
    transitionMemory: jest.fn(),
    supersedeMemory: jest.fn(),
    listThreadMemory: jest.fn(),
  };
  const context = {
    createRun: jest.fn(),
    getRun: jest.fn(),
    saveContextManifest: jest.fn(),
    getContextManifestByRun: jest.fn(),
    getRunByRequest: jest.fn(),
    getActiveMutatingRun: jest.fn(),
    listSteps: jest.fn(),
    transitionRun: jest.fn(),
    cancelPendingSteps: jest.fn(),
    getBaseline: jest.fn(),
    upsertBaseline: jest.fn(),
    markRunReconciled: jest.fn(),
  };
  const freshness = {
    ensureCurrent: jest.fn(),
  };
  const indexQueue = {
    enqueueSource: jest.fn(),
  };
  const credits = {
    assertHasCredits: jest.fn(),
  };
  const workflow = {
    initializeRun: jest.fn(),
    resumeRun: jest.fn(),
    resumeAfterClarification: jest.fn(),
    bestEffortCancelWorker: jest.fn(),
  };
  let service: UiAgentService;

  const document = {
    documentKey: 'project:project-1:doc:gui_screen:document-1',
    documentId: 'document-1',
    projectId: 'project-1',
    documentType: 'gui_screen' as const,
    title: 'GUI',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const privateThread = {
    threadId: 'thread-private',
    threadOrder: 2,
    projectId: 'project-1',
    documentId: 'document-1',
    documentKey: document.documentKey,
    ownerUserId: 'private-owner',
    title: 'Private draft',
    visibility: 'private' as const,
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: {
        projectId: 'project-1',
        ownerUserId: 'project-owner',
        name: 'Project',
        workspaceMode: 'collaborative',
        status: 'active',
        preferences: {},
      },
    });
    appData.getProjectMembership.mockResolvedValue({
      projectId: 'project-1',
      userId: 'member',
      role: 'editor',
      status: 'active',
    });
    appData.getCollaborationDocumentById.mockResolvedValue(document);
    freshness.ensureCurrent.mockResolvedValue({
      revisionId: 'revision-1',
      documentHash: 'a'.repeat(64),
    });
    indexQueue.enqueueSource.mockResolvedValue(true);
    context.getRunByRequest.mockResolvedValue(null);
    context.getActiveMutatingRun.mockResolvedValue(null);
    context.listSteps.mockResolvedValue([]);
    credits.assertHasCredits.mockResolvedValue(undefined);
    workflow.bestEffortCancelWorker.mockResolvedValue(undefined);
    service = new UiAgentService(
      appData as unknown as AppDataService,
      conversations as unknown as UiConversationRepository,
      memories as unknown as UiMemoryRepository,
      context as unknown as UiContextRepository,
      freshness as unknown as UiContextFreshnessService,
      indexQueue as unknown as UiContextIndexQueue,
      credits as unknown as UsageCreditsService,
      workflow as unknown as UiAgentWorkflowService,
    );
  });

  it('appends and starts an idempotent paid run', async () => {
    let activityInput:
      | {
          activityType: string;
          requestId: string;
        }
      | undefined;
    appData.createCollaborationActivity.mockImplementation((input: unknown) => {
      activityInput = input as {
        activityType: string;
        requestId: string;
      };
      return Promise.resolve(undefined);
    });
    const thread = { ...privateThread, ownerUserId: 'member' };
    const message = {
      messageId: 'message-1',
      messageOrder: 1,
      threadId: thread.threadId,
      projectId: 'project-1',
      documentId: 'document-1',
      actorUserId: 'member',
      role: 'user' as const,
      visibility: 'private' as const,
      ownerUserId: 'member',
      parts: [{ type: 'text' as const, text: 'Build an inventory HUD' }],
      citations: [],
      isSummary: false,
      summarySourceMessageIds: [],
      createdAt: new Date(),
    };
    conversations.getThread.mockResolvedValue(thread);
    conversations.appendMessage.mockResolvedValue(message);
    context.createRun.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    workflow.initializeRun.mockImplementation(
      ({ run }: { run: Record<string, unknown> }) =>
        Promise.resolve({ ...run, status: 'understanding' }),
    );

    const response = await service.appendMessage(
      'project-1',
      'document-1',
      'member',
      thread.threadId,
      {
        parts: message.parts,
        execute: true,
        intent: 'edit',
        idempotencyKey: 'desktop-request-1',
      },
    );

    expect(credits.assertHasCredits).toHaveBeenCalledWith('member');
    expect(activityInput?.activityType).toBe('ai_task');
    expect(activityInput?.requestId).toMatch(/^uireq_/);
    expect(context.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'created',
        messageId: 'message-1',
        modelPresetId: 'ui-standard',
        mutating: true,
      }),
    );
    expect(response.messageId).toBe('message-1');
    expect(response.requestId).toMatch(/^uireq_/);
    expect(response.status).toBe('understanding');
  });

  it('rejects a second mutating run with the active run', async () => {
    conversations.getThread.mockResolvedValue({
      ...privateThread,
      ownerUserId: 'member',
    });
    context.getActiveMutatingRun.mockResolvedValue({
      runId: 'active-run',
      requestId: 'active-request',
      projectId: 'project-1',
      documentId: 'document-1',
      documentKey: document.documentKey,
      threadId: privateThread.threadId,
      actorUserId: 'member',
      ownerUserId: 'member',
      visibility: 'private',
      status: 'planning',
      intent: 'edit',
      baseDocumentHash: 'a'.repeat(64),
      mutating: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.appendMessage(
        'project-1',
        'document-1',
        'member',
        privateThread.threadId,
        {
          parts: [{ type: 'text', text: 'Change it again' }],
          execute: true,
          intent: 'edit',
        },
      ),
    ).rejects.toThrow(ConflictException);
    expect(conversations.appendMessage).not.toHaveBeenCalled();
  });

  it('cancels a same-user clarification on another thread so a new generate can start', async () => {
    const thread = { ...privateThread, ownerUserId: 'member' };
    const message = {
      messageId: 'message-2',
      messageOrder: 1,
      threadId: thread.threadId,
      projectId: 'project-1',
      documentId: 'document-1',
      actorUserId: 'member',
      role: 'user' as const,
      visibility: 'private' as const,
      ownerUserId: 'member',
      parts: [{ type: 'text' as const, text: 'Create a progress bar' }],
      citations: [],
      isSummary: false,
      summarySourceMessageIds: [],
      createdAt: new Date(),
    };
    conversations.getThread.mockResolvedValue(thread);
    conversations.appendMessage.mockResolvedValue(message);
    context.getActiveMutatingRun.mockResolvedValue({
      runId: 'stale-run',
      requestId: 'stale-request',
      projectId: 'project-1',
      documentId: 'document-1',
      documentKey: document.documentKey,
      threadId: 'thread-old',
      actorUserId: 'member',
      ownerUserId: 'member',
      visibility: 'private',
      status: 'awaiting_clarification',
      intent: 'create',
      baseDocumentHash: 'a'.repeat(64),
      mutating: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    context.transitionRun.mockResolvedValue({
      runId: 'stale-run',
      status: 'cancelled',
    });
    context.createRun.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    workflow.initializeRun.mockImplementation(
      ({ run }: { run: Record<string, unknown> }) =>
        Promise.resolve({ ...run, status: 'understanding' }),
    );

    const response = await service.appendMessage(
      'project-1',
      'document-1',
      'member',
      thread.threadId,
      {
        parts: [{ type: 'text', text: 'Create a progress bar' }],
        execute: true,
        intent: 'create',
      },
    );

    expect(context.transitionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'stale-run',
        status: 'cancelled',
      }),
    );
    expect(workflow.resumeAfterClarification).not.toHaveBeenCalled();
    expect(workflow.initializeRun).toHaveBeenCalled();
    expect(response.status).toBe('understanding');
  });

  it('resumes same-thread clarification even when the reply is tagged chat', async () => {
    const thread = { ...privateThread, ownerUserId: 'member' };
    const message = {
      messageId: 'message-clarify',
      messageOrder: 2,
      threadId: thread.threadId,
      projectId: 'project-1',
      documentId: 'document-1',
      actorUserId: 'member',
      role: 'user' as const,
      visibility: 'private' as const,
      ownerUserId: 'member',
      parts: [
        {
          type: 'text' as const,
          text: 'PICK WHATEVER YOU WANT, JUST MAKE THE GUI COMPONENT',
        },
      ],
      citations: [],
      isSummary: false,
      summarySourceMessageIds: [],
      createdAt: new Date(),
    };
    conversations.getThread.mockResolvedValue(thread);
    conversations.appendMessage.mockResolvedValue(message);
    context.getActiveMutatingRun.mockResolvedValue({
      runId: 'run-clarify',
      requestId: 'request-clarify',
      activityId: 'activity-clarify',
      projectId: 'project-1',
      documentId: 'document-1',
      documentKey: document.documentKey,
      threadId: thread.threadId,
      actorUserId: 'member',
      ownerUserId: 'member',
      visibility: 'private',
      status: 'awaiting_clarification',
      intent: 'create',
      baseDocumentHash: 'a'.repeat(64),
      mutating: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    workflow.resumeAfterClarification.mockResolvedValue({
      runId: 'run-clarify',
      requestId: 'request-clarify',
      activityId: 'activity-clarify',
      status: 'understanding',
    });

    const response = await service.appendMessage(
      'project-1',
      'document-1',
      'member',
      thread.threadId,
      {
        parts: message.parts,
        execute: true,
        intent: 'chat',
      },
    );

    expect(workflow.resumeAfterClarification).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-clarify' }),
      message,
    );
    expect(workflow.initializeRun).not.toHaveBeenCalled();
    expect(context.createRun).not.toHaveBeenCalled();
    expect(response).toEqual({
      messageId: 'message-clarify',
      runId: 'run-clarify',
      requestId: 'request-clarify',
      activityId: 'activity-clarify',
      status: 'understanding',
    });
  });

  it('reconciles desktop apply into the durable UI baseline once', async () => {
    const appliedHash = 'c'.repeat(64);
    const completedRun = {
      runId: 'run-completed',
      requestId: 'request-completed',
      activityId: 'activity-completed',
      projectId: 'project-1',
      documentId: 'document-1',
      documentKey: document.documentKey,
      threadId: privateThread.threadId,
      actorUserId: 'member',
      ownerUserId: 'member',
      visibility: 'private' as const,
      status: 'completed' as const,
      intent: 'edit',
      baseDocumentHash: 'a'.repeat(64),
      proposalHash: 'b'.repeat(64),
      mutating: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    context.getRun.mockResolvedValue(completedRun);
    appData.getCollaborationActivity.mockResolvedValue({
      activityId: completedRun.activityId,
      projectId: 'project-1',
      documentId: 'document-1',
      actorUserId: 'member',
      activityType: 'ai_task',
      status: 'completed',
      result: { runId: completedRun.runId },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    freshness.ensureCurrent.mockResolvedValue({
      revisionId: 'revision-applied',
      documentHash: appliedHash,
    });
    context.upsertBaseline.mockResolvedValue({
      documentKey: document.documentKey,
      projectId: 'project-1',
      documentId: 'document-1',
      revisionId: 'revision-applied',
      runId: completedRun.runId,
      activityId: completedRun.activityId,
      documentHash: appliedHash,
      proposalHash: completedRun.proposalHash,
      reconciledAt: new Date(),
      updatedAt: new Date(),
    });
    context.markRunReconciled.mockResolvedValue({
      ...completedRun,
      reconciledAt: new Date(),
    });

    const result = await service.reconcileRun(
      'project-1',
      'document-1',
      'member',
      completedRun.runId,
      {
        appliedDocumentHash: appliedHash,
        appliedRevisionId: 'revision-applied',
      },
    );

    expect(context.upsertBaseline).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: completedRun.runId,
        documentHash: appliedHash,
        proposalHash: completedRun.proposalHash,
      }),
    );
    expect(appData.updateCollaborationActivity).toHaveBeenCalledWith(
      completedRun.activityId,
      expect.objectContaining({ reconciled: true }),
    );
    expect(result.baseline.documentHash).toBe(appliedHash);
  });

  it('persists an approve decision and stamps it into the proposal', async () => {
    const awaitingReviewRun = {
      runId: 'run-review',
      requestId: 'request-review',
      activityId: 'activity-review',
      projectId: 'project-1',
      documentId: 'document-1',
      documentKey: document.documentKey,
      threadId: privateThread.threadId,
      actorUserId: 'member',
      ownerUserId: 'member',
      visibility: 'shared' as const,
      status: 'awaiting_review' as const,
      intent: 'edit',
      baseDocumentHash: 'a'.repeat(64),
      mutating: true,
      result: {
        schemaVersion: 1,
        text: 'Proposal ready',
        citations: [],
        memoryProposals: [],
        assetPlan: [],
        validationIssues: [],
        conflicts: [],
        matchReview: {
          matchSetId: 'matchset-1',
          alternatives: [
            {
              alternativeId: 'alt-1',
              candidates: [],
              totalScore: 1,
              feasible: true,
            },
          ],
          recommendedAlternativeId: 'alt-1',
          requiresReview: true,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    context.getRun.mockResolvedValue(awaitingReviewRun);
    freshness.ensureCurrent.mockResolvedValue({
      revisionId: 'revision-current',
      documentHash: 'a'.repeat(64),
    });
    context.transitionRun.mockImplementation(
      (value: Record<string, unknown>) =>
        Promise.resolve({ ...awaitingReviewRun, status: value.status }),
    );
    context.listSteps.mockResolvedValue([]);
    appData.getCollaborationActivity.mockResolvedValue({
      activityId: awaitingReviewRun.activityId,
      projectId: 'project-1',
      documentId: 'document-1',
      actorUserId: 'member',
      activityType: 'ai_task',
      status: 'awaiting_review',
      result: { runId: awaitingReviewRun.runId },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await service.reviewRun(
      'project-1',
      'document-1',
      'member',
      awaitingReviewRun.runId,
      { decision: 'approve', alternativeId: 'alt-1' },
    );

    expect(response.status).toBe('completed');
    const transition = context.transitionRun.mock.calls[0][0] as {
      review: { decision: string; actorId: string };
      result: {
        matchReview: { reviewDecision: { alternativeId: string } };
      };
    };
    expect(transition.review.decision).toBe('approve');
    // The decision must survive in the proposal itself, not only in the
    // review column, so a later session does not block its own apply.
    expect(transition.result.matchReview.reviewDecision.alternativeId).toBe(
      'alt-1',
    );
  });

  it('hides private threads even from another project editor', async () => {
    conversations.getThread.mockResolvedValue(privateThread);

    await expect(
      service.getThread(
        'project-1',
        'document-1',
        'another-editor',
        privateThread.threadId,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('freezes the newest indexed revision when creating an agent run', async () => {
    conversations.getThread.mockResolvedValue({
      ...privateThread,
      ownerUserId: 'member',
    });
    freshness.ensureCurrent.mockResolvedValue({
      revisionId: 'revision-current',
      documentHash: 'b'.repeat(64),
    });
    context.createRun.mockImplementation((value: Record<string, unknown>) =>
      Promise.resolve(value),
    );

    await service.createAgentRun({
      projectId: 'project-1',
      documentId: 'document-1',
      actorUserId: 'member',
      threadId: privateThread.threadId,
      requestId: 'request-1',
      intent: 'edit',
    });

    expect(context.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        baseDocumentHash: 'b'.repeat(64),
        frozenRevisionId: 'revision-current',
      }),
    );
  });

  it('publishes only the owner private thread through the atomic RPC', async () => {
    conversations.getThread.mockResolvedValue(privateThread);
    conversations.publishPrivateThread.mockResolvedValue({
      ...privateThread,
      visibility: 'shared',
      publishedAt: new Date(),
    });

    const result = await service.publishThread(
      'project-1',
      'document-1',
      'private-owner',
      privateThread.threadId,
    );

    expect(result.visibility).toBe('shared');
    expect(conversations.publishPrivateThread).toHaveBeenCalledWith(
      privateThread.threadId,
      'private-owner',
    );
  });

  it('prevents private citations from leaking into shared messages', async () => {
    conversations.getThread.mockResolvedValue({
      ...privateThread,
      visibility: 'shared',
    });

    await expect(
      service.appendMessage(
        'project-1',
        'document-1',
        'member',
        privateThread.threadId,
        {
          parts: [{ type: 'text', text: 'Use this reference' }],
          citations: [
            {
              sourceId: 'private-message',
              sourceKind: 'message',
              contentHash: 'a'.repeat(64),
              visibility: 'private',
            },
          ],
        },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(conversations.appendMessage).not.toHaveBeenCalled();
  });

  it('publishes private memory as a new shared proposal', async () => {
    memories.getMemory.mockResolvedValue({
      memoryId: 'memory-private',
      memoryOrder: 1,
      projectId: 'project-1',
      documentId: 'document-1',
      ownerUserId: 'private-owner',
      kind: 'lore',
      scope: 'document',
      text: 'The city uses amber glass.',
      status: 'accepted',
      visibility: 'private',
      pinned: true,
      provenance: {
        sourceKind: 'user',
        sourceId: 'private-owner',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    memories.createMemory.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        memoryOrder: 2,
        status: 'proposed',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    const result = await service.publishMemory(
      'project-1',
      'document-1',
      'private-owner',
      'memory-private',
    );

    expect(result.visibility).toBe('shared');
    expect(result.status).toBe('proposed');
    expect(result.provenance).toEqual({
      sourceKind: 'memory',
      sourceId: 'memory-private',
      actorId: 'private-owner',
      documentRevision: undefined,
    });
    expect(memories.createMemory).toHaveBeenCalledTimes(1);
  });

  it('rejects incompatible superseding memories deterministically', async () => {
    memories.getMemory
      .mockResolvedValueOnce({
        ...memoryRow('memory-1'),
        status: 'accepted',
      })
      .mockResolvedValueOnce({
        ...memoryRow('memory-2'),
        status: 'accepted',
      });
    memories.supersedeMemory.mockResolvedValue(null);

    await expect(
      service.supersedeMemory(
        'project-1',
        'document-1',
        'member',
        'memory-1',
        'memory-2',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('persists exact manifests but returns a content-free inspector view', async () => {
    const manifest = contextManifest();
    context.getRun.mockResolvedValue({
      runId: manifest.runId,
      projectId: manifest.projectId,
      documentId: manifest.documentId,
      threadId: manifest.threadId,
      actorUserId: 'member',
      ownerUserId: 'member',
      visibility: 'shared',
    });
    context.saveContextManifest.mockResolvedValue({ manifest });
    context.getContextManifestByRun
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        manifest,
        manifestHash: 'c'.repeat(64),
        visibility: 'shared',
        ownerUserId: 'member',
      });

    await service.persistContextManifest({
      manifest,
      actorUserId: 'member',
    });
    const inspected = await service.getContextManifest(
      'project-1',
      'document-1',
      'member',
      manifest.runId,
    );

    expect(context.saveContextManifest).toHaveBeenCalledTimes(1);
    expect(inspected.sections[0].sources[0]).not.toHaveProperty('content');
    expect(
      inspected.sections[0].sources.map((source) => source.sourceId),
    ).toEqual(['memory-lore', 'memory-rejected-direction']);
  });

  it('deletes only an owner private thread', async () => {
    conversations.getThread.mockResolvedValue(privateThread);
    conversations.deletePrivateThread.mockResolvedValue(true);

    await service.deletePrivateThread(
      'project-1',
      'document-1',
      'private-owner',
      privateThread.threadId,
    );

    expect(conversations.deletePrivateThread).toHaveBeenCalledWith(
      privateThread.threadId,
      'private-owner',
    );
  });

  it('does not overwrite a frozen run context with different content', async () => {
    const manifest = contextManifest();
    context.getRun.mockResolvedValue({
      runId: manifest.runId,
      projectId: manifest.projectId,
      documentId: manifest.documentId,
      threadId: manifest.threadId,
      actorUserId: 'member',
      ownerUserId: 'member',
      visibility: 'shared',
    });
    context.getContextManifestByRun.mockResolvedValue({
      manifest,
      manifestHash: 'f'.repeat(64),
    });

    await expect(
      service.persistContextManifest({ manifest, actorUserId: 'member' }),
    ).rejects.toThrow(ConflictException);
    expect(context.saveContextManifest).not.toHaveBeenCalled();
  });
});

function memoryRow(memoryId: string) {
  return {
    memoryId,
    memoryOrder: 1,
    projectId: 'project-1',
    documentId: 'document-1',
    ownerUserId: 'member',
    kind: 'decision',
    scope: 'document',
    text: memoryId,
    status: 'proposed',
    visibility: 'shared',
    pinned: false,
    provenance: { sourceKind: 'user', sourceId: 'member' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function contextManifest(): ContextManifest {
  return {
    schemaVersion: 1,
    manifestId: 'manifest-1',
    runId: 'run-1',
    projectId: 'project-1',
    documentId: 'document-1',
    threadId: 'thread-shared',
    actorId: 'member',
    documentRevision: 'revision-1',
    documentHash: 'a'.repeat(64),
    modelPresetId: 'balanced',
    totalTokenBudget: 1000,
    estimatedTokens: 100,
    sections: [
      {
        name: 'memory',
        tokenBudget: 200,
        estimatedTokens: 20,
        sources: [
          {
            sourceId: 'memory-lore',
            sourceKind: 'memory',
            contentHash: 'b'.repeat(64),
            visibility: 'shared',
            selectionReason: 'accepted_memory',
            rank: 0,
            estimatedTokens: 20,
            content: { kind: 'lore', text: 'Amber glass' },
            citation: {
              sourceId: 'memory-lore',
              sourceKind: 'memory',
              contentHash: 'b'.repeat(64),
              visibility: 'shared',
            },
            truncated: false,
          },
          {
            sourceId: 'memory-rejected-direction',
            sourceKind: 'memory',
            contentHash: 'c'.repeat(64),
            visibility: 'shared',
            selectionReason: 'accepted_memory',
            rank: 1,
            estimatedTokens: 20,
            content: {
              kind: 'rejected_direction',
              text: 'Do not use neon chrome.',
            },
            citation: {
              sourceId: 'memory-rejected-direction',
              sourceKind: 'memory',
              contentHash: 'c'.repeat(64),
              visibility: 'shared',
            },
            truncated: false,
          },
        ],
      },
    ],
    generatedAt: '2026-08-20T00:00:00.000Z',
  };
}
