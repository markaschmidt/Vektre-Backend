import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectMemberRole } from '../integrations/app-data.types.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { NotificationsRepository } from './repositories/notifications.repository.js';
import type { ListNotificationsDto } from './dto/list-notifications.dto.js';
import type {
  CommentNotificationInput,
  NotificationResponse,
  NotificationType,
  ProjectAccessLossReason,
  ProjectRoleChangeNotificationInput,
} from './models/notification.model.js';
import {
  notificationTypeForAccessLoss,
  projectAccessLossMetadata,
  projectMemberJoinNotifyRecipientIds,
} from './models/notification.model.js';
import {
  toNotificationActorSummary,
  toNotificationResponse,
} from './models/notification.model.js';

const ROLE_RANK: Record<ProjectMemberRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly appData: AppDataService,
  ) {}

  async listForUser(
    userId: string,
    dto: ListNotificationsDto,
  ): Promise<NotificationResponse[]> {
    const rows = await this.notifications.listForUser(userId, {
      status: dto.status ?? 'all',
      limit: dto.limit,
      before: dto.before ? new Date(dto.before) : undefined,
    });
    return this.enrichNotifications(rows);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(userId) };
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationResponse> {
    const row = await this.notifications.markRead(userId, notificationId);
    if (!row) throw new NotFoundException('Notification not found');
    const [response] = await this.enrichNotifications([row]);
    return response;
  }

  async markAllRead(userId: string): Promise<{ updatedCount: number }> {
    return { updatedCount: await this.notifications.markAllRead(userId) };
  }

  async notifyProjectInvitation(input: {
    projectId: string;
    projectName: string;
    userId: string;
    actorUserId: string;
    role: ProjectMemberRole;
  }): Promise<void> {
    if (input.userId === input.actorUserId) return;
    await this.notifications.create({
      userId: input.userId,
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      type: 'project_invitation',
      title: `You were added to ${input.projectName}`,
      body: `You now have ${input.role} access to this project.`,
      metadata: { role: input.role },
    });
  }

  async notifyProjectRemoval(input: {
    projectId: string;
    projectName: string;
    userId: string;
    actorUserId: string;
    previousRole?: ProjectMemberRole;
  }): Promise<void> {
    await this.notifyProjectAccessLost({
      ...input,
      reason: 'removed',
    });
  }

  async notifyProjectMemberLeft(input: {
    projectId: string;
    projectName: string;
    ownerUserId: string;
    actorUserId: string;
    previousRole: ProjectMemberRole;
  }): Promise<void> {
    if (input.ownerUserId === input.actorUserId) return;
    await this.notifications.create({
      userId: input.ownerUserId,
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      type: 'project_member_left',
      title: `Someone left ${input.projectName}`,
      body: `A member left the project (was ${input.previousRole}).`,
      metadata: { previousRole: input.previousRole },
    });
  }

  /**
   * Notify project owners and editors when someone joins.
   * The joiner is excluded; the project owner is always included even without a member row.
   */
  async notifyProjectMemberJoined(input: {
    projectId: string;
    projectName: string;
    joinedUserId: string;
    role: ProjectMemberRole;
    inviteId?: string;
  }): Promise<void> {
    const [project, members] = await Promise.all([
      this.appData.getProjectById(input.projectId),
      this.appData.listProjectMembers(input.projectId),
    ]);
    if (!project) return;

    const recipientIds = projectMemberJoinNotifyRecipientIds({
      ownerUserId: project.ownerUserId,
      members: members.map((member) => ({
        userId: member.userId,
        role: member.role,
      })),
      joinedUserId: input.joinedUserId,
    });
    if (recipientIds.length === 0) return;

    await Promise.all(
      recipientIds.map((userId) =>
        this.notifications.create({
          userId,
          actorUserId: input.joinedUserId,
          projectId: input.projectId,
          type: 'project_member_joined',
          title: `Someone joined ${input.projectName}`,
          body: `A new member joined as ${input.role}.`,
          metadata: {
            role: input.role,
            ...(input.inviteId ? { inviteId: input.inviteId } : {}),
          },
        }),
      ),
    );
  }

  /**
   * Notify every former member that the project was deleted.
   * Notifications are persisted in Postgres and delivered on next login.
   */
  async notifyProjectDeleted(input: {
    projectId: string;
    projectName: string;
    actorUserId: string;
    members: Array<{ userId: string; role: ProjectMemberRole }>;
  }): Promise<void> {
    const recipients = input.members.filter((m) => m.userId !== input.actorUserId);
    if (recipients.length === 0) return;

    await Promise.all(
      recipients.map((member) =>
        this.notifyProjectAccessLost({
          projectId: input.projectId,
          projectName: input.projectName,
          userId: member.userId,
          actorUserId: input.actorUserId,
          reason: 'deleted',
          previousRole: member.role,
        }),
      ),
    );
  }

  /**
   * Persist an access-loss notification for a single user. Fires when a member is
   * removed or when the owner deletes the project. Delivered via GET /notifications
   * even if the user is offline at the time of the event.
   */
  async notifyProjectAccessLost(input: {
    projectId: string;
    projectName: string;
    userId: string;
    actorUserId: string;
    reason: ProjectAccessLossReason;
    previousRole?: ProjectMemberRole;
  }): Promise<void> {
    if (input.userId === input.actorUserId) return;

    const copy = ACCESS_LOSS_COPY[input.reason];
    await this.notifications.create({
      userId: input.userId,
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      type: notificationTypeForAccessLoss(input.reason),
      title: copy.title(input.projectName),
      body: copy.body,
      metadata: projectAccessLossMetadata({
        reason: input.reason,
        previousRole: input.previousRole,
      }),
    });
  }

  async notifyProjectRoleChange(
    input: ProjectRoleChangeNotificationInput,
  ): Promise<void> {
    if (input.userId === input.actorUserId) return;
    if (!input.previousRole || input.previousRole === input.newRole) return;

    const type = roleChangeType(input.previousRole, input.newRole);
    await this.notifications.create({
      userId: input.userId,
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      type,
      title: roleChangeTitle(type, input.projectName),
      body: `Your role changed from ${input.previousRole} to ${input.newRole}.`,
      metadata: {
        previousRole: input.previousRole,
        newRole: input.newRole,
      },
    });
  }

  /**
   * Notify a user that they have been invited to a project by email.
   * Only fires when the invitee already has a Vektre account (userId is known).
   */
  async notifyInviteReceived(input: {
    projectId: string;
    projectName: string;
    inviteId: string;
    inviteeUserId: string;
    actorUserId: string;
    role: ProjectMemberRole;
  }): Promise<void> {
    if (input.inviteeUserId === input.actorUserId) return;
    await this.notifications.create({
      userId: input.inviteeUserId,
      actorUserId: input.actorUserId,
      projectId: input.projectId,
      type: 'invite_received',
      title: `You've been invited to ${input.projectName}`,
      body: `You have been invited as ${input.role}. Open the app to accept or decline.`,
      metadata: { inviteId: input.inviteId, role: input.role },
    });
  }

  /**
   * Notify the inviter when someone accepts their code invite.
   */
  async notifyInviteAccepted(input: {
    projectId: string;
    projectName: string;
    inviteId: string;
    inviterUserId: string;
    acceptedByUserId: string;
    role: ProjectMemberRole;
  }): Promise<void> {
    if (input.inviterUserId === input.acceptedByUserId) return;
    await this.notifications.create({
      userId: input.inviterUserId,
      actorUserId: input.acceptedByUserId,
      projectId: input.projectId,
      type: 'invite_accepted',
      title: `Someone joined ${input.projectName}`,
      body: `A new member joined as ${input.role} via your invite.`,
      metadata: { inviteId: input.inviteId, role: input.role },
    });
  }

  async notifyCommentMention(input: CommentNotificationInput): Promise<void> {
    if (input.recipientUserId === input.authorUserId) return;
    await this.createCommentNotification('comment_mention', input);
  }

  async notifyCommentReply(input: CommentNotificationInput): Promise<void> {
    if (input.recipientUserId === input.authorUserId) return;
    await this.createCommentNotification('comment_reply', input);
  }

  private async enrichNotifications(
    rows: Awaited<ReturnType<NotificationsRepository['listForUser']>>,
  ): Promise<NotificationResponse[]> {
    const actorIds = rows
      .map((row) => row.actorUserId)
      .filter((id): id is string => Boolean(id));
    const profiles = await this.appData.getUserProfilesByIds(actorIds);

    return rows.map((row) => {
      const actor = row.actorUserId
        ? toNotificationActorSummary(row.actorUserId, profiles.get(row.actorUserId))
        : undefined;
      return toNotificationResponse(row, actor);
    });
  }

  private async createCommentNotification(
    type: Extract<NotificationType, 'comment_mention' | 'comment_reply'>,
    input: CommentNotificationInput,
  ): Promise<void> {
    await this.notifications.create({
      userId: input.recipientUserId,
      actorUserId: input.authorUserId,
      projectId: input.projectId,
      assetId: input.targetType === 'asset' ? input.targetId : undefined,
      documentId: input.targetType === 'document' ? input.targetId : undefined,
      commentId: input.commentId,
      parentCommentId: input.parentCommentId,
      type,
      title:
        type === 'comment_mention'
          ? 'You were mentioned in a comment'
          : 'Someone replied to your comment',
      body: excerpt(input.body),
      metadata: {
        targetType: input.targetType,
        targetId: input.targetId,
      },
    });
  }
}

function roleChangeType(
  previousRole: ProjectMemberRole,
  newRole: ProjectMemberRole,
): Extract<
  NotificationType,
  'project_role_promoted' | 'project_role_demoted' | 'project_role_changed'
> {
  if (ROLE_RANK[newRole] > ROLE_RANK[previousRole]) return 'project_role_promoted';
  if (ROLE_RANK[newRole] < ROLE_RANK[previousRole]) return 'project_role_demoted';
  return 'project_role_changed';
}

function roleChangeTitle(type: NotificationType, projectName: string): string {
  switch (type) {
    case 'project_role_promoted':
      return `Your role was promoted in ${projectName}`;
    case 'project_role_demoted':
      return `Your role was changed in ${projectName}`;
    default:
      return `Your project role changed in ${projectName}`;
  }
}

function excerpt(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 237)}...`;
}

const ACCESS_LOSS_COPY: Record<
  ProjectAccessLossReason,
  { title: (projectName: string) => string; body: string }
> = {
  removed: {
    title: (projectName) => `You were removed from ${projectName}`,
    body: 'You no longer have access to this project.',
  },
  deleted: {
    title: (projectName) => `${projectName} was deleted`,
    body: 'This project is no longer available.',
  },
};
