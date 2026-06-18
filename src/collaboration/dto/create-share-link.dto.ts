import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import type { ShareLinkRole } from '../../integrations/app-data.types.js';

export class CreateShareLinkDto {
  @IsEnum(['viewer', 'commenter', 'editor'])
  roleToGrant!: ShareLinkRole;

  @IsISO8601()
  expiresAt!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;
}
