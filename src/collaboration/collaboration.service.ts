import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import { SupabaseService } from '../integrations/supabase.js';
import type {
  ProjectMemberRole,
  ShareLinkRole,
  ShareLinkRow,
  ProjectMemberRow,
  UserProfileRow,
} from '../integrations/app-data.types.js';
import { buildDisplayName } from '../user/user-profile.helpers.js';
import type { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import type { AcceptShareLinkDto } from './dto/accept-share-link.dto.js';
import {
  hasPermission,
  type ShareLinkResponse,
  type MemberResponse,
  type AcceptShareLinkResponse,
} from './models/collaboration.model.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Share Links ──────────────────────────────────────────────────────────

  async createShareLink(
    projectId: string,
    requestingUserId: string,
    dto: CreateShareLinkDto,
  ): Promise<ShareLinkResponse> {
    await this.assertMembership(projectId, requestingUserId, 'editor');

    const expiresAt = new Date(dto.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      throw new UnprocessableEntityException('expiresAt must be a future ISO-8601 timestamp');
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const linkId = `lnk_${randomBytes(12).toString('hex')}`;

    const link = await this.appData.createShareLink({
      linkId,
      projectId,
      tokenHash,
      roleToGrant: dto.roleToGrant,
      createdByUserId: requestingUserId,
      expiresAt,
      maxUses: dto.maxUses,
    });

    this.logger.log(`Share link created: ${linkId} for project ${projectId}`);

    return {
      ...toShareLinkResponse(link),
      // Return the plaintext token once on creation. Never stored.
      linkId: `${link.linkId}::${rawToken}`,
    };
  }

  async resolveShareLink(token: string): Promise<ShareLinkResponse> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const link = await this.appData.getShareLinkByHash(tokenHash);
    if (!link) {
      throw new NotFoundException('Share link not found');
    }
    return toShareLinkResponse(link);
  }

  async acceptShareLink(
    token: string,
    consumingUserId: string,
    dto: AcceptShareLinkDto,
  ): Promise<AcceptShareLinkResponse> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.appData.consumeShareLink(tokenHash, consumingUserId, dto);

    if (!result) {
      throw new UnprocessableEntityException(
        'Share link is invalid, expired, revoked, or usage limit reached',
      );
    }

    this.logger.log(
      `Share link consumed by ${consumingUserId} → project ${result.link.projectId} as ${result.link.roleToGrant}`,
    );

    return {
      member: await this.enrichMember(result.member),
      projectId: result.link.projectId,
      role: result.link.roleToGrant,
    };
  }

  async revokeShareLink(
    projectId: string,
    linkId: string,
    requestingUserId: string,
  ): Promise<void> {
    await this.assertMembership(projectId, requestingUserId, 'editor');

    const link = await this.appData.getShareLinkById(linkId);
    if (!link || link.projectId !== projectId) {
      throw new NotFoundException('Share link not found');
    }

    await this.appData.revokeShareLink(linkId);
    this.logger.log(`Share link revoked: ${linkId}`);
  }

  async listProjectShareLinks(
    projectId: string,
    requestingUserId: string,
  ): Promise<ShareLinkResponse[]> {
    await this.assertMembership(projectId, requestingUserId, 'editor');
    const links = await this.appData.listProjectShareLinks(projectId);
    return links.map(toShareLinkResponse);
  }

  // ─── Members ──────────────────────────────────────────────────────────────

  async listMembers(
    projectId: string,
    requestingUserId: string,
  ): Promise<MemberResponse[]> {
    await this.assertMembership(projectId, requestingUserId, 'viewer');
    const members = await this.appData.listProjectMembers(projectId);
    return this.enrichMembers(members);
  }

  async changeMemberRole(
    projectId: string,
    targetUserId: string,
    newRole: ProjectMemberRole,
    requestingUserId: string,
  ): Promise<MemberResponse> {
    const requestor = await this.assertMembership(projectId, requestingUserId, 'owner');

    if (targetUserId === requestingUserId) {
      throw new ForbiddenException('Cannot change your own role');
    }

    const target = await this.appData.getProjectMembership(projectId, targetUserId);
    if (!target || target.status === 'removed') {
      throw new NotFoundException('Member not found');
    }

    if (target.role === 'owner') {
      throw new ForbiddenException('Cannot change ownership via this endpoint');
    }

    if (newRole === 'owner' && requestor.role !== 'owner') {
      throw new ForbiddenException('Only owners can grant owner role');
    }

    const updated = await this.appData.changeMemberRole(projectId, targetUserId, newRole);
    if (!updated) throw new NotFoundException('Member not found');

    const project = await this.appData.getProjectForUser(requestingUserId, projectId);
    if (project) {
      await this.notifications.notifyProjectRoleChange({
        projectId,
        projectName: project.name,
        userId: targetUserId,
        actorUserId: requestingUserId,
        previousRole: target.role,
        newRole: updated.role,
      });
    }

    return this.enrichMember(updated);
  }

  async removeMember(
    projectId: string,
    targetUserId: string,
    requestingUserId: string,
  ): Promise<void> {
    const requestor = await this.assertMembership(projectId, requestingUserId, 'editor');

    if (targetUserId === requestingUserId) {
      throw new ForbiddenException('Use the leave endpoint to remove yourself');
    }

    const target = await this.appData.getProjectMembership(projectId, targetUserId);
    if (!target || target.status === 'removed') {
      throw new NotFoundException('Member not found');
    }

    if (target.role === 'owner' && requestor.role !== 'owner') {
      throw new ForbiddenException('Only owners can remove other owners');
    }

    await this.appData.removeProjectMember(projectId, targetUserId);
    const project = await this.appData.getProjectForUser(requestingUserId, projectId);
    if (project) {
      await this.notifications.notifyProjectRemoval({
        projectId,
        projectName: project.name,
        userId: targetUserId,
        actorUserId: requestingUserId,
        previousRole: target.role,
      });
    }
    this.logger.log(`Removed member ${targetUserId} from project ${projectId}`);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private async enrichMembers(members: ProjectMemberRow[]): Promise<MemberResponse[]> {
    const userIds = members.map((member) => member.userId);
    const [profiles, emails] = await Promise.all([
      this.appData.getUserProfilesByIds(userIds),
      this.supabase.getUserEmailsByIds(userIds),
    ]);

    return members.map((member) =>
      toMemberResponse(
        member,
        profiles.get(member.userId),
        emails.get(member.userId),
      ),
    );
  }

  private async enrichMember(member: ProjectMemberRow): Promise<MemberResponse> {
    const [profiles, emails] = await Promise.all([
      this.appData.getUserProfilesByIds([member.userId]),
      this.supabase.getUserEmailsByIds([member.userId]),
    ]);
    return toMemberResponse(
      member,
      profiles.get(member.userId),
      emails.get(member.userId),
    );
  }

  private async assertMembership(
    projectId: string,
    userId: string,
    minimumRole: ProjectMemberRole,
  ): Promise<ProjectMemberRow> {
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

function toShareLinkResponse(link: ShareLinkRow): ShareLinkResponse {
  return {
    linkId: link.linkId,
    projectId: link.projectId,
    roleToGrant: link.roleToGrant,
    createdByUserId: link.createdByUserId,
    expiresAt: link.expiresAt.toISOString(),
    maxUses: link.maxUses,
    useCount: link.useCount,
    isExpired: link.expiresAt <= new Date(),
    isRevoked: !!link.revokedAt,
    createdAt: link.createdAt.toISOString(),
  };
}

function toMemberResponse(
  member: ProjectMemberRow,
  profile?: UserProfileRow | null,
  email?: string,
): MemberResponse {
  const displayName = buildDisplayName(
    member.displayName,
    profile?.preferences?.firstName,
    profile?.preferences?.lastName,
    profile?.displayName ?? undefined,
  );

  return {
    membershipId: member.membershipId,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    ...(displayName ? { displayName } : {}),
    ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    ...(email ? { email } : {}),
    color: member.color,
    addedByUserId: member.addedByUserId,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}
