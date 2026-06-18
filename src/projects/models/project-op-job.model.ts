import type {
  ProjectMemberRole,
  ProjectWorkspaceMode,
} from '../../integrations/app-data.types.js';

export type ProjectOpJobName =
  | 'project-create'
  | 'project-update'
  | 'project-archive'
  | 'project-delete'
  | 'project-member-upsert'
  | 'project-member-remove'
  | 'project-asset-upsert'
  | 'project-asset-remove';

interface ProjectJobBase {
  requestId: string;
  actorUserId: string;
  projectId: string;
}

export interface CreateProjectJob extends ProjectJobBase {
  ownerUserId: string;
  name: string;
  description?: string | null;
  workspaceMode: ProjectWorkspaceMode;
  iconAssetId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectJob extends ProjectJobBase {
  name?: string;
  description?: string | null;
  workspaceMode?: ProjectWorkspaceMode;
  iconAssetId?: string;
  metadata?: Record<string, unknown>;
}

export type ArchiveProjectJob = ProjectJobBase;
export type DeleteProjectJob = ProjectJobBase;

export interface UpsertProjectMemberJob extends ProjectJobBase {
  memberUserId: string;
  role: ProjectMemberRole;
}

export interface RemoveProjectMemberJob extends ProjectJobBase {
  memberUserId: string;
}

export interface UpsertProjectAssetJob extends ProjectJobBase {
  assetId: string;
  assetType: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageRef: string;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

export interface RemoveProjectAssetJob extends ProjectJobBase {
  assetId: string;
}

export type ProjectOpJobData =
  | CreateProjectJob
  | UpdateProjectJob
  | ArchiveProjectJob
  | DeleteProjectJob
  | UpsertProjectMemberJob
  | RemoveProjectMemberJob
  | UpsertProjectAssetJob
  | RemoveProjectAssetJob;
