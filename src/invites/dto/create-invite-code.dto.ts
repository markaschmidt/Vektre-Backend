import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import type { ProjectMemberRole } from '../../integrations/app-data.types.js';

export class CreateInviteCodeDto {
  @IsEnum(['viewer', 'commenter', 'editor', 'owner'])
  role!: ProjectMemberRole;

  /**
   * Optional expiry override. Defaults to 24 hours from now.
   * Must be in the future.
   */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
