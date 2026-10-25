import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.model.js';
import type { OrganizationProvider } from '../../integrations/app-data.types.js';
import {
  ExchangeOrganizationOAuthDto,
  UpsertGitLfsIntegrationDto,
  UpsertPerforceIntegrationDto,
} from '../dto/organization.dto.js';
import { ORGANIZATION_PROVIDERS } from '../models/organization.model.js';
import { OrgIntegrationsService } from './org-integrations.service.js';

@Controller('organizations/:organizationId/integrations')
export class OrgIntegrationsController {
  constructor(private readonly integrations: OrgIntegrationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ) {
    return this.integrations.list(user.id, organizationId);
  }

  @Post('github/oauth/exchange')
  exchangeGitHub(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: ExchangeOrganizationOAuthDto,
  ) {
    return this.integrations.exchangeGitHub(user.id, organizationId, dto);
  }

  @Post('figma/oauth/exchange')
  exchangeFigma(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: ExchangeOrganizationOAuthDto,
  ) {
    return this.integrations.exchangeFigma(user.id, organizationId, dto);
  }

  @Put('perforce')
  upsertPerforce(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpsertPerforceIntegrationDto,
  ) {
    return this.integrations.upsertPerforce(user.id, organizationId, dto);
  }

  @Put('git-lfs')
  upsertGitLfs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpsertGitLfsIntegrationDto,
  ) {
    return this.integrations.upsertGitLfs(user.id, organizationId, dto);
  }

  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('provider') provider: string,
  ) {
    return this.integrations.disconnect(
      user.id,
      organizationId,
      parseProvider(provider),
    );
  }

  @Post(':provider/validate')
  @HttpCode(HttpStatus.ACCEPTED)
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('provider') provider: string,
  ) {
    return this.integrations.enqueueValidation(
      user.id,
      organizationId,
      parseProvider(provider),
    );
  }

  @Get('requests/:requestId')
  getValidationStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.integrations.getValidationStatus(
      user.id,
      organizationId,
      requestId,
    );
  }

  @Get('github/repositories')
  listGitHubRepositories(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ) {
    return this.integrations.listGitHubRepositories(user.id, organizationId);
  }

  @Get('figma/teams/:teamId/projects')
  listFigmaTeamProjects(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.integrations.listFigmaTeamProjects(
      user.id,
      organizationId,
      teamId,
    );
  }

  @Get('figma/projects/:projectId/files')
  listFigmaProjectFiles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.integrations.listFigmaProjectFiles(
      user.id,
      organizationId,
      projectId,
    );
  }
}

function parseProvider(value: string): OrganizationProvider {
  if (!ORGANIZATION_PROVIDERS.includes(value as OrganizationProvider)) {
    throw new BadRequestException(
      'Unsupported organization integration provider',
    );
  }
  return value as OrganizationProvider;
}
