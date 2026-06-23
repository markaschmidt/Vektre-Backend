import { IsEmail, IsEnum, IsISO8601, IsOptional } from 'class-validator';
import type { ProjectMemberRole } from '../../integrations/app-data.types.js';

export class CreateEmailInviteDto {
  @IsEmail()
  email!: string;

  @IsEnum(['viewer', 'commenter', 'editor', 'owner'])
  role!: ProjectMemberRole;

  /**
   * Optional ISO-8601 expiry. When omitted the invite has no TTL (stays pending
   * until the invitee accepts or the sender revokes it).
   */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
