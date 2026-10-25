import type { ConfigService } from '@nestjs/config';
import type { GenerationCostService } from '../generative-model/cost/generation-cost.service.js';
import type { GenerativeModelService } from '../generative-model/generative-model.service.js';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { SupabaseService } from '../integrations/supabase.js';
import type { AssetsService } from '../projects/assets.service.js';
import type { UiContextAssembler } from './indexer/ui-context-assembler.js';
import type { UiContextRepository } from './repositories/ui-context.repository.js';
import type { UiConversationRepository } from './repositories/ui-conversation.repository.js';
import type { UiMemoryRepository } from './repositories/ui-memory.repository.js';
import {
  UiAgentWorkflowService,
  nextStatusAfterCritique,
} from './ui-agent-workflow.service.js';
import type { UiAgentQueue } from './ui-agent.queue.js';
import type { UiAiClient } from './ui-ai.client.js';

describe('UiAgentWorkflowService durability', () => {
  const context = {
    getRun: jest.fn(),
    getStepByStageExecution: jest.fn(),
    listSteps: jest.fn(),
    getStageArtifact: jest.fn(),
  };
  const queue = {
    enqueueTransition: jest.fn(),
  };
  const worker = {
    executeStage: jest.fn(),
  };
  const workflow = new UiAgentWorkflowService(
    {} as AppDataService,
    {} as UiConversationRepository,
    {} as UiMemoryRepository,
    context as unknown as UiContextRepository,
    {} as UiContextAssembler,
    {} as AssetsService,
    {} as GenerationCostService,
    {} as GenerativeModelService,
    queue as unknown as UiAgentQueue,
    worker as unknown as UiAiClient,
    {} as ConfigService,
    {} as SupabaseService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('recovers a persisted next transition after queue delivery was interrupted', async () => {
    const now = new Date();
    const run = {
      runId: 'run-1',
      requestId: 'request-1',
      projectId: 'project-1',
      documentId: 'document-1',
      documentKey: 'project:project-1:doc:gui_screen:document-1',
      actorUserId: 'actor-1',
      ownerUserId: 'actor-1',
      visibility: 'private' as const,
      status: 'planning' as const,
      intent: 'edit',
      baseDocumentHash: 'a'.repeat(64),
      mutating: true,
      createdAt: now,
      updatedAt: now,
    };
    const completed = {
      stepId: 'step-1',
      runId: run.runId,
      projectId: run.projectId,
      stageExecutionId: 'execution-1',
      stage: 'understand' as const,
      attempt: 1,
      idempotencyKey: 'paid-call-1',
      status: 'completed' as const,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
      createdAt: now,
      updatedAt: now,
    };
    const pending = {
      ...completed,
      stepId: 'step-2',
      stageExecutionId: 'execution-2',
      stage: 'propose_ux' as const,
      status: 'pending' as const,
    };
    context.getRun.mockResolvedValue(run);
    context.getStepByStageExecution.mockResolvedValue(completed);
    context.listSteps.mockResolvedValue([completed, pending]);
    queue.enqueueTransition.mockResolvedValue(undefined);

    await workflow.processTransition(
      {
        kind: 'transition',
        projectId: run.projectId,
        documentId: run.documentId,
        runId: run.runId,
        stageExecutionId: completed.stageExecutionId,
      },
      false,
    );

    expect(queue.enqueueTransition).toHaveBeenCalledWith({
      kind: 'transition',
      projectId: run.projectId,
      documentId: run.documentId,
      runId: run.runId,
      stageExecutionId: pending.stageExecutionId,
    });
    expect(worker.executeStage).not.toHaveBeenCalled();
  });
});

describe('nextStatusAfterCritique', () => {
  it('completes patch proposals so the desktop can apply them', () => {
    expect(
      nextStatusAfterCritique({
        matchReview: { requiresReview: false },
      }),
    ).toBe('completed');
    expect(nextStatusAfterCritique({})).toBe('completed');
  });

  it('pauses only when a real match choice is waiting', () => {
    expect(
      nextStatusAfterCritique({
        matchReview: {
          requiresReview: true,
          alternatives: [
            {
              candidates: [
                {
                  functionalNodeId: 'health_group',
                  visualNodeId: 'health_bar',
                },
              ],
            },
          ],
        },
      }),
    ).toBe('awaiting_review');
  });

  it('completes when the solver only returned the empty placeholder', () => {
    expect(
      nextStatusAfterCritique({
        matchReview: {
          requiresReview: true,
          alternatives: [
            {
              candidates: [
                { functionalNodeId: 'none', visualNodeId: 'none' },
              ],
            },
          ],
        },
      }),
    ).toBe('completed');
  });
});
