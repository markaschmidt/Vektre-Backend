import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { InvitesService } from './invites.service.js';
import { CreateEmailInviteDto } from './dto/create-email-invite.dto.js';
import { CreateInviteCodeDto } from './dto/create-invite-code.dto.js';
import { JoinByCodeDto } from './dto/join-by-code.dto.js';
import { AcceptInviteDto } from './dto/accept-invite.dto.js';

@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  // ─── Email invites ────────────────────────────────────────────────────────

  /**
   * POST /projects/:projectId/invites
   * Send a targeted email invite for a project.
   * Requires editor+ role. Fires an in-app notification if the invitee already
   * has a Vektre account.
   */
  @Post('projects/:projectId/invites')
  @HttpCode(HttpStatus.CREATED)
  createEmailInvite(
    @Param('projectId') projectId: string,
    @Body() dto: CreateEmailInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.createEmailInvite(projectId, user.id, dto);
  }

  /**
   * GET /projects/:projectId/invites
   * List pending invites (email + code) for a project.
   * Requires editor+ to see results; viewers receive an empty list (200).
   */
  @Get('projects/:projectId/invites')
  listInvites(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.listInvites(projectId, user.id);
  }

  /**
   * DELETE /projects/:projectId/invites/:inviteId
   * Revoke a pending invite (email or code).
   * Requires editor+ role.
   */
  @Delete('projects/:projectId/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @Param('projectId') projectId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.invites.revokeInvite(projectId, inviteId, user.id);
  }

  /**
   * POST /invites/:inviteId/accept
   * Accept a targeted email invite.
   * The authenticated user's email must match the invited email.
   */
  @Post('invites/:inviteId/accept')
  @HttpCode(HttpStatus.OK)
  acceptEmailInvite(
    @Param('inviteId') inviteId: string,
    @Body() dto: AcceptInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.acceptEmailInvite(inviteId, user.id, dto);
  }

  // ─── Invite codes (open join-by-code) ─────────────────────────────────────

  /**
   * POST /projects/:projectId/invite-codes
   * Generate a short join code for this project (default TTL: 24 h).
   * Returns the plaintext code once — it is never stored server-side.
   * Requires editor+ role.
   */
  @Post('projects/:projectId/invite-codes')
  @HttpCode(HttpStatus.CREATED)
  createInviteCode(
    @Param('projectId') projectId: string,
    @Body() dto: CreateInviteCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.createInviteCode(projectId, user.id, dto);
  }

  /**
   * GET /invite-codes/:code
   * Preview a join code without consuming it (shows project name, role, expiry).
   * Useful for displaying a confirmation screen before the user commits to joining.
   */
  @Get('invite-codes/:code')
  previewCode(@Param('code') code: string) {
    return this.invites.previewCode(code);
  }

  /**
   * POST /invite-codes/join
   * Join a project using a plaintext invite code.
   * Marks the code as accepted, creates the project membership, and notifies
   * the inviter.
   */
  @Post('invite-codes/join')
  @HttpCode(HttpStatus.OK)
  joinByCode(
    @Body() dto: JoinByCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.joinByCode(user.id, dto);
  }
}
