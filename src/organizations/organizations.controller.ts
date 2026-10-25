import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import {
  AddOrganizationMemberDto,
  CreateOrganizationDto,
  UpdateOrganizationDto,
  UpdateOrganizationMemberDto,
  UploadOrganizationLogoDto,
} from './dto/organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizations.create(user.id, dto);
  }

  @Get('me')
  listForUser(@CurrentUser() user: AuthenticatedUser) {
    return this.organizations.listForUser(user.id);
  }

  /**
   * Stage a logo before org create (onboarding). Same payload shape as
   * POST /organizations/:organizationId/logo.
   */
  @Post('logo/upload')
  @HttpCode(HttpStatus.CREATED)
  uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadOrganizationLogoDto,
  ) {
    return this.organizations.uploadLogo(user.id, dto);
  }

  @Get(':organizationId')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ) {
    return this.organizations.getForUser(user.id, organizationId);
  }

  @Patch(':organizationId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizations.update(user.id, organizationId, dto);
  }

  @Post(':organizationId/logo')
  @HttpCode(HttpStatus.CREATED)
  uploadLogoForOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: UploadOrganizationLogoDto,
  ) {
    return this.organizations.uploadLogoForOrganization(
      user.id,
      organizationId,
      dto,
    );
  }

  @Post(':organizationId/members')
  @HttpCode(HttpStatus.CREATED)
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: AddOrganizationMemberDto,
  ) {
    return this.organizations.addMember(user.id, organizationId, dto);
  }

  @Patch(':organizationId/members/:memberUserId')
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('memberUserId') memberUserId: string,
    @Body() dto: UpdateOrganizationMemberDto,
  ) {
    return this.organizations.updateMember(
      user.id,
      organizationId,
      memberUserId,
      dto,
    );
  }

  @Delete(':organizationId/members/:memberUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Param('memberUserId') memberUserId: string,
  ) {
    return this.organizations.removeMember(
      user.id,
      organizationId,
      memberUserId,
    );
  }
}
