import { IsEnum } from 'class-validator';
import type { ProjectMemberRole } from '../../integrations/app-data.types.js';

export class UpdateMemberRoleDto {
  @IsEnum(['owner', 'editor', 'commenter', 'viewer'])
  role!: ProjectMemberRole;
}
