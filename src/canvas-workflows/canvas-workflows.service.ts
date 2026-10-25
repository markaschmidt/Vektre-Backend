import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import { requireProjectRole } from '../projects/project-access.js';
import { generateActivityId } from '../collaboration-documents/collaboration-ids.js';
import {
  actionKindToActivityType,
  isCanvasActionKind,
} from '../collaboration-documents/models/canvas-graph.model.js';
import { toCollaborationActivityResponse } from '../collaboration-documents/models/collaboration-documents.model.js';
import {
  CANVAS_ACTION_HANDLERS,
  type CanvasActionHandler,
  type CanvasActionRunContext,
} from './canvas-action.interface.js';
import { buildCanvasCapabilitiesResponse } from './models/canvas-capabilities.model.js';
import type { RunCanvasActionDto } from './dto/run-canvas-action.dto.js';

const BATCH_MAX_ACTIONS = 16;

@Injectable()
export class CanvasWorkflowsService {
  private readonly logger = new Logger(CanvasWorkflowsService.name);
  private readonly handlersByKind: Map<string, CanvasActionHandler>;

  constructor(
    private readonly appData: AppDataService,
    @Inject(CANVAS_ACTION_HANDLERS)
    handlers: CanvasActionHandler[],
  ) {
    this.handlersByKind = new Map(handlers.map((h) => [h.kind, h]));
  }

  getCapabilities(projectId: string, documentId: string, userId: string) {
    return this.withCanvasDocument(
      projectId,
      documentId,
      userId,
      'viewer',
    ).then(() => buildCanvasCapabilitiesResponse());
  }

  /**
   * Enqueue many canvas actions in parallel. Each action keeps its own runId
   * idempotency. Failures are isolated — one bad action does not roll back others.
   */
  async runActionBatch(
    projectId: string,
    documentId: string,
    userId: string,
    actions: RunCanvasActionDto[],
  ) {
    if (!actions.length) {
      throw new BadRequestException('actions array must not be empty');
    }
    if (actions.length > BATCH_MAX_ACTIONS) {
      throw new BadRequestException(
        `Batch exceeds limit of ${BATCH_MAX_ACTIONS} actions`,
      );
    }

    const runIds = actions.map((a) => a.runId);
    if (new Set(runIds).size !== runIds.length) {
      throw new BadRequestException(
        'Each action in a batch must use a unique runId',
      );
    }

    // Ensure the canvas document exists / is writable before fan-out.
    await this.withCanvasDocument(projectId, documentId, userId, 'editor');

    const results = await Promise.all(
      actions.map(async (dto) => {
        try {
          const result = await this.runAction(
            projectId,
            documentId,
            userId,
            dto,
          );
          return { ok: true as const, ...result };
        } catch (err) {
          return {
            ok: false as const,
            runId: dto.runId,
            actionKind: dto.actionKind,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const enqueued = results.filter((r) => r.ok && r.enqueued).length;
    const failed = results.filter((r) => !r.ok).length;

    this.logger.log(
      JSON.stringify({
        event: 'canvas_action_batch_complete',
        projectId,
        documentId,
        total: actions.length,
        enqueued,
        failed,
      }),
    );

    return {
      total: actions.length,
      enqueued,
      failed,
      results,
    };
  }

  async runAction(
    projectId: string,
    documentId: string,
    userId: string,
    dto: RunCanvasActionDto,
  ) {
    const document = await this.withCanvasDocument(
      projectId,
      documentId,
      userId,
      'editor',
    );

    if (!isCanvasActionKind(dto.actionKind)) {
      throw new BadRequestException(
        `Unsupported actionKind: ${dto.actionKind}`,
      );
    }

    const existing = await this.appData.getCollaborationActivityByRunId(
      projectId,
      documentId,
      dto.runId,
    );
    if (existing) {
      this.logger.log(
        JSON.stringify({
          event: 'canvas_action_idempotent_hit',
          projectId,
          documentId,
          runId: dto.runId,
          activityId: existing.activityId,
        }),
      );
      return {
        idempotent: true,
        enqueued: false,
        requestId: existing.requestId,
        activity: toCollaborationActivityResponse(existing),
      };
    }

    const handler = this.handlersByKind.get(dto.actionKind);
    if (!handler) {
      throw new BadRequestException(
        `No handler registered for actionKind: ${dto.actionKind}`,
      );
    }

    const requestId = randomUUID();
    const activityId = generateActivityId();
    const ctx: CanvasActionRunContext = {
      projectId,
      documentId,
      userId,
      workflowId: dto.workflowId,
      nodeId: dto.nodeId,
      runId: dto.runId,
      actionKind: dto.actionKind,
      activityId,
      requestId,
      config: dto.config ?? {},
      inputs: {
        texts: dto.inputs?.texts ?? [],
        assets: dto.inputs?.assets ?? [],
      },
    };

    await handler.validate(ctx);

    let activity;
    try {
      activity = await this.appData.createCollaborationActivity({
        activityId,
        projectId,
        documentId,
        documentType: document.documentType,
        requestId,
        actorUserId: userId,
        activityType: actionKindToActivityType(dto.actionKind),
        status: 'pending',
        workflowId: dto.workflowId,
        nodeId: dto.nodeId,
        runId: dto.runId,
        actionKind: dto.actionKind,
        target: {
          workflowId: dto.workflowId,
          nodeId: dto.nodeId,
          runId: dto.runId,
          actionKind: dto.actionKind,
        },
      });
    } catch (err) {
      // Race: another request inserted the same runId first.
      const raced = await this.appData.getCollaborationActivityByRunId(
        projectId,
        documentId,
        dto.runId,
      );
      if (raced) {
        return {
          idempotent: true,
          enqueued: false,
          requestId: raced.requestId,
          activity: toCollaborationActivityResponse(raced),
        };
      }
      throw err;
    }

    try {
      await handler.enqueue(ctx);
      await this.appData.updateCollaborationActivity(activityId, {
        status: 'running',
      });
      const running = await this.appData.getCollaborationActivity(activityId);
      this.logger.log(
        JSON.stringify({
          event: 'canvas_action_enqueued',
          projectId,
          documentId,
          runId: dto.runId,
          actionKind: dto.actionKind,
          requestId,
          activityId,
        }),
      );
      return {
        idempotent: false,
        enqueued: true,
        requestId,
        activity: toCollaborationActivityResponse(running ?? activity),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appData.updateCollaborationActivity(activityId, {
        status: 'failed',
        errorMessage: message,
      });
      throw err;
    }
  }

  private async withCanvasDocument(
    projectId: string,
    documentId: string,
    userId: string,
    minRole: 'viewer' | 'editor',
  ) {
    await requireProjectRole(this.appData, userId, projectId, minRole);
    const document = await this.appData.getCollaborationDocumentById(
      projectId,
      documentId,
    );
    if (!document || document.archivedAt) {
      throw new NotFoundException('Document not found');
    }
    if (document.documentType !== 'canvas') {
      throw new BadRequestException(
        `Document ${documentId} is type "${document.documentType}", expected "canvas"`,
      );
    }
    return document;
  }
}
