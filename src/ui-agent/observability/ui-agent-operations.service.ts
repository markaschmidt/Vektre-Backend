import { Injectable } from '@nestjs/common';
import { AppDataService } from '../../integrations/app-data.service.js';
import { requireProjectRole } from '../../projects/project-access.js';
import { UiContextIndexRepository } from '../indexer/ui-context-index.repository.js';
import { UiContextRepository } from '../repositories/ui-context.repository.js';
import { GenerationCostService } from '../../generative-model/cost/generation-cost.service.js';

export interface UiAgentAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  count: number;
  blockingProduct: boolean;
}

export interface UiAgentOperationsSnapshot {
  projectId: string;
  stalledStages: Array<{
    runId: string;
    stageExecutionId: string;
    stage: string;
    status: string;
    stalledMs: number;
  }>;
  indexLag: Array<{
    documentId: string;
    documentKey: string;
    status: string;
    indexLagMs: number | null;
  }>;
  unreconciledActivities: Array<{
    activityId: string;
    documentId?: string;
    activityType: string;
  }>;
  providerErrors: Array<{ errorCategory: string; eventCount: number }>;
  quality: Array<{
    metricKind: string;
    documentKind?: string;
    modelPresetId?: string;
    promptVersion?: string;
    eventCount: number;
    avgValue: number;
  }>;
  costs: Awaited<ReturnType<GenerationCostService['getProjectCostSummary']>>;
  alerts: UiAgentAlert[];
}

@Injectable()
export class UiAgentOperationsService {
  constructor(
    private readonly appData: AppDataService,
    private readonly context: UiContextRepository,
    private readonly index: UiContextIndexRepository,
    private readonly costs: GenerationCostService,
  ) {}

  async getSnapshot(
    userId: string,
    projectId: string,
  ): Promise<UiAgentOperationsSnapshot> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    const [
      stalledStages,
      indexLag,
      unreconciled,
      providerErrors,
      quality,
      costs,
    ] = await Promise.all([
      this.context.listStalledSteps(projectId),
      this.index.listIndexLag(projectId),
      this.appData.listUnreconciledCollaborationActivity(projectId),
      this.context.listProviderErrorRates(projectId),
      this.context.listQualityRollup(projectId),
      this.costs.getProjectCostSummary(projectId),
    ]);

    const rateLimited = providerErrors
      .filter((row) => row.errorCategory === 'rate_limited')
      .reduce((sum, row) => sum + row.eventCount, 0);
    const schemaFailures = quality.filter(
      (row) =>
        row.metricKind === 'first_pass_valid' && Number(row.avgValue) < 0.8,
    );
    const repairRegression = quality.filter(
      (row) =>
        row.metricKind === 'repair_attempts' && Number(row.avgValue) > 1,
    );
    const conflictUndo = quality.filter(
      (row) =>
        (row.metricKind === 'field_conflict' ||
          row.metricKind === 'undo_after_apply') &&
        Number(row.avgValue) > 0.25,
    );

    const alerts: UiAgentAlert[] = [];
    if (stalledStages.length > 0) {
      alerts.push({
        id: 'stalled_stages',
        severity: stalledStages.length > 5 ? 'critical' : 'warning',
        title: 'Worker/queue stalled stages',
        count: stalledStages.length,
        blockingProduct: false,
      });
    }
    if (indexLag.length > 0) {
      alerts.push({
        id: 'context_index_lag',
        severity: 'warning',
        title: 'Context index lag',
        count: indexLag.length,
        blockingProduct: false,
      });
    }
    if (rateLimited > 3) {
      alerts.push({
        id: 'provider_rate_limits',
        severity: 'warning',
        title: 'Provider error/rate-limit spike',
        count: rateLimited,
        blockingProduct: false,
      });
    }
    if (schemaFailures.length > 0) {
      alerts.push({
        id: 'schema_repair_regression',
        severity: 'warning',
        title: 'Schema/semantic validity regression',
        count: schemaFailures.length,
        blockingProduct: false,
      });
    }
    if (repairRegression.length > 0) {
      alerts.push({
        id: 'repair_rate_regression',
        severity: 'info',
        title: 'Bounded-repair rate regression',
        count: repairRegression.length,
        blockingProduct: false,
      });
    }
    if (conflictUndo.length > 0) {
      alerts.push({
        id: 'conflict_undo_rate',
        severity: 'warning',
        title: 'High conflict/undo rate',
        count: conflictUndo.length,
        blockingProduct: false,
      });
    }
    if (unreconciled.length > 0) {
      alerts.push({
        id: 'unreconciled_activities',
        severity: 'warning',
        title: 'Activities completed but not reconciled',
        count: unreconciled.length,
        blockingProduct: false,
      });
    }

    return {
      projectId,
      stalledStages,
      indexLag: indexLag.map((row) => ({
        documentId: row.documentId,
        documentKey: row.documentKey,
        status: row.status,
        indexLagMs: row.indexLagMs,
      })),
      unreconciledActivities: unreconciled.map((row) => ({
        activityId: row.activityId,
        documentId: row.documentId,
        activityType: row.activityType,
      })),
      providerErrors,
      quality: quality.map((row) => ({
        metricKind: row.metricKind,
        documentKind: row.documentKind,
        modelPresetId: row.modelPresetId,
        promptVersion: row.promptVersion,
        eventCount: row.eventCount,
        avgValue: row.avgValue,
      })),
      costs,
      alerts,
    };
  }
}
