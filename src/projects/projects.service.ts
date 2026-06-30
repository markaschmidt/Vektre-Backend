import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import {
  JOB_PROJECT_ARCHIVE,
  JOB_PROJECT_ASSET_REMOVE,
  JOB_PROJECT_ASSET_UPSERT,
  JOB_PROJECT_CREATE,
  JOB_PROJECT_DELETE,
  JOB_PROJECT_MEMBER_REMOVE,
  JOB_PROJECT_MEMBER_UPSERT,
  JOB_PROJECT_UPDATE,
  PROJECT_OPS_QUEUE,
} from '../queues/queue-names.js';
import { bullJobId } from '../queues/bull-job-id.js';
import { defaultJobOptions } from '../queues/job-options.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { CollaborationService } from '../collaboration/collaboration.service.js';
import { requireProjectAccess } from './project-access.js';
import type {
  ProjectMemberRole,
  ProjectWorkspaceMode,
} from '../integrations/app-data.types.js';
import type {
  CreateProjectDto,
  UpdateProjectDto,
  UpsertProjectAssetDto,
  UpsertProjectMemberDto,
  UpdateProjectMemberDto,
} from './dto/project.dto.js';
import type {
  ArchiveProjectJob,
  CreateProjectJob,
  DeleteProjectJob,
  ProjectOpJobData,
  ProjectOpJobName,
  RemoveProjectAssetJob,
  RemoveProjectMemberJob,
  UpdateProjectJob,
  UpsertProjectAssetJob,
  UpsertProjectMemberJob,
} from './models/project-op-job.model.js';

type QueuedProjectOperation = {
  requestId: string;
  projectId: string;
  status: 'queued';
};

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @InjectQueue(PROJECT_OPS_QUEUE)
    private readonly projectQueue: Queue<ProjectOpJobData, void, ProjectOpJobName>,
    private readonly appData: AppDataService,
    private readonly collaboration: CollaborationService,
  ) {}

  async listProjects(userId: string) {
    return this.appData.listProjectsForUser(userId);
  }

  async getProject(userId: string, projectId: string) {
    return requireProjectAccess(this.appData, userId, projectId);
  }

  async createProject(
    userId: string,
    dto: CreateProjectDto,
  ): Promise<QueuedProjectOperation> {
    this.assertName(dto.name, 'Project name is required');
    const workspaceMode = this.normalizeWorkspaceMode(dto.workspaceMode);
    const projectId = this.resolveProjectId(dto.projectId);

    const existing = await this.appData.getProjectForUser(userId, projectId);
    if (existing) {
      const requestId = randomUUID();
      return { requestId, projectId, status: 'queued' };
    }

    const requestId = randomUUID();
    const payload: CreateProjectJob = {
      requestId,
      actorUserId: userId,
      projectId,
      ownerUserId: userId,
      name: dto.name,
      description: dto.description,
      workspaceMode,
      iconAssetId: dto.iconAssetId,
      metadata: dto.metadata,
    };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_CREATE,
      payload,
      bullJobId('project', projectId, 'create'),
    );

    return { requestId, projectId, status: 'queued' };
  }

  async updateProject(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<QueuedProjectOperation> {
    await this.assertCanEditProject(userId, projectId);
    if (dto.name !== undefined) this.assertName(dto.name, 'Project name is required');
    if (dto.workspaceMode !== undefined) {
      dto.workspaceMode = this.normalizeWorkspaceMode(dto.workspaceMode);
    }

    const requestId = randomUUID();
    const payload: UpdateProjectJob = {
      requestId,
      actorUserId: userId,
      projectId,
      name: dto.name,
      description: dto.description,
      workspaceMode: dto.workspaceMode,
      iconAssetId: dto.iconAssetId,
      metadata: dto.metadata,
    };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_UPDATE,
      payload,
      bullJobId('project', projectId, 'update', requestId),
    );

    return { requestId, projectId, status: 'queued' };
  }

  async archiveProject(
    userId: string,
    projectId: string,
  ): Promise<QueuedProjectOperation> {
    await this.assertCanManageProject(userId, projectId);
    const requestId = randomUUID();
    const payload: ArchiveProjectJob = { requestId, actorUserId: userId, projectId };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_ARCHIVE,
      payload,
      bullJobId('project', projectId, 'archive', requestId),
    );

    return { requestId, projectId, status: 'queued' };
  }

  async deleteProject(
    userId: string,
    projectId: string,
  ): Promise<QueuedProjectOperation> {
    await this.assertProjectOwner(userId, projectId);
    const requestId = randomUUID();
    const payload: DeleteProjectJob = { requestId, actorUserId: userId, projectId };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_DELETE,
      payload,
      bullJobId('project', projectId, 'delete', requestId),
    );

    return { requestId, projectId, status: 'queued' };
  }

  async listMembers(userId: string, projectId: string) {
    return this.collaboration.listMembers(projectId, userId);
  }

  async addMember(
    userId: string,
    projectId: string,
    dto: UpsertProjectMemberDto,
  ): Promise<QueuedProjectOperation> {
    await this.assertCanManageProject(userId, projectId);
    this.assertUserId(dto.userId);
    const role = this.normalizeRole(dto.role);
    if (role === 'owner') {
      throw new BadRequestException('Use ownership transfer for owner changes');
    }

    const requestId = randomUUID();
    const payload: UpsertProjectMemberJob = {
      requestId,
      actorUserId: userId,
      projectId,
      memberUserId: dto.userId,
      role,
    };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_MEMBER_UPSERT,
      payload,
      bullJobId('project', projectId, 'member', dto.userId, 'upsert'),
    );

    return { requestId, projectId, status: 'queued' };
  }

  async updateMember(
    userId: string,
    projectId: string,
    memberUserId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<QueuedProjectOperation> {
    await this.assertCanManageProject(userId, projectId);
    this.assertUserId(memberUserId);
    const role = this.normalizeRole(dto.role);
    if (role === 'owner') {
      throw new BadRequestException('Use ownership transfer for owner changes');
    }

    const requestId = randomUUID();
    const payload: UpsertProjectMemberJob = {
      requestId,
      actorUserId: userId,
      projectId,
      memberUserId,
      role,
    };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_MEMBER_UPSERT,
      payload,
      bullJobId('project', projectId, 'member', memberUserId, 'update', requestId),
    );

    return { requestId, projectId, status: 'queued' };
  }

  async removeMember(
    userId: string,
    projectId: string,
    memberUserId: string,
  ): Promise<QueuedProjectOperation> {
    await this.assertCanManageProject(userId, projectId);
    this.assertUserId(memberUserId);
    const project = await this.appData.getProjectForUser(userId, projectId);
    if (project?.ownerUserId === memberUserId) {
      throw new BadRequestException('Project owner cannot be removed');
    }

    const requestId = randomUUID();
    const payload: RemoveProjectMemberJob = {
      requestId,
      actorUserId: userId,
      projectId,
      memberUserId,
    };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_MEMBER_REMOVE,
      payload,
      bullJobId('project', projectId, 'member', memberUserId, 'remove', requestId),
    );

    return { requestId, projectId, status: 'queued' };
  }

  async listAssets(userId: string, projectId: string) {
    await this.assertCanReadProject(userId, projectId);
    return this.appData.listProjectAssets(projectId);
  }

  async upsertAsset(
    userId: string,
    projectId: string,
    dto: UpsertProjectAssetDto,
  ): Promise<QueuedProjectOperation & { assetId: string }> {
    await this.assertCanEditProject(userId, projectId);
    this.assertName(dto.name, 'Asset name is required');

    const assetId = dto.assetId ?? randomUUID();
    const storageRef = dto.storageRef ?? `supabase://project-assets/projects/${projectId}/assets/${assetId}/${dto.name}`;
    const requestId = randomUUID();
    const payload: UpsertProjectAssetJob = {
      requestId,
      actorUserId: userId,
      projectId,
      assetId,
      assetType: dto.assetType,
      name: dto.name,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      storageRef,
      checksum: dto.checksum,
      metadata: dto.metadata,
    };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_ASSET_UPSERT,
      payload,
      bullJobId('project', projectId, 'asset', assetId, 'upsert', requestId),
    );

    return { requestId, projectId, assetId, status: 'queued' };
  }

  async removeAsset(
    userId: string,
    projectId: string,
    assetId: string,
  ): Promise<QueuedProjectOperation & { assetId: string }> {
    await this.assertCanEditProject(userId, projectId);
    this.assertUserId(assetId);

    const requestId = randomUUID();
    const payload: RemoveProjectAssetJob = {
      requestId,
      actorUserId: userId,
      projectId,
      assetId,
    };

    await this.enqueueProjectJob(
      requestId,
      userId,
      JOB_PROJECT_ASSET_REMOVE,
      payload,
      bullJobId('project', projectId, 'asset', assetId, 'remove', requestId),
    );

    return { requestId, projectId, assetId, status: 'queued' };
  }

  private async enqueueProjectJob<T extends ProjectOpJobData>(
    requestId: string,
    userId: string,
    name: ProjectOpJobName,
    payload: T,
    jobId: string,
  ): Promise<void> {
    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: name,
      status: 'queued',
      outputRef: `project:${payload.projectId}`,
    });

    await this.projectQueue.add(name, payload, {
      ...defaultJobOptions,
      jobId,
    });

    this.logger.log(`Enqueued project operation ${jobId}`);
  }

  private async assertCanReadProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    await requireProjectAccess(this.appData, userId, projectId);
  }

  private async assertCanEditProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await requireProjectAccess(this.appData, userId, projectId);
    if (project.ownerUserId === userId) return;

    const member = await this.appData.getProjectMembership(projectId, userId);
    if (member?.status === 'active' && ['owner', 'editor'].includes(member.role)) {
      return;
    }

    throw new ForbiddenException('Project edit access required');
  }

  private async assertCanManageProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await requireProjectAccess(this.appData, userId, projectId);
    if (project.ownerUserId === userId) return;

    const member = await this.appData.getProjectMembership(projectId, userId);
    if (member?.status === 'active' && member.role === 'owner') return;

    throw new ForbiddenException('Project owner access required');
  }

  /** Only the project owner (project.owner_user_id) may delete the project. */
  private async assertProjectOwner(userId: string, projectId: string): Promise<void> {
    const project = await requireProjectAccess(this.appData, userId, projectId);
    if (project.ownerUserId !== userId) {
      throw new ForbiddenException('Only the project owner can delete this project');
    }
  }

  private normalizeWorkspaceMode(
    workspaceMode: ProjectWorkspaceMode | undefined,
  ): ProjectWorkspaceMode {
    if (!workspaceMode) return 'solo';
    if (workspaceMode === 'solo' || workspaceMode === 'collaborative') {
      return workspaceMode;
    }
    throw new BadRequestException('workspaceMode must be solo or collaborative');
  }

  private normalizeRole(role: ProjectMemberRole): ProjectMemberRole {
    if (role === 'owner' || role === 'editor' || role === 'viewer') return role;
    throw new BadRequestException('role must be owner, editor, or viewer');
  }

  private assertName(value: string | undefined, message: string): void {
    if (!value || value.trim() === '') throw new BadRequestException(message);
  }

  private assertUserId(value: string | undefined): void {
    if (!value || value.trim() === '') {
      throw new BadRequestException('User id is required');
    }
  }

  private resolveProjectId(projectId: string | undefined): string {
    const trimmed = projectId?.trim();
    if (!trimmed) return randomUUID();
    this.assertUserId(trimmed);
    return trimmed;
  }
}
