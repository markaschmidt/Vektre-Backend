import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.model.js';
import { ProjectGenerationCostsFacade } from './project-generation-costs.facade.js';

/**
 * Project settings cost analytics.
 * Mounted under `/projects/:projectId/costs` to keep the path next to project settings
 * without importing GenerativeModelModule into ProjectsModule (avoids a cycle).
 */
@Controller('projects/:projectId/costs')
export class ProjectGenerationCostsController {
  constructor(private readonly costs: ProjectGenerationCostsFacade) {}

  /**
   * GET /projects/:projectId/costs
   * Month / year / total estimated generation spend + per-actor breakdown.
   * Actor is always the authenticated JWT user for ACL; body/query userIds are ignored.
   */
  @Get()
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.costs.getSummary(user.id, projectId);
  }
}
