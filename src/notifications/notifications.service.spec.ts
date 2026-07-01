import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsRepository } from './repositories/notifications.repository.js';
import type { AppDataService } from '../integrations/app-data.service.js';

const repository = {
  create: jest.fn(),
  listForUser: jest.fn(),
  unreadCount: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
};

const appData = {
  getUserProfilesByIds: jest.fn(),
  getProjectById: jest.fn(),
  listProjectMembers: jest.fn(),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    appData.getUserProfilesByIds.mockResolvedValue(new Map());
    service = new NotificationsService(
      repository as unknown as NotificationsRepository,
      appData as unknown as AppDataService,
    );
  });

  it('creates promotion notifications for upward project role changes', async () => {
    repository.create.mockResolvedValue({});

    await service.notifyProjectRoleChange({
      projectId: 'proj-1',
      projectName: 'Adventure',
      userId: 'user-2',
      actorUserId: 'user-1',
      previousRole: 'viewer',
      newRole: 'editor',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        actorUserId: 'user-1',
        projectId: 'proj-1',
        type: 'project_role_promoted',
        metadata: { previousRole: 'viewer', newRole: 'editor' },
      }),
    );
  });

  it('creates demotion notifications for downward project role changes', async () => {
    repository.create.mockResolvedValue({});

    await service.notifyProjectRoleChange({
      projectId: 'proj-1',
      projectName: 'Adventure',
      userId: 'user-2',
      actorUserId: 'user-1',
      previousRole: 'editor',
      newRole: 'viewer',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project_role_demoted' }),
    );
  });

  it('does not notify users about their own action', async () => {
    await service.notifyProjectInvitation({
      projectId: 'proj-1',
      projectName: 'Adventure',
      userId: 'user-1',
      actorUserId: 'user-1',
      role: 'editor',
    });

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('notifies every member except the deleter when a project is deleted', async () => {
    repository.create.mockResolvedValue({});

    await service.notifyProjectDeleted({
      projectId: 'proj-1',
      projectName: 'Adventure',
      actorUserId: 'owner-1',
      members: [
        { userId: 'owner-1', role: 'owner' },
        { userId: 'editor-1', role: 'editor' },
        { userId: 'viewer-1', role: 'viewer' },
      ],
    });

    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'editor-1',
        type: 'project_deleted',
        title: 'Adventure was deleted',
        metadata: { reason: 'deleted', previousRole: 'editor' },
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'viewer-1',
        type: 'project_deleted',
        metadata: { reason: 'deleted', previousRole: 'viewer' },
      }),
    );
  });

  it('creates removed access-loss notifications with shared metadata', async () => {
    repository.create.mockResolvedValue({});

    await service.notifyProjectRemoval({
      projectId: 'proj-1',
      projectName: 'Adventure',
      userId: 'user-2',
      actorUserId: 'owner-1',
      previousRole: 'viewer',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project_removed',
        metadata: { reason: 'removed', previousRole: 'viewer' },
      }),
    );
  });

  it('notifies owners and editors when someone joins a project', async () => {
    repository.create.mockResolvedValue({});
    appData.getProjectById.mockResolvedValue({
      projectId: 'proj-1',
      name: 'Adventure',
      ownerUserId: 'owner-1',
    });
    appData.listProjectMembers.mockResolvedValue([
      { userId: 'owner-1', role: 'owner' },
      { userId: 'editor-1', role: 'editor' },
      { userId: 'viewer-1', role: 'viewer' },
      { userId: 'new-user', role: 'viewer' },
    ]);

    await service.notifyProjectMemberJoined({
      projectId: 'proj-1',
      projectName: 'Adventure',
      joinedUserId: 'new-user',
      role: 'viewer',
      inviteId: 'inv_123',
    });

    expect(repository.create).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        actorUserId: 'new-user',
        type: 'project_member_joined',
        metadata: { role: 'viewer', inviteId: 'inv_123' },
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'editor-1',
        type: 'project_member_joined',
      }),
    );
  });

  it('throws not found when marking a missing notification read', async () => {
    repository.markRead.mockResolvedValue(null);

    await expect(service.markRead('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('includes actor display name and avatar when listing notifications', async () => {
    const createdAt = new Date('2026-06-01T12:00:00.000Z');
    repository.listForUser.mockResolvedValue([
      {
        notificationId: 'ntf-1',
        userId: 'user-2',
        type: 'project_invitation',
        actorUserId: 'user-1',
        projectId: 'proj-1',
        title: 'You were added to Adventure',
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    appData.getUserProfilesByIds.mockResolvedValue(
      new Map([
        [
          'user-1',
          {
            userId: 'user-1',
            displayName: 'Alice Example',
            avatarUrl: 'https://example.com/alice.png',
            preferences: {},
            onDemand: { monthlyCap: null },
            createdAt,
            updatedAt: createdAt,
          },
        ],
      ]),
    );

    const result = await service.listForUser('user-2', {});

    expect(appData.getUserProfilesByIds).toHaveBeenCalledWith(['user-1']);
    expect(result[0]?.actor).toEqual({
      userId: 'user-1',
      displayName: 'Alice Example',
      avatarUrl: 'https://example.com/alice.png',
    });
  });

  it('builds actor display name from profile first and last name', async () => {
    const createdAt = new Date('2026-06-01T12:00:00.000Z');
    repository.listForUser.mockResolvedValue([
      {
        notificationId: 'ntf-1',
        userId: 'user-2',
        type: 'comment_reply',
        actorUserId: 'user-1',
        projectId: 'proj-1',
        title: 'Someone replied to your comment',
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    appData.getUserProfilesByIds.mockResolvedValue(
      new Map([
        [
          'user-1',
          {
            userId: 'user-1',
            preferences: { firstName: 'Alice', lastName: 'Example' },
            onDemand: { monthlyCap: null },
            createdAt,
            updatedAt: createdAt,
          },
        ],
      ]),
    );

    const result = await service.listForUser('user-2', {});

    expect(result[0]?.actor).toEqual({
      userId: 'user-1',
      displayName: 'Alice Example',
    });
  });
});
