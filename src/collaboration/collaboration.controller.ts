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
import { CollaborationService } from './collaboration.service.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { AcceptShareLinkDto } from './dto/accept-share-link.dto.js';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto.js';

@Controller()
export class CollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

  // ─── Share Links ──────────────────────────────────────────────────────────

  /**
   * Create a TTL invite link for a project.
   * Requires editor or owner role.
   * Returns the plaintext token once — it is never stored server-side.
   */
  @Post('projects/:projectId/share-links')
  @HttpCode(HttpStatus.CREATED)
  createShareLink(
    @Param('projectId') projectId: string,
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collaboration.createShareLink(projectId, user.id, dto);
  }

  /**
   * Preview share link metadata without consuming it.
   * Token is the raw opaque token from the invite URL.
   */
  @Get('share-links/:token')
  resolveShareLink(@Param('token') token: string) {
    return this.collaboration.resolveShareLink(token);
  }

  /**
   * Accept an invite link: validates TTL/uses, grants membership.
   */
  @Post('share-links/:token/accept')
  @HttpCode(HttpStatus.OK)
  acceptShareLink(
    @Param('token') token: string,
    @Body() dto: AcceptShareLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collaboration.acceptShareLink(token, user.id, dto);
  }

  /**
   * Revoke an invite link.
   * Requires editor or owner role.
   */
  @Delete('projects/:projectId/share-links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeShareLink(
    @Param('projectId') projectId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.collaboration.revokeShareLink(projectId, linkId, user.id);
  }

  /**
   * List active share links for a project.
   * Requires editor or owner role.
   */
  @Get('projects/:projectId/share-links')
  listShareLinks(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collaboration.listProjectShareLinks(projectId, user.id);
  }

  // ─── Members ──────────────────────────────────────────────────────────────

  /**
   * List all active members of a project.
   * Requires any active membership (viewer+).
   */
  @Get('projects/:projectId/members')
  listMembers(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collaboration.listMembers(projectId, user.id);
  }

  /**
   * Change a member's RBAC role.
   * Requires owner role to promote/demote.
   */
  @Patch('projects/:projectId/members/:memberId/role')
  changeMemberRole(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.collaboration.changeMemberRole(projectId, memberId, dto.role, user.id);
  }

  /**
   * Voluntarily leave a project.
   * Requires any active membership (viewer+). Owners cannot leave.
   */
  @Post('projects/:projectId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leaveProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.collaboration.leaveProject(projectId, user.id);
  }

  /**
   * Remove a member from a project.
   * Requires editor+ role; only owner can remove other owners.
   */
  @Delete('projects/:projectId/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.collaboration.removeMember(projectId, memberId, user.id);
  }
}
