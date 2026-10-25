import {
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { OrganizationRole } from '../../integrations/app-data.types.js';
import {
  ORGANIZATION_LOGO_MAX_PX,
  ORGANIZATION_LOGO_MIME_TYPES,
} from '../models/organization.model.js';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsUrl()
  logoUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsInt()
  @Min(1)
  @Max(ORGANIZATION_LOGO_MAX_PX)
  logoWidth?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsInt()
  @Min(1)
  @Max(ORGANIZATION_LOGO_MAX_PX)
  logoHeight?: number | null;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsUrl()
  logoUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsInt()
  @Min(1)
  @Max(ORGANIZATION_LOGO_MAX_PX)
  logoWidth?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value != null)
  @IsInt()
  @Min(1)
  @Max(ORGANIZATION_LOGO_MAX_PX)
  logoHeight?: number | null;
}

/**
 * Store an organization logo in Supabase Storage via Nest (same pattern as
 * project asset upload). dataBase64 is decoded server-side; do not upload
 * directly to Storage from the desktop app.
 */
export class UploadOrganizationLogoDto {
  @IsString()
  dataBase64!: string;

  @IsString()
  @IsIn([...ORGANIZATION_LOGO_MIME_TYPES])
  mimeType!: (typeof ORGANIZATION_LOGO_MIME_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(ORGANIZATION_LOGO_MAX_PX)
  logoWidth!: number;

  @IsInt()
  @Min(1)
  @Max(ORGANIZATION_LOGO_MAX_PX)
  logoHeight!: number;
}

export class AddOrganizationMemberDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsEnum(['executive', 'contributor', 'inspector', 'spectator'])
  role!: OrganizationRole;
}

export class UpdateOrganizationMemberDto {
  @IsEnum(['executive', 'contributor', 'inspector', 'spectator'])
  role!: OrganizationRole;
}

export class ExchangeOrganizationOAuthDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class UpsertPerforceIntegrationDto {
  @IsString()
  @MinLength(1)
  serverUrl!: string;

  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(1)
  credential!: string;

  @IsOptional()
  @IsString()
  workspace?: string;
}

export class UpsertGitLfsIntegrationDto {
  @IsString()
  @MinLength(1)
  endpoint!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
