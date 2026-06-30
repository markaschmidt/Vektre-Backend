import { ForbiddenException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ProjectsService } from './projects.service.js';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { CollaborationService } from '../collaboration/collaboration.service.js';
import type { ProjectOpJobData, ProjectOpJobName } from './models/project-op-job.model.js';

describe('ProjectsService.deleteProject', () => {
  let service: ProjectsService;
  const projectQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  const appData = {
    getProjectForUser: jest.fn(),
    resolveProjectAccessForUser: jest.fn(),
    getProjectMembership: jest.fn(),
    createRequestStatus: jest.fn().mockResolvedValue(undefined),
  };
  const collaboration = {
    listMembers: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProjectsService(
      projectQueue as unknown as Queue<ProjectOpJobData, void, ProjectOpJobName>,
      appData as unknown as AppDataService,
      collaboration as unknown as CollaborationService,
    );
  });

  it('queues deletion when the caller is the project owner', async () => {
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: {
        projectId: 'proj-1',
        ownerUserId: 'owner-1',
        name: 'Demo',
      },
    });

    const result = await service.deleteProject('owner-1', 'proj-1');

    expect(result.projectId).toBe('proj-1');
    expect(result.status).toBe('queued');
    expect(projectQueue.add).toHaveBeenCalled();
    expect(appData.getProjectMembership).not.toHaveBeenCalled();
  });

  it('rejects editors who are not the project owner', async () => {
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: {
        projectId: 'proj-1',
        ownerUserId: 'owner-1',
        name: 'Demo',
      },
    });
    appData.getProjectMembership.mockResolvedValue({
      role: 'editor',
      status: 'active',
    });

    await expect(service.deleteProject('editor-1', 'proj-1')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.deleteProject('editor-1', 'proj-1')).rejects.toThrow(
      'Only the project owner can delete this project',
    );
    expect(projectQueue.add).not.toHaveBeenCalled();
  });

  it('rejects viewers who are not the project owner', async () => {
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: {
        projectId: 'proj-1',
        ownerUserId: 'owner-1',
        name: 'Demo',
      },
    });
    appData.getProjectMembership.mockResolvedValue({
      role: 'viewer',
      status: 'active',
    });

    await expect(service.deleteProject('viewer-1', 'proj-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(projectQueue.add).not.toHaveBeenCalled();
  });
});
