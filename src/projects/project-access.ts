import { ForbiddenException } from '@nestjs/common';
import type { AppDataService } from '../integrations/app-data.service.js';
import type {
  ProjectMemberRole,
  ProjectRow,
} from '../integrations/app-data.types.js';
import { hasPermission } from '../collaboration/models/collaboration.model.js';
import { throwProjectAccessDenied } from './project-access.exceptions.js';

export async function requireProjectAccess(
  appData: AppDataService,
  userId: string,
  projectId: string,
): Promise<ProjectRow> {
  const result = await appData.resolveProjectAccessForUser(userId, projectId);
  if (!result.ok) throwProjectAccessDenied(result.reason);
  return result.project;
}

export interface ResolvedProjectMembership {
  project: ProjectRow;
  role: ProjectMemberRole;
}

/**
 * Shared role-gate for feature modules (collaboration documents, comments,
 * activity) that need "at least X role" access checks without duplicating
 * the owner-vs-member resolution logic in every service.
 */
export async function requireProjectRole(
  appData: AppDataService,
  userId: string,
  projectId: string,
  minimumRole: ProjectMemberRole,
): Promise<ResolvedProjectMembership> {
  const project = await requireProjectAccess(appData, userId, projectId);

  let role: ProjectMemberRole | null = null;
  if (project.ownerUserId === userId) {
    role = 'owner';
  } else {
    const member = await appData.getProjectMembership(projectId, userId);
    role = member?.status === 'active' ? member.role : null;
  }

  if (!role) {
    throwProjectAccessDenied('removed');
  }
  if (!hasPermission(role, minimumRole)) {
    throw new ForbiddenException(
      `Insufficient permissions. Required: ${minimumRole}, your role: ${role}`,
    );
  }

  return { project, role };
}
