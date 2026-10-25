import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.model.js';
import { UiAgentOperationsService } from './ui-agent-operations.service.js';

@Controller('projects/:projectId/ui-agent')
export class UiAgentOperationsController {
  constructor(private readonly operations: UiAgentOperationsService) {}

  @Get('operations')
  getOperations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.operations.getSnapshot(user.id, projectId);
  }
}
