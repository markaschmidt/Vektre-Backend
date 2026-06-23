import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import { SupabaseService } from '../integrations/supabase.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { ProjectMemberRole, ProjectInviteRow } from '../integrations/app-data.types.js';
import {
  hasPermission,
} from '../collaboration/models/collaboration.model.js';
import type {
  CreateEmailInviteResponse,
  CreateCodeInviteResponse,
  InviteResponse,
  JoinByCodeResponse,
  AcceptEmailInviteResponse,
  InvitePreview,
} from './models/invite.model.js';
import type { CreateEmailInviteDto } from './dto/create-email-invite.dto.js';
import type { CreateInviteCodeDto } from './dto/create-invite-code.dto.js';
import type { JoinByCodeDto } from './dto/join-by-code.dto.js';
import type { AcceptInviteDto } from './dto/accept-invite.dto.js';

/** Default TTL for code-based invites: 24 hours */
const CODE_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a human-readable, URL-safe join code (e.g. "A3BX-K7MQ").
 * The returned object contains both the plaintext code and its SHA-256 hash.
 */
function generateInviteCode(): { code: string; codeHash: string } {
  const raw = randomBytes(6).toString('base64url').toUpperCase().slice(0, 8);
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const codeHash = createHash('sha256').update(code).digest('hex');
  return { code, codeHash };
}

function hashCode(plaintext: string): string {
  return createHash('sha256').update(plaintext.trim().toUpperCase()).digest('hex');
}

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Email invites ──────────────────────────────────────────────────────────

  async createEmailInvite(
    projectId: string,
    actorUserId: string,
    dto: CreateEmailInviteDto,
  ): Promise<CreateEmailInviteResponse> {
    await this.assertMembership(projectId, actorUserId, 'editor');

    const project = await this.appData.getProjectForUser(actorUserId, projectId);
    if (!project) throw new NotFoundException('Project not found');

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt <= new Date()) {
      throw new UnprocessableEntityException('expiresAt must be in the future');
    }

    // Resolve the invitee's userId if they already have a Vektre account
    const inviteeUserId =
      (await this.supabase.getUserIdByEmail(dto.email)) ?? undefined;

    // Guard: don't invite someone who is already an active member
    if (inviteeUserId) {
      const existing = await this.appData.getProjectMembership(projectId, inviteeUserId);
      if (existing?.status === 'active') {
        throw new ConflictException('That user is already a member of this project');
      }
    }

    const inviteId = `inv_${randomBytes(12).toString('hex')}`;
    const invite = await this.appData.createProjectInvite({
      inviteId,
      projectId,
      invitedByUserId: actorUserId,
      inviteType: 'email',
      roleToGrant: dto.role,
      inviteeEmail: dto.email.trim().toLowerCase(),
      inviteeUserId,
      expiresAt,
    });

    this.logger.log(`Email invite ${inviteId} created for ${dto.email} → project ${projectId}`);

    // Notify the invitee in-app only when they are already a registered user
    if (inviteeUserId) {
      await this.notifications.notifyInviteReceived({
        projectId,
        projectName: project.name,
        inviteId,
        inviteeUserId,
        actorUserId,
        role: dto.role,
      });
    }

    return toInviteResponse(invite) as CreateEmailInviteResponse;
  }

  // ─── Code invites ───────────────────────────────────────────────────────────

  async createInviteCode(
    projectId: string,
    actorUserId: string,
    dto: CreateInviteCodeDto,
  ): Promise<CreateCodeInviteResponse> {
    await this.assertMembership(projectId, actorUserId, 'editor');

    const expiresAt = dto.expiresAt
      ? new Date(dto.expiresAt)
      : new Date(Date.now() + CODE_INVITE_TTL_MS);

    if (expiresAt <= new Date()) {
      throw new UnprocessableEntityException('expiresAt must be in the future');
    }

    const { code, codeHash } = generateInviteCode();
    const inviteId = `inv_${randomBytes(12).toString('hex')}`;

    const invite = await this.appData.createProjectInvite({
      inviteId,
      projectId,
      invitedByUserId: actorUserId,
      inviteType: 'code',
      roleToGrant: dto.role,
      inviteCodeHash: codeHash,
      expiresAt,
    });

    this.logger.log(`Code invite ${inviteId} created for project ${projectId}, expires ${expiresAt.toISOString()}`);

    return {
      ...(toInviteResponse(invite) as CreateCodeInviteResponse),
      code,
    };
  }

  // ─── Join by code ───────────────────────────────────────────────────────────

  async previewCode(code: string): Promise<InvitePreview> {
    const codeHash = hashCode(code);
    const invite = await this.appData.getProjectInviteByCodeHash(codeHash);
    if (!invite || invite.inviteType !== 'code') {
      throw new NotFoundException('Invite code not found');
    }

    const project = await this.appData.getProjectById(invite.projectId);
    if (!project) throw new NotFoundException('Project not found');

    return {
      inviteId: invite.inviteId,
      projectId: invite.projectId,
      projectName: project.name,
      inviteType: invite.inviteType,
      roleToGrant: invite.roleToGrant,
      isExpired: isExpired(invite),
      expiresAt: invite.expiresAt?.toISOString(),
    };
  }

  async joinByCode(
    userId: string,
    dto: JoinByCodeDto,
  ): Promise<JoinByCodeResponse> {
    const codeHash = hashCode(dto.code);
    const invite = await this.appData.getProjectInviteByCodeHash(codeHash);

    if (!invite || invite.inviteType !== 'code' || invite.status !== 'pending') {
      throw new UnprocessableEntityException('Invite code is invalid or has already been used');
    }
    if (isExpired(invite)) {
      throw new UnprocessableEntityException('This invite code has expired');
    }

    // Guard: don't let an existing member "join" again
    const existing = await this.appData.getProjectMembership(invite.projectId, userId);
    if (existing?.status === 'active') {
      throw new ConflictException('You are already a member of this project');
    }

    const result = await this.appData.acceptProjectInvite(invite.inviteId, userId, {
      displayName: dto.displayName,
      color: dto.color,
    });
    if (!result) {
      throw new UnprocessableEntityException('Failed to accept invite — it may have just expired or been revoked');
    }

    this.logger.log(`User ${userId} joined project ${invite.projectId} via code invite ${invite.inviteId}`);

    // Notify the inviter (best-effort; never throws)
    const project = await this.appData.getProjectById(invite.projectId);
    if (project) {
      await this.notifications.notifyInviteAccepted({
        projectId: invite.projectId,
        projectName: project.name,
        inviteId: invite.inviteId,
        inviterUserId: invite.invitedByUserId,
        acceptedByUserId: userId,
        role: invite.roleToGrant,
      });
    }

    return {
      projectId: result.invite.projectId,
      role: result.invite.roleToGrant,
      membershipId: result.member.membershipId,
    };
  }

  // ─── Accept email invite ────────────────────────────────────────────────────

  async acceptEmailInvite(
    inviteId: string,
    userId: string,
    dto: AcceptInviteDto,
  ): Promise<AcceptEmailInviteResponse> {
    const invite = await this.appData.getProjectInviteById(inviteId);
    if (!invite || invite.inviteType !== 'email') {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== 'pending') {
      throw new UnprocessableEntityException('This invite has already been accepted or revoked');
    }
    if (isExpired(invite)) {
      throw new UnprocessableEntityException('This invite has expired');
    }

    // Verify the accepting user owns the email that was invited
    const inviteeUserId = await this.supabase.getUserIdByEmail(invite.inviteeEmail!);
    if (inviteeUserId !== userId) {
      throw new ForbiddenException('This invite was sent to a different email address');
    }

    const result = await this.appData.acceptProjectInvite(inviteId, userId, {
      displayName: dto.displayName,
      color: dto.color,
    });
    if (!result) {
      throw new UnprocessableEntityException('Failed to accept invite');
    }

    this.logger.log(`User ${userId} accepted email invite ${inviteId} for project ${invite.projectId}`);

    return {
      projectId: result.invite.projectId,
      role: result.invite.roleToGrant,
      membershipId: result.member.membershipId,
    };
  }

  // ─── List & revoke ──────────────────────────────────────────────────────────

  async listInvites(
    projectId: string,
    actorUserId: string,
  ): Promise<InviteResponse[]> {
    const member = await this.assertMembership(projectId, actorUserId, 'viewer');
    if (!hasPermission(member.role, 'editor')) {
      return [];
    }

    const rows = await this.appData.listProjectInvites(projectId, { status: 'pending' });
    return rows.map(toInviteResponse);
  }

  async revokeInvite(
    projectId: string,
    inviteId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.assertMembership(projectId, actorUserId, 'editor');

    const invite = await this.appData.getProjectInviteById(inviteId);
    if (!invite || invite.projectId !== projectId) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== 'pending') {
      throw new UnprocessableEntityException('Invite is already accepted or revoked');
    }

    await this.appData.revokeProjectInvite(inviteId);
    this.logger.log(`Invite ${inviteId} revoked by ${actorUserId}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async assertMembership(
    projectId: string,
    userId: string,
    minimumRole: ProjectMemberRole,
  ) {
    const member = await this.appData.getProjectMembership(projectId, userId);
    if (!member || member.status === 'removed') {
      throw new ForbiddenException('You are not a member of this project');
    }
    if (!hasPermission(member.role, minimumRole)) {
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${minimumRole}, your role: ${member.role}`,
      );
    }
    return member;
  }
}

function isExpired(invite: ProjectInviteRow): boolean {
  return !!invite.expiresAt && invite.expiresAt <= new Date();
}

function toInviteResponse(invite: ProjectInviteRow): InviteResponse {
  return {
    inviteId: invite.inviteId,
    projectId: invite.projectId,
    invitedByUserId: invite.invitedByUserId,
    inviteType: invite.inviteType,
    roleToGrant: invite.roleToGrant,
    inviteeEmail: invite.inviteeEmail,
    inviteeUserId: invite.inviteeUserId,
    status: invite.status,
    isExpired: isExpired(invite),
    expiresAt: invite.expiresAt?.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString(),
    revokedAt: invite.revokedAt?.toISOString(),
    acceptedByUserId: invite.acceptedByUserId,
    createdAt: invite.createdAt.toISOString(),
    updatedAt: invite.updatedAt.toISOString(),
  };
}
