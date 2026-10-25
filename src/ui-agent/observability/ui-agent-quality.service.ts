import { Injectable, Logger, Optional } from '@nestjs/common';
import type { UiAgentQualityMetricKind } from '@markaschmidt/ui-builder-contracts';
import { UiContextRepository } from '../repositories/ui-context.repository.js';
import type { UiAgentRunRow } from '../models/ui-agent.model.js';
import { generateUiAgentId } from '../ui-agent.ids.js';

export interface QualityRecordInput {
  run: Pick<
    UiAgentRunRow,
    | 'projectId'
    | 'documentId'
    | 'runId'
    | 'threadId'
    | 'ownerUserId'
    | 'visibility'
    | 'modelPresetId'
  >;
  metricKind: UiAgentQualityMetricKind;
  metricValue: number;
  documentKind?: string;
  promptVersion?: string;
  schemaVersion?: string;
  dimensions?: Record<string, string | number | boolean>;
}

@Injectable()
export class UiAgentQualityService {
  private readonly logger = new Logger(UiAgentQualityService.name);

  constructor(
    @Optional() private readonly context?: UiContextRepository,
  ) {}

  async record(input: QualityRecordInput): Promise<void> {
    if (!this.context) return;
    if (input.run.visibility === 'private') {
      const policy = await this.context.getTelemetryPolicy(input.run.projectId);
      if (!policy?.allowPrivateAggregates) {
        return;
      }
    }
    try {
      await this.context.recordQualityEvent({
        eventId: generateUiAgentId('uiqlt'),
        projectId: input.run.projectId,
        documentId: input.run.documentId,
        runId: input.run.runId,
        threadId: input.run.threadId,
        ownerUserId: input.run.ownerUserId,
        visibility: input.run.visibility,
        metricKind: input.metricKind,
        metricValue: input.metricValue,
        documentKind: input.documentKind,
        modelPresetId: input.run.modelPresetId,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        dimensions: input.dimensions,
      });
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'ui_agent_quality_record_failed',
          runId: input.run.runId,
          metricKind: input.metricKind,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
