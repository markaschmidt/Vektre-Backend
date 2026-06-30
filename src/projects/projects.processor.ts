import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
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
import { AppDataService } from '../integrations/app-data.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AssetsService } from './assets.service.js';
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

@Processor(PROJECT_OPS_QUEUE, { concurrency: 10 })
export class ProjectsProcessor extends WorkerHost {
  private readonly logger = new Logger(ProjectsProcessor.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly assets: AssetsService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<ProjectOpJobData, void, ProjectOpJobName>): Promise<void> {
    this.logger.log(`Processing project job ${job.id} (${job.name})`);

    try {
      await this.appData.updateRequestStatus(job.data.requestId, 'processing');

      switch (job.name) {
        case JOB_PROJECT_CREATE:
          await this.handleCreate(job.data as CreateProjectJob);
          break;
        case JOB_PROJECT_UPDATE:
          await this.handleUpdate(job.data as UpdateProjectJob);
          break;
        case JOB_PROJECT_ARCHIVE:
          await this.handleArchive(job.data as ArchiveProjectJob);
          break;
        case JOB_PROJECT_DELETE:
          await this.handleDelete(job.data as DeleteProjectJob);
          break;
        case JOB_PROJECT_MEMBER_UPSERT:
          await this.handleMemberUpsert(job.data as UpsertProjectMemberJob);
          break;
        case JOB_PROJECT_MEMBER_REMOVE:
          await this.handleMemberRemove(job.data as RemoveProjectMemberJob);
          break;
        case JOB_PROJECT_ASSET_UPSERT:
          await this.handleAssetUpsert(job.data as UpsertProjectAssetJob);
          break;
        case JOB_PROJECT_ASSET_REMOVE:
          await this.handleAssetRemove(job.data as RemoveProjectAssetJob);
          break;
        default:
          throw new Error(`Unknown project job: ${(job as Job).name}`);
      }

      await this.appData.updateRequestStatus(job.data.requestId, 'completed', {
        outputRef: `project:${job.data.projectId}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appData.updateRequestStatus(job.data.requestId, 'failed', {
        errorMessage: message,
      });
      throw err;
    }
  }

  private async handleCreate(job: CreateProjectJob): Promise<void> {
    await this.appData.createProject({
      projectId: job.projectId,
      ownerUserId: job.ownerUserId,
      name: job.name,
      description: job.description,
      workspaceMode: job.workspaceMode,
      iconAssetId: job.iconAssetId,
      metadata: job.metadata,
    });
  }

  private async handleUpdate(job: UpdateProjectJob): Promise<void> {
    await this.appData.updateProject(job.projectId, {
      name: job.name,
      description: job.description,
      workspaceMode: job.workspaceMode,
      iconAssetId: job.iconAssetId,
      metadata: job.metadata,
    });
  }

  private async handleArchive(job: ArchiveProjectJob): Promise<void> {
    await this.appData.setProjectStatus(job.projectId, 'archived');
  }

  private async handleDelete(job: DeleteProjectJob): Promise<void> {
    const project = await this.appData.getProjectById(job.projectId);
    if (!project || project.status === 'deleted') return;

    const members = await this.appData.listProjectMembers(job.projectId);

    await this.appData.removeAllProjectMembers(job.projectId);
    await this.appData.setProjectStatus(job.projectId, 'deleted');

    await this.notifications.notifyProjectDeleted({
      projectId: job.projectId,
      projectName: project.name,
      actorUserId: job.actorUserId,
      members: members.map((member) => ({
        userId: member.userId,
        role: member.role,
      })),
    });
  }

  private async handleMemberUpsert(job: UpsertProjectMemberJob): Promise<void> {
    const [project, existing] = await Promise.all([
      this.appData.getProjectForUser(job.actorUserId, job.projectId),
      this.appData.getProjectMembership(job.projectId, job.memberUserId),
    ]);

    const updated = await this.appData.upsertProjectMember({
      projectId: job.projectId,
      userId: job.memberUserId,
      role: job.role,
      addedByUserId: job.actorUserId,
    });

    if (!project) return;

    if (!existing || existing.status === 'removed') {
      await this.notifications.notifyProjectInvitation({
        projectId: job.projectId,
        projectName: project.name,
        userId: job.memberUserId,
        actorUserId: job.actorUserId,
        role: updated.role,
      });
      return;
    }

    await this.notifications.notifyProjectRoleChange({
      projectId: job.projectId,
      projectName: project.name,
      userId: job.memberUserId,
      actorUserId: job.actorUserId,
      previousRole: existing.role,
      newRole: updated.role,
    });
  }

  private async handleMemberRemove(job: RemoveProjectMemberJob): Promise<void> {
    const [project, existing] = await Promise.all([
      this.appData.getProjectForUser(job.actorUserId, job.projectId),
      this.appData.getProjectMembership(job.projectId, job.memberUserId),
    ]);
    await this.appData.removeProjectMember(job.projectId, job.memberUserId);

    if (project && existing?.status === 'active') {
      await this.notifications.notifyProjectRemoval({
        projectId: job.projectId,
        projectName: project.name,
        userId: job.memberUserId,
        actorUserId: job.actorUserId,
        previousRole: existing.role,
      });
    }
  }

  private async handleAssetUpsert(job: UpsertProjectAssetJob): Promise<void> {
    await this.appData.upsertProjectAsset({
      assetId: job.assetId,
      projectId: job.projectId,
      uploadedByUserId: job.actorUserId,
      assetType: job.assetType,
      name: job.name,
      mimeType: job.mimeType,
      sizeBytes: job.sizeBytes,
      storageRef: job.storageRef,
      checksum: job.checksum,
      metadata: job.metadata,
    });
  }

  private async handleAssetRemove(job: RemoveProjectAssetJob): Promise<void> {
    const asset = await this.appData.getProjectAsset(job.assetId);
    if (asset) {
      await this.assets.deleteAssetStorage(asset);
    }
    await this.appData.removeProjectAsset(job.projectId, job.assetId);
  }
}
