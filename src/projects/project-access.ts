import type { AppDataService } from '../integrations/app-data.service.js';
import type { ProjectRow } from '../integrations/app-data.types.js';
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
