import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationsRepository } from './repositories/notifications.repository.js';

const repository = {
  create: jest.fn(),
  listForUser: jest.fn(),
  unreadCount: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(repository as unknown as NotificationsRepository);
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

  it('throws not found when marking a missing notification read', async () => {
    repository.markRead.mockResolvedValue(null);

    await expect(service.markRead('user-1', 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
