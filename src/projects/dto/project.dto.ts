import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  ProjectMemberRole,
  ProjectWorkspaceMode,
  ShareLinkRole,
} from '../../integrations/app-data.types.js';

export class CreateProjectDto {
  /** Client-supplied id for cloud/local-first sync; server generates one if omitted. */
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(['solo', 'collaborative'])
  workspaceMode?: ProjectWorkspaceMode;

  @IsOptional()
  @IsString()
  iconAssetId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(['solo', 'collaborative'])
  workspaceMode?: ProjectWorkspaceMode;

  @IsOptional()
  @IsString()
  iconAssetId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpsertProjectMemberDto {
  @IsString()
  userId!: string;

  @IsEnum(['owner', 'editor', 'commenter', 'viewer'])
  role!: ProjectMemberRole;
}

export class UpdateProjectMemberDto {
  @IsEnum(['owner', 'editor', 'commenter', 'viewer'])
  role!: ProjectMemberRole;
}

export class UpsertProjectAssetDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsString()
  assetType!: string;

  @IsString()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  storageRef?: string;

  @IsOptional()
  @IsString()
  checksum?: string;

  @IsOptional()
  @IsString()
  sourceProvider?: string;

  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsString()
  promptHash?: string;

  @IsOptional()
  @IsUrl()
  publicUrl?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Store a project asset directly in Supabase Storage.
 * dataBase64 is decoded by NestJS and uploaded as a storage object.
 */
export class UploadProjectAssetDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsString()
  assetType!: string;

  @IsString()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  checksum?: string;

  @IsOptional()
  @IsString()
  sourceProvider?: string;

  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsString()
  promptHash?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsString()
  dataBase64!: string;
}

/**
 * Append or replace one Supabase Storage chunk for an asset.
 * Useful for larger files where sending the whole base64 payload at once is
 * not desirable.
 */
export class UploadProjectAssetChunkDto {
  @IsInt()
  @Min(0)
  chunkIndex!: number;

  @IsString()
  dataBase64!: string;

  @IsOptional()
  @IsString()
  checksum?: string;

  @IsOptional()
  isFinalChunk?: boolean;
}

/**
 * Used when NestJS imports a generated asset (Replicate/OpenAI output) into
 * Supabase Storage-backed project asset storage server-side.
 */
export class ImportGeneratedAssetDto {
  @IsString()
  requestId!: string;

  @IsString()
  assetType!: string;

  @IsString()
  @MaxLength(500)
  name!: string;

  @IsUrl()
  sourceUrl!: string;

  @IsEnum(['replicate', 'openai'])
  sourceProvider!: 'replicate' | 'openai';

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  promptHash?: string;
}

export { ShareLinkRole };
