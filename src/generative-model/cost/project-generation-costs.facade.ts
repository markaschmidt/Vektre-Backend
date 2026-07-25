import { Injectable, Logger } from '@nestjs/common';
import { GenerationCostService } from './generation-cost.service.js';
import { requireProjectRole } from '../../projects/project-access.js';
import { AppDataService } from '../../integrations/app-data.service.js';
import type { ProjectCostSummaryResponse } from './generation-cost.types.js';

/**
 * Thin facade for the project costs HTTP surface so ProjectsModule does not
 * need a hard import cycle with GenerativeModelModule internals.
 */
@Injectable()
export class ProjectGenerationCostsFacade {
  private readonly logger = new Logger(ProjectGenerationCostsFacade.name);

  constructor(
    private readonly costs: GenerationCostService,
    private readonly appData: AppDataService,
  ) {}

  async getSummary(
    userId: string,
    projectId: string,
  ): Promise<ProjectCostSummaryResponse> {
    await requireProjectRole(this.appData, userId, projectId, 'viewer');
    this.logger.debug(`getProjectCostSummary: ${projectId} by ${userId}`);
    return this.costs.getProjectCostSummary(projectId);
  }
}
