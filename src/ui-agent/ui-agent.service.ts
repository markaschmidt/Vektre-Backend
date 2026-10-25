import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  JsonValueSchema,
  MessagePartSchema,
  SourceCitationSchema,
  canonicalSha256,
  editorViewIssues,
  type ContextManifest,
  type JsonValue,
  type MessagePart,
  type SourceCitation,
  type AgentRun,
} from '@markaschmidt/ui-builder-contracts';
import { randomUUID } from 'node:crypto';
import { UsageCreditsService } from '../billing/usage-credits.service.js';
import { generateActivityId } from '../collaboration-documents/collaboration-ids.js';
import { AppDataService } from '../integrations/app-data.service.js';
import type {
  CollaborationDocumentRow,
  ProjectMemberRole,
} from '../integrations/app-data.types.js';
import { requireProjectRole } from '../projects/project-access.js';
import type { AppendUiMessageDto } from './dto/message.dto.js';
import type { CreateUiMemoryDto, ListUiMemoryDto } from './dto/memory.dto.js';
import type {
  CreateUiThreadDto,
  ListUiThreadsDto,
  UpdateUiThreadDto,
} from './dto/thread.dto.js';
import {
  sanitizeContextManifest,
  toMemoryResponse,
  toMessageResponse,
  toThreadResponse,
  toRunResponse,
  type CursorPage,
  type UiAiThreadRow,
  type UiAgentRunRow,
  type UiDesignMemoryRow,
  type UiDocumentRevisionRow,
} from './models/ui-agent.model.js';
import { normalizeContextManifest } from './context-manifest.js';
import { UiContextFreshnessService } from './indexer/ui-context-freshness.service.js';
import { UiContextIndexQueue } from './indexer/ui-context-index.queue.js';
import { UiContextRepository } from './repositories/ui-context.repository.js';
import { UiConversationRepository } from './repositories/ui-conversation.repository.js';
import { UiMemoryRepository } from './repositories/ui-memory.repository.js';
import {
  isMutatingUiIntent,
  resolveUiModelPreset,
  uiAgentCapabilities,
  type UiAgentIntent,
} from './ui-agent.capabilities.js';
import type {
  ReconcileUiAgentRunDto,
  ReviewUiAgentRunDto,
} from './dto/run.dto.js';
import {
  UiAgentWorkflowService,
  matchReviewNeedsDecision,
} from './ui-agent-workflow.service.js';
import { UiAgentQualityService } from './observability/ui-agent-quality.service.js';
import {
  correlationAttributes,
} from '../telemetry/otel-attributes.js';
import { TelemetryService } from '../telemetry/telemetry.service.js';
import {
  decodeOrderCursor,
  encodeOrderCursor,
  generateUiAgentId,
} from './ui-agent.ids.js';

@Injectable()
export class UiAgentService {
  constructor(
    private readonly appData: AppDataService,
    private readonly conversations: UiConversationRepository,
    private readonly memories: UiMemoryRepository,
    private readonly context: UiContextRepository,
    private readonly freshness: UiContextFreshnessService,
    private readonly indexQueue: UiContextIndexQueue,
    private readonly credits: UsageCreditsService,
    private readonly workflow: UiAgentWorkflowService,
    @Optional() private readonly quality?: UiAgentQualityService,
    @Optional() private readonly telemetry?: TelemetryService,
  ) {}

  async createThread(
    projectId: string,
    documentId: string,
    actorUserId: string,
    dto: CreateUiThreadDto,
  ) {
    const document = await this.requireGuiDocument(
      projectId,
      documentId,
      actorUserId,
      dto.visibility === 'shared' ? 'commenter' : 'viewer',
    );
    const row = await this.conversations.createThread({
      threadId: generateUiAgentId('uithr'),
      projectId,
      documentId,
      documentKey: document.documentKey,
      ownerUserId: actorUserId,
      title: dto.title.trim(),
      visibility: dto.visibility,
    });
    return toThreadResponse(row);
  }

  async listThreads(
    projectId: string,
    documentId: string,
    actorUserId: string,
    dto: ListUiThreadsDto,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const limit = dto.limit ?? 50;
    const rows = await this.conversations.listVisibleThreads({
      projectId,
      documentId,
      actorUserId,
      visibility: dto.visibility ?? 'all',
      status: dto.status ?? 'active',
      beforeOrder: decodeOrderCursor(dto.cursor),
      limit: limit + 1,
    });
    const page = takePage(rows, limit, (row) => row.threadOrder);
    return {
      items: page.items.map(toThreadResponse),
      nextCursor: page.nextCursor,
    };
  }

  async getThread(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    return toThreadResponse(
      await this.requireVisibleThread(
        projectId,
        documentId,
        threadId,
        actorUserId,
      ),
    );
  }

  async updateThread(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
    dto: UpdateUiThreadDto,
  ) {
    if (dto.title === undefined && dto.status === undefined) {
      throw new BadRequestException('At least one thread field is required');
    }
    const thread = await this.authorizeThreadMutation(
      projectId,
      documentId,
      actorUserId,
      threadId,
    );
    const updated = await this.conversations.updateThread(thread.threadId, {
      title: dto.title?.trim(),
      status: dto.status,
    });
    if (!updated) throw new NotFoundException('Thread not found');
    return toThreadResponse(updated);
  }

  async publishThread(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
  ) {
    await this.requireGuiDocument(
      projectId,
      documentId,
      actorUserId,
      'commenter',
    );
    const thread = await this.requireVisibleThread(
      projectId,
      documentId,
      threadId,
      actorUserId,
    );
    if (thread.visibility !== 'private' || thread.ownerUserId !== actorUserId) {
      throw new NotFoundException('Private thread not found');
    }
    const published = await this.conversations.publishPrivateThread(
      threadId,
      actorUserId,
    );
    if (!published) throw new ConflictException('Thread cannot be published');
    return toThreadResponse(published);
  }

  async deletePrivateThread(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
  ): Promise<void> {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const thread = await this.requireVisibleThread(
      projectId,
      documentId,
      threadId,
      actorUserId,
    );
    if (thread.visibility !== 'private' || thread.ownerUserId !== actorUserId) {
      throw new NotFoundException('Private thread not found');
    }
    if (
      !(await this.conversations.deletePrivateThread(threadId, actorUserId))
    ) {
      throw new NotFoundException('Private thread not found');
    }
  }

  async appendMessage(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
    dto: AppendUiMessageDto,
  ) {
    const execute = dto.execute === true;
    const requiredRole: ProjectMemberRole = execute ? 'editor' : 'viewer';
    const document = await this.requireGuiDocument(
      projectId,
      documentId,
      actorUserId,
      requiredRole,
    );
    const thread = await this.requireVisibleThread(
      projectId,
      documentId,
      threadId,
      actorUserId,
    );
    if (thread.status !== 'active') {
      throw new ConflictException('Thread is not active');
    }
    if (thread.visibility === 'shared') {
      await requireProjectRole(
        this.appData,
        actorUserId,
        projectId,
        execute ? 'editor' : 'commenter',
      );
    }
    if (thread.visibility === 'private' && thread.ownerUserId !== actorUserId) {
      throw new NotFoundException('Thread not found');
    }

    const parts = parseParts(dto.parts);
    const citations = parseCitations(dto.citations ?? []);
    if (
      thread.visibility === 'shared' &&
      citations.some((citation) => citation.visibility === 'private')
    ) {
      throw new BadRequestException(
        'Private citations cannot be stored in a shared message',
      );
    }
    const revision = await this.freshness.ensureCurrent({
      projectId,
      documentId,
      documentKey: document.documentKey,
    });
    await this.validateMessageReferences(
      projectId,
      documentId,
      actorUserId,
      parts,
      revision,
    );

    let requestId: string | undefined;
    if (execute) {
      requestId = dto.idempotencyKey
        ? `uireq_${canonicalSha256({
            projectId,
            threadId,
            actorUserId,
            idempotencyKey: dto.idempotencyKey,
          }).slice(0, 48)}`
        : `uireq_${randomUUID()}`;
      const existing = await this.context.getRunByRequest(projectId, requestId);
      if (existing) {
        if (
          existing.documentId !== documentId ||
          existing.threadId !== threadId ||
          existing.actorUserId !== actorUserId
        ) {
          throw new ConflictException('Idempotency key is already in use');
        }
        await this.workflow.resumeRun(existing);
        return {
          messageId: existing.messageId,
          runId: existing.runId,
          requestId: existing.requestId,
          activityId: existing.activityId,
          status: existing.status,
        };
      }
    }
    const intent: UiAgentIntent = dto.intent ?? 'chat';
    const mutating = execute && isMutatingUiIntent(intent);
    let clarificationRun: UiAgentRunRow | undefined;
    if (execute) {
      const active = await this.context.getActiveMutatingRun(
        document.documentKey,
      );
      if (active) {
        if (
          active.status === 'awaiting_clarification' &&
          active.actorUserId === actorUserId
        ) {
          if (active.threadId === threadId) {
            clarificationRun = active;
          } else if (mutating) {
            await this.cancelMutatingRun(active, actorUserId);
          }
        } else if (mutating && placeholderReviewLock(active)) {
          await this.cancelMutatingRun(active, actorUserId);
        } else if (mutating) {
          throw new ConflictException({
            message: 'A mutating UI-agent run is already active',
            code: 'active_mutating_run',
            activeRun: toRunResponse(active),
          });
        }
      }
    }
    const preset = execute
      ? resolveUiModelPreset(
          clarificationRun?.modelPresetId ?? dto.modelPresetId,
          {
            visibility: thread.visibility,
            intent,
            hasImages: parts.some((part) => part.type === 'image_asset'),
          },
        )
      : undefined;
    if (execute) await this.credits.assertHasCredits(actorUserId);

    const viewRevision = clarificationRun?.frozenRevisionId
      ? ((await this.context.getDocumentRevision(
          clarificationRun.frozenRevisionId,
        )) ?? revision)
      : revision;
    await this.assertEditorView(viewRevision, parts);

    const row = await this.conversations.appendMessage({
      messageId: generateUiAgentId('uimsg'),
      thread,
      actorUserId,
      role: 'user',
      parts,
      citations,
    });
    if (!execute) return toMessageResponse(row);
    if (clarificationRun) {
      const resumed = await this.workflow.resumeAfterClarification(
        clarificationRun,
        row,
      );
      return {
        messageId: row.messageId,
        runId: resumed.runId,
        requestId: resumed.requestId,
        activityId: resumed.activityId,
        status: resumed.status,
      };
    }

    const runId = generateUiAgentId('uirun');
    const activityId = generateActivityId();
    await this.appData.createCollaborationActivity({
      activityId,
      projectId,
      documentId,
      documentType: 'gui_screen',
      requestId,
      actorUserId,
      activityType: 'ai_task',
      runId,
      actionKind: 'ui_agent',
      target: { runId, threadId, messageId: row.messageId },
      result: {
        runId,
        threadId,
        messageId: row.messageId,
        runStatus: 'created',
        progress: 0,
      },
    });
    const run = await this.context.createRun({
      runId,
      requestId: requestId!,
      activityId,
      projectId,
      documentId,
      documentKey: document.documentKey,
      threadId,
      actorUserId,
      ownerUserId: thread.ownerUserId,
      visibility: thread.visibility,
      status: 'created',
      intent,
      baseDocumentHash: revision.documentHash,
      frozenRevisionId: revision.revisionId,
      messageId: row.messageId,
      modelPresetId: preset!.id,
      mutating,
    });
    const initialized = await this.workflow.initializeRun({
      run,
      message: row,
      revision,
      preset: preset!,
      selectionHints: dto.selectionHints,
    });
    return {
      messageId: row.messageId,
      runId: initialized.runId,
      requestId: initialized.requestId,
      activityId: initialized.activityId,
      status: initialized.status,
    };
  }

  async listMessages(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
    limit = 50,
    cursor?: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const thread = await this.requireVisibleThread(
      projectId,
      documentId,
      threadId,
      actorUserId,
    );
    const rows = await this.conversations.listMessages({
      projectId,
      threadId: thread.threadId,
      beforeOrder: decodeOrderCursor(cursor),
      limit: limit + 1,
    });
    const page = takePage(rows, limit, (row) => row.messageOrder);
    return {
      items: page.items.map(toMessageResponse),
      nextCursor: page.nextCursor,
    };
  }

  async createAgentRun(input: {
    projectId: string;
    documentId: string;
    actorUserId: string;
    threadId: string;
    requestId: string;
    intent: string;
    activityId?: string;
  }) {
    const document = await this.requireGuiDocument(
      input.projectId,
      input.documentId,
      input.actorUserId,
      'viewer',
    );
    const thread = await this.requireVisibleThread(
      input.projectId,
      input.documentId,
      input.threadId,
      input.actorUserId,
    );
    if (thread.visibility === 'shared') {
      await requireProjectRole(
        this.appData,
        input.actorUserId,
        input.projectId,
        'commenter',
      );
    }
    const revision = await this.freshness.ensureCurrent({
      projectId: input.projectId,
      documentId: input.documentId,
      documentKey: document.documentKey,
    });
    return this.context.createRun({
      runId: generateUiAgentId('uirun'),
      requestId: input.requestId,
      activityId: input.activityId,
      projectId: input.projectId,
      documentId: input.documentId,
      documentKey: document.documentKey,
      threadId: thread.threadId,
      actorUserId: input.actorUserId,
      ownerUserId: thread.ownerUserId,
      visibility: thread.visibility,
      status: 'awaiting_context',
      intent: input.intent,
      baseDocumentHash: revision.documentHash,
      frozenRevisionId: revision.revisionId,
    });
  }

  async exportPrivateThread(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const thread = await this.requireVisibleThread(
      projectId,
      documentId,
      threadId,
      actorUserId,
    );
    if (thread.visibility !== 'private' || thread.ownerUserId !== actorUserId) {
      throw new NotFoundException('Private thread not found');
    }
    const [messages, memories] = await Promise.all([
      this.conversations.exportMessages(threadId),
      this.memories.listThreadMemory(threadId),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      thread: toThreadResponse(thread),
      messages: messages.map(toMessageResponse),
      memories: memories.map(toMemoryResponse),
    };
  }

  async createMemory(
    projectId: string,
    documentId: string,
    actorUserId: string,
    dto: CreateUiMemoryDto,
  ) {
    await this.requireGuiDocument(
      projectId,
      documentId,
      actorUserId,
      dto.visibility === 'shared' ? 'commenter' : 'viewer',
    );
    const thread = dto.threadId
      ? await this.requireVisibleThread(
          projectId,
          documentId,
          dto.threadId,
          actorUserId,
        )
      : undefined;
    if (thread && thread.visibility !== dto.visibility) {
      throw new BadRequestException(
        'Memory visibility must match its source thread',
      );
    }
    await this.validateMemorySource(
      projectId,
      documentId,
      actorUserId,
      dto.sourceKind,
      dto.sourceId,
      thread,
    );
    const structuredValue =
      dto.structuredValue === undefined
        ? undefined
        : parseJsonValue(dto.structuredValue);

    const row = await this.memories.createMemory({
      memoryId: generateUiAgentId('uimem'),
      projectId,
      documentId,
      threadId: thread?.threadId,
      ownerUserId: actorUserId,
      kind: dto.kind,
      scope: dto.scope,
      scopeId: dto.scopeId,
      text: dto.text.trim(),
      structuredValue,
      visibility: dto.visibility,
      pinned: dto.pinned ?? false,
      provenance: {
        sourceKind: dto.sourceKind,
        sourceId: dto.sourceId,
        actorId: actorUserId,
        documentRevision: dto.documentRevision,
      },
    });
    return toMemoryResponse(row);
  }

  async listMemory(
    projectId: string,
    documentId: string,
    actorUserId: string,
    dto: ListUiMemoryDto,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const limit = dto.limit ?? 50;
    const rows = await this.memories.listVisibleMemory({
      projectId,
      documentId,
      actorUserId,
      visibility: dto.visibility ?? 'all',
      status: dto.status,
      kind: dto.kind,
      scope: dto.scope,
      scopeId: dto.scopeId,
      beforeOrder: decodeOrderCursor(dto.cursor),
      limit: limit + 1,
    });
    const page = takePage(rows, limit, (row) => row.memoryOrder);
    return {
      items: page.items.map(toMemoryResponse),
      nextCursor: page.nextCursor,
    };
  }

  async acceptMemory(
    projectId: string,
    documentId: string,
    actorUserId: string,
    memoryId: string,
    effectiveRevision?: string,
  ) {
    const memory = await this.authorizeMemoryMutation(
      projectId,
      documentId,
      actorUserId,
      memoryId,
    );
    const updated = await this.memories.transitionMemory({
      memoryId: memory.memoryId,
      fromStatuses: ['proposed'],
      status: 'accepted',
      reviewedByUserId: actorUserId,
      effectiveRevision,
    });
    if (!updated) throw new ConflictException('Memory is no longer proposed');
    await this.enqueueMemoryIndex(updated);
    return toMemoryResponse(updated);
  }

  async rejectMemory(
    projectId: string,
    documentId: string,
    actorUserId: string,
    memoryId: string,
  ) {
    const memory = await this.authorizeMemoryMutation(
      projectId,
      documentId,
      actorUserId,
      memoryId,
    );
    const updated = await this.memories.transitionMemory({
      memoryId: memory.memoryId,
      fromStatuses: ['proposed'],
      status: 'rejected',
      reviewedByUserId: actorUserId,
    });
    if (!updated) throw new ConflictException('Memory is no longer proposed');
    await this.enqueueMemoryIndex(updated);
    return toMemoryResponse(updated);
  }

  async publishMemory(
    projectId: string,
    documentId: string,
    actorUserId: string,
    memoryId: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'editor');
    const source = await this.requireVisibleMemory(
      projectId,
      documentId,
      memoryId,
      actorUserId,
    );
    if (source.visibility !== 'private' || source.ownerUserId !== actorUserId) {
      throw new NotFoundException('Private memory not found');
    }
    const published = await this.memories.createMemory({
      memoryId: generateUiAgentId('uimem'),
      projectId,
      documentId,
      ownerUserId: actorUserId,
      kind: source.kind,
      scope: source.scope,
      scopeId: source.scopeId,
      text: source.text,
      structuredValue: source.structuredValue,
      status: 'proposed',
      visibility: 'shared',
      pinned: source.pinned,
      provenance: {
        sourceKind: 'memory',
        sourceId: source.memoryId,
        actorId: actorUserId,
        documentRevision: source.effectiveRevision,
      },
    });
    return toMemoryResponse(published);
  }

  async supersedeMemory(
    projectId: string,
    documentId: string,
    actorUserId: string,
    memoryId: string,
    replacementMemoryId: string,
  ) {
    const [memory, replacement] = await Promise.all([
      this.authorizeMemoryMutation(
        projectId,
        documentId,
        actorUserId,
        memoryId,
      ),
      this.authorizeMemoryMutation(
        projectId,
        documentId,
        actorUserId,
        replacementMemoryId,
      ),
    ]);
    if (memory.memoryId === replacement.memoryId) {
      throw new BadRequestException('Memory cannot supersede itself');
    }
    const updated = await this.memories.supersedeMemory(
      memory.memoryId,
      replacement.memoryId,
      actorUserId,
    );
    if (!updated) {
      throw new ConflictException(
        'Replacement must be accepted and match scope, kind, and visibility',
      );
    }
    await this.enqueueMemoryIndex(updated);
    return toMemoryResponse(updated);
  }

  async getContextManifest(
    projectId: string,
    documentId: string,
    actorUserId: string,
    runId: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const row = await this.context.getContextManifestByRun(
      projectId,
      documentId,
      runId,
    );
    if (
      !row ||
      (row.visibility === 'private' && row.ownerUserId !== actorUserId)
    ) {
      throw new NotFoundException('Context manifest not found');
    }
    return {
      ...sanitizeContextManifest(row.manifest),
      manifestHash: row.manifestHash,
    };
  }

  async persistContextManifest(input: {
    manifest: ContextManifest;
    actorUserId: string;
  }) {
    const run = await this.context.getRun(
      input.manifest.projectId,
      input.manifest.documentId,
      input.manifest.runId,
    );
    if (
      !run ||
      run.actorUserId !== input.actorUserId ||
      run.threadId !== input.manifest.threadId
    ) {
      throw new NotFoundException('Agent run not found');
    }
    const { manifest, manifestHash } = normalizeContextManifest(
      input.manifest,
      run.visibility,
    );
    const existing = await this.context.getContextManifestByRun(
      manifest.projectId,
      manifest.documentId,
      manifest.runId,
    );
    if (existing) {
      if (existing.manifestHash !== manifestHash) {
        throw new ConflictException(
          'Context manifest is immutable once persisted for a run',
        );
      }
      return existing;
    }
    return this.context.saveContextManifest({
      manifest,
      manifestHash,
      documentId: manifest.documentId,
      threadId: manifest.threadId,
      actorUserId: input.actorUserId,
      ownerUserId: run.ownerUserId,
      visibility: run.visibility,
    });
  }

  async getCapabilities(
    projectId: string,
    documentId: string,
    actorUserId: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    return uiAgentCapabilities();
  }

  async getRun(
    projectId: string,
    documentId: string,
    actorUserId: string,
    runId: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const run = await this.requireVisibleRun(
      projectId,
      documentId,
      actorUserId,
      runId,
    );
    return toRunResponse(run, await this.context.listSteps(run.runId));
  }

  async cancelRun(
    projectId: string,
    documentId: string,
    actorUserId: string,
    runId: string,
  ) {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'editor');
    const run = await this.requireVisibleRun(
      projectId,
      documentId,
      actorUserId,
      runId,
    );
    this.requireRunMutationOwner(run, actorUserId);
    if (isTerminalRunStatus(run.status)) {
      return toRunResponse(run, await this.context.listSteps(run.runId));
    }
    const cancelled = await this.cancelMutatingRun(run, actorUserId);
    return toRunResponse(cancelled, await this.context.listSteps(run.runId));
  }

  async reviewRun(
    projectId: string,
    documentId: string,
    actorUserId: string,
    runId: string,
    dto: ReviewUiAgentRunDto,
  ) {
    const document = await this.requireGuiDocument(
      projectId,
      documentId,
      actorUserId,
      'editor',
    );
    const run = await this.requireVisibleRun(
      projectId,
      documentId,
      actorUserId,
      runId,
    );
    this.requireRunMutationOwner(run, actorUserId);
    if (!['awaiting_review', 'needs_rebase'].includes(run.status)) {
      throw new ConflictException('Run is not awaiting review');
    }
    const review = JsonValueSchema.parse({
      decision: dto.decision,
      ...(dto.alternativeId ? { alternativeId: dto.alternativeId } : {}),
      ...(dto.notes ? { notes: dto.notes } : {}),
      actorId: actorUserId,
      decidedAt: new Date().toISOString(),
    });
    let status: AgentRun['status'];
    if (dto.decision === 'approve') {
      const revision = await this.freshness.ensureCurrent({
        projectId,
        documentId,
        documentKey: document.documentKey,
      });
      if (revision.documentHash !== run.baseDocumentHash) {
        if (run.status !== 'needs_rebase') {
          const rebasing = await this.context.transitionRun({
            runId: run.runId,
            expectedStatuses: [run.status],
            status: 'needs_rebase',
            review,
          });
          if (rebasing) await this.updateRunActivity(rebasing);
        }
        throw new ConflictException({
          message: 'Document changed after this proposal was generated',
          code: 'needs_rebase',
          currentDocumentHash: revision.documentHash,
          baseDocumentHash: run.baseDocumentHash,
        });
      }
      status = 'completed';
    } else if (dto.decision === 'reject') {
      status = 'cancelled';
    } else {
      status = 'awaiting_clarification';
    }
    // On approve, stamp the decision into the persisted proposal itself.
    // Otherwise a client that re-fetches the run in a later session sees a
    // matchReview with no reviewDecision and blocks its own apply.
    const stampedResult =
      dto.decision === 'approve'
        ? stampApprovedReviewDecision(run.result, {
            alternativeId: dto.alternativeId,
            actorId: actorUserId,
            decidedAt: new Date().toISOString(),
            notes: dto.notes,
          })
        : undefined;
    const reviewed = await this.context.transitionRun({
      runId: run.runId,
      expectedStatuses: [run.status],
      status,
      review,
      ...(stampedResult !== undefined ? { result: stampedResult } : {}),
    });
    if (!reviewed) throw new ConflictException('Run state changed');
    const metricKind =
      dto.decision === 'approve'
        ? 'human_accept'
        : dto.decision === 'reject'
          ? 'human_reject'
          : 'human_request_changes';
    await this.quality?.record({
      run: reviewed,
      metricKind,
      metricValue: 1,
    });
    if (status === 'cancelled') {
      await this.context.cancelPendingSteps(run.runId);
    }
    await this.updateRunActivity(reviewed);
    return toRunResponse(reviewed, await this.context.listSteps(run.runId));
  }

  async reconcileRun(
    projectId: string,
    documentId: string,
    actorUserId: string,
    runId: string,
    dto: ReconcileUiAgentRunDto,
  ) {
    const document = await this.requireGuiDocument(
      projectId,
      documentId,
      actorUserId,
      'editor',
    );
    const run = await this.requireVisibleRun(
      projectId,
      documentId,
      actorUserId,
      runId,
    );
    this.requireRunMutationOwner(run, actorUserId);
    if (!run.activityId) {
      throw new ConflictException('Run has no apply activity');
    }
    if (run.reconciledAt) {
      const baseline = await this.context.getBaseline(document.documentKey);
      return {
        run: toRunResponse(run, await this.context.listSteps(run.runId)),
        baseline,
      };
    }
    if (run.status !== 'completed') {
      throw new ConflictException('Only completed runs can be reconciled');
    }
    const activity = await this.appData.getCollaborationActivity(
      run.activityId,
    );
    if (
      !activity ||
      activity.projectId !== projectId ||
      activity.documentId !== documentId ||
      activity.status !== 'completed'
    ) {
      throw new ConflictException('Run activity is not ready to reconcile');
    }
    const revision = await this.freshness.ensureCurrent({
      projectId,
      documentId,
      documentKey: document.documentKey,
    });
    if (
      revision.documentHash !== dto.appliedDocumentHash ||
      (dto.appliedRevisionId && dto.appliedRevisionId !== revision.revisionId)
    ) {
      throw new ConflictException({
        message: 'Applied document does not match the persisted Yjs revision',
        code: 'applied_revision_mismatch',
        currentDocumentHash: revision.documentHash,
      });
    }
    const baseline = await this.context.upsertBaseline({
      documentKey: document.documentKey,
      projectId,
      documentId,
      revisionId: revision.revisionId,
      runId: run.runId,
      activityId: run.activityId,
      documentHash: revision.documentHash,
      proposalHash: run.proposalHash,
      reconciledAt: new Date(),
    });
    await this.appData.updateCollaborationActivity(run.activityId, {
      reconciled: true,
      result: {
        ...(activity.result ?? {}),
        runId: run.runId,
        runStatus: run.status,
        appliedDocumentHash: revision.documentHash,
        appliedRevisionId: revision.revisionId,
      },
    });
    const reconciled = (await this.context.markRunReconciled(run.runId)) ?? run;
    this.telemetry?.addAttributes(
      correlationAttributes({
        projectId,
        documentId,
        runId: run.runId,
        requestId: run.requestId,
        activityId: run.activityId,
        threadId: run.threadId,
      }),
    );
    await this.quality?.record({
      run: reconciled,
      metricKind: 'cost_usd_accepted',
      metricValue: 1,
    });
    return {
      run: toRunResponse(
        reconciled,
        await this.context.listSteps(reconciled.runId),
      ),
      baseline: {
        ...baseline,
        reconciledAt: baseline.reconciledAt.toISOString(),
        updatedAt: baseline.updatedAt.toISOString(),
      },
    };
  }

  private async requireVisibleRun(
    projectId: string,
    documentId: string,
    actorUserId: string,
    runId: string,
  ) {
    const run = await this.context.getRun(projectId, documentId, runId);
    if (
      !run ||
      (run.visibility === 'private' && run.ownerUserId !== actorUserId)
    ) {
      throw new NotFoundException('Agent run not found');
    }
    return run;
  }

  private requireRunMutationOwner(
    run: UiAgentRunRow,
    actorUserId: string,
  ): void {
    if (run.visibility === 'private' && run.ownerUserId !== actorUserId) {
      throw new NotFoundException('Agent run not found');
    }
  }

  private async cancelMutatingRun(
    run: UiAgentRunRow,
    actorUserId: string,
  ): Promise<UiAgentRunRow> {
    const cancelled = await this.context.transitionRun({
      runId: run.runId,
      expectedStatuses: [run.status],
      status: 'cancelled',
      review: JsonValueSchema.parse({
        decision: 'cancel',
        actorId: actorUserId,
        decidedAt: new Date().toISOString(),
      }),
    });
    if (!cancelled) throw new ConflictException('Run state changed');
    await this.context.cancelPendingSteps(run.runId);
    await this.updateRunActivity(cancelled);
    void this.workflow.bestEffortCancelWorker(run.runId).catch(() => undefined);
    return cancelled;
  }

  private async updateRunActivity(run: UiAgentRunRow): Promise<void> {
    if (!run.activityId) return;
    await this.appData.updateCollaborationActivity(run.activityId, {
      status:
        run.status === 'failed'
          ? 'failed'
          : run.status === 'cancelled'
            ? 'cancelled'
            : run.status === 'completed'
              ? 'completed'
              : 'running',
      result: {
        runId: run.runId,
        threadId: run.threadId,
        messageId: run.messageId,
        runStatus: run.status,
        proposal: run.result,
        proposalHash: run.proposalHash,
        review: run.review,
      },
      errorMessage: run.errorMessage,
    });
  }

  private async authorizeThreadMutation(
    projectId: string,
    documentId: string,
    actorUserId: string,
    threadId: string,
  ): Promise<UiAiThreadRow> {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'viewer');
    const thread = await this.requireVisibleThread(
      projectId,
      documentId,
      threadId,
      actorUserId,
    );
    if (thread.visibility === 'private') {
      if (thread.ownerUserId !== actorUserId) {
        throw new NotFoundException('Thread not found');
      }
    } else {
      await requireProjectRole(this.appData, actorUserId, projectId, 'editor');
    }
    return thread;
  }

  private async authorizeMemoryMutation(
    projectId: string,
    documentId: string,
    actorUserId: string,
    memoryId: string,
  ): Promise<UiDesignMemoryRow> {
    await this.requireGuiDocument(projectId, documentId, actorUserId, 'editor');
    const memory = await this.requireVisibleMemory(
      projectId,
      documentId,
      memoryId,
      actorUserId,
    );
    if (memory.visibility === 'private' && memory.ownerUserId !== actorUserId) {
      throw new NotFoundException('Memory not found');
    }
    return memory;
  }

  private async requireVisibleThread(
    projectId: string,
    documentId: string,
    threadId: string,
    actorUserId: string,
  ): Promise<UiAiThreadRow> {
    const thread = await this.conversations.getThread(
      projectId,
      documentId,
      threadId,
    );
    if (
      !thread ||
      (thread.visibility === 'private' && thread.ownerUserId !== actorUserId)
    ) {
      throw new NotFoundException('Thread not found');
    }
    return thread;
  }

  private async requireVisibleMemory(
    projectId: string,
    documentId: string,
    memoryId: string,
    actorUserId: string,
  ): Promise<UiDesignMemoryRow> {
    const memory = await this.memories.getMemory(
      projectId,
      documentId,
      memoryId,
    );
    if (
      !memory ||
      (memory.visibility === 'private' && memory.ownerUserId !== actorUserId)
    ) {
      throw new NotFoundException('Memory not found');
    }
    return memory;
  }

  private async requireGuiDocument(
    projectId: string,
    documentId: string,
    actorUserId: string,
    minimumRole: ProjectMemberRole,
  ): Promise<CollaborationDocumentRow> {
    await requireProjectRole(this.appData, actorUserId, projectId, minimumRole);
    const document = await this.appData.getCollaborationDocumentById(
      projectId,
      documentId,
    );
    if (
      !document ||
      document.documentType !== 'gui_screen' ||
      document.archivedAt
    ) {
      throw new NotFoundException('GUI document not found');
    }
    return document;
  }

  private async validateMessageReferences(
    projectId: string,
    documentId: string,
    actorUserId: string,
    parts: MessagePart[],
    revision: UiDocumentRevisionRow,
  ): Promise<void> {
    await Promise.all(
      parts.map(async (part) => {
        if (part.type === 'image_asset') {
          const asset = await this.appData.getProjectAsset(part.assetId);
          if (
            !asset ||
            asset.projectId !== projectId ||
            asset.status !== 'ready' ||
            (part.contentHash !== undefined &&
              asset.checksum !== part.contentHash)
          ) {
            throw new NotFoundException(
              'Referenced asset is unavailable or stale',
            );
          }
        }
        if (part.type === 'ui_reference') {
          if (
            part.documentHash !== undefined &&
            part.documentHash !== revision.documentHash
          ) {
            throw new ConflictException('Referenced UI document is stale');
          }
          if (
            !jsonContainsSemanticId(
              revision.layoutFingerprints,
              part.semanticId,
            ) &&
            !jsonContainsSemanticId(revision.structuralDigest, part.semanticId)
          ) {
            throw new NotFoundException('Referenced UI element not found');
          }
        }
        if (part.type === 'storyboard_section') {
          const document = await this.appData.getCollaborationDocumentById(
            projectId,
            part.documentId,
          );
          if (!document || document.documentType !== 'storyboard') {
            throw new NotFoundException('Referenced storyboard not found');
          }
        }
        if (part.type === 'comment') {
          const comment = await this.appData.getProjectComment(part.commentId);
          if (
            !comment ||
            comment.projectId !== projectId ||
            (comment.documentId !== undefined &&
              comment.documentId !== documentId)
          ) {
            throw new NotFoundException('Referenced comment not found');
          }
        }
        if (part.type === 'project_artifact') {
          if (part.artifactKind === 'asset' || part.artifactKind === 'file') {
            const asset = await this.appData.getProjectAsset(part.artifactId);
            if (
              !asset ||
              asset.projectId !== projectId ||
              asset.status !== 'ready' ||
              (part.contentHash !== undefined &&
                asset.checksum !== part.contentHash)
            ) {
              throw new NotFoundException(
                'Referenced project artifact not found',
              );
            }
            return;
          }
          if (part.artifactKind === 'document') {
            const artifactDocument =
              await this.appData.getCollaborationDocumentById(
                projectId,
                part.artifactId,
              );
            if (!artifactDocument || artifactDocument.archivedAt) {
              throw new NotFoundException('Referenced document not found');
            }
            return;
          }
          if (part.artifactKind === 'lore') {
            await this.requireVisibleMemory(
              projectId,
              documentId,
              part.artifactId,
              actorUserId,
            );
            return;
          }
          throw new BadRequestException(
            'Repository artifacts are not available to UI-agent runs',
          );
        }
      }),
    );
  }

  private async validateMemorySource(
    projectId: string,
    documentId: string,
    actorUserId: string,
    sourceKind: CreateUiMemoryDto['sourceKind'],
    sourceId: string,
    thread?: UiAiThreadRow,
  ): Promise<void> {
    if (sourceKind === 'user') {
      if (sourceId !== actorUserId) {
        throw new BadRequestException(
          'User provenance must identify the actor',
        );
      }
      return;
    }
    if (sourceKind === 'message') {
      if (!thread) {
        throw new BadRequestException(
          'Message provenance requires a source thread',
        );
      }
      const message = await this.conversations.getMessage(
        projectId,
        thread.threadId,
        sourceId,
      );
      if (!message) throw new NotFoundException('Source message not found');
      return;
    }
    if (sourceKind === 'comment') {
      const comment = await this.appData.getProjectComment(sourceId);
      if (
        !comment ||
        comment.projectId !== projectId ||
        (comment.documentId !== undefined && comment.documentId !== documentId)
      ) {
        throw new NotFoundException('Source comment not found');
      }
      return;
    }
    const run = await this.context.getRun(projectId, documentId, sourceId);
    if (
      !run ||
      (run.visibility === 'private' && run.ownerUserId !== actorUserId)
    ) {
      throw new NotFoundException('Source run not found');
    }
  }

  private async assertEditorView(
    revision: UiDocumentRevisionRow,
    parts: MessagePart[],
  ): Promise<void> {
    const part = parts.find((item) => item.type === 'editor_view');
    if (!part || part.type !== 'editor_view') return;
    const document = await this.workflow.loadFrozenGuiDocument(revision);
    if (!document) {
      throw new BadRequestException(
        'Frozen GUI snapshot is unavailable, so the editor view cannot be checked',
      );
    }
    const issues = editorViewIssues({
      document,
      documentHash: revision.documentHash,
      submission: part.view,
    });
    if (issues.length > 0) {
      throw new BadRequestException(issues[0].message);
    }
  }

  private async enqueueMemoryIndex(memory: UiDesignMemoryRow): Promise<void> {
    await this.indexQueue.enqueueSource({
      kind: 'source',
      projectId: memory.projectId,
      documentId: memory.documentId,
      sourceKind: 'memory',
      sourceId: memory.memoryId,
      sourceHash: canonicalSha256({
        memoryId: memory.memoryId,
        status: memory.status,
        visibility: memory.visibility,
        text: memory.text,
        structuredValue: memory.structuredValue ?? null,
        effectiveRevision: memory.effectiveRevision ?? null,
        supersededByMemoryId: memory.supersededByMemoryId ?? null,
      }),
    });
  }
}

function parseParts(value: unknown): MessagePart[] {
  const result = MessagePartSchema.array().min(1).max(128).safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Invalid message parts',
      issues: result.error.issues,
    });
  }
  return result.data;
}

function parseCitations(value: unknown): SourceCitation[] {
  const result = SourceCitationSchema.array().max(256).safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Invalid message citations',
      issues: result.error.issues,
    });
  }
  return result.data;
}

function parseJsonValue(value: unknown) {
  const result = JsonValueSchema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException('structuredValue must be valid JSON');
  }
  return result.data;
}

function takePage<T>(
  rows: T[],
  limit: number,
  order: (row: T) => number,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeOrderCursor(order(last)) : undefined,
  };
}

function jsonContainsSemanticId(value: unknown, semanticId: string): boolean {
  if (value === semanticId) return true;
  if (Array.isArray(value)) {
    return value.some((item) => jsonContainsSemanticId(item, semanticId));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, item]) =>
        key === semanticId || jsonContainsSemanticId(item, semanticId),
    );
  }
  return false;
}

function stampApprovedReviewDecision(
  result: JsonValue | undefined,
  decision: {
    alternativeId?: string;
    actorId: string;
    decidedAt: string;
    notes?: string;
  },
): JsonValue | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return undefined;
  }
  const turn = result as unknown as {
    matchReview?: {
      recommendedAlternativeId?: string;
      alternatives?: Array<{ alternativeId?: string }>;
      reviewDecision?: unknown;
    };
  };
  const matchReview = turn.matchReview;
  if (!matchReview || matchReview.reviewDecision) return undefined;
  const alternativeId =
    decision.alternativeId ??
    matchReview.recommendedAlternativeId ??
    matchReview.alternatives?.[0]?.alternativeId;
  if (!alternativeId) return undefined;
  const stamped = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  const stampedReview = stamped.matchReview as Record<string, unknown>;
  stampedReview.reviewDecision = {
    alternativeId,
    actorId: decision.actorId,
    decidedAt: decision.decidedAt,
    ...(decision.notes ? { notes: decision.notes } : {}),
  };
  return JsonValueSchema.parse(stamped);
}

function placeholderReviewLock(run: UiAgentRunRow): boolean {
  if (run.status !== 'awaiting_review') return false;
  const result = run.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return true;
  const review = (result as { matchReview?: Parameters<typeof matchReviewNeedsDecision>[0] })
    .matchReview;
  return !matchReviewNeedsDecision(review);
}

function isTerminalRunStatus(status: AgentRun['status']): boolean {
  return ['completed', 'failed', 'cancelled'].includes(status);
}
