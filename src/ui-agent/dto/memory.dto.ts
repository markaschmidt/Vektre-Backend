import { Type } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MEMORY_KINDS = [
  'lore',
  'aesthetic',
  'constraint',
  'decision',
  'rejected_direction',
  'interaction_rule',
  'terminology',
] as const;

const MEMORY_SCOPES = [
  'organization',
  'project',
  'document',
  'screen',
  'block',
  'group',
  'component',
] as const;

export class CreateUiMemoryDto {
  @IsIn(MEMORY_KINDS)
  kind!: (typeof MEMORY_KINDS)[number];

  @IsIn(MEMORY_SCOPES)
  scope!: (typeof MEMORY_SCOPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  scopeId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  text!: string;

  @IsOptional()
  @Allow()
  structuredValue?: unknown;

  @IsIn(['shared', 'private'])
  visibility!: 'shared' | 'private';

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  threadId?: string;

  @IsIn(['message', 'comment', 'run', 'user'])
  sourceKind!: 'message' | 'comment' | 'run' | 'user';

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  sourceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  documentRevision?: string;
}

export class ListUiMemoryDto {
  @IsOptional()
  @IsIn(['all', 'shared', 'private'])
  visibility?: 'all' | 'shared' | 'private';

  @IsOptional()
  @IsIn(['proposed', 'accepted', 'rejected', 'superseded'])
  status?: 'proposed' | 'accepted' | 'rejected' | 'superseded';

  @IsOptional()
  @IsIn(MEMORY_KINDS)
  kind?: (typeof MEMORY_KINDS)[number];

  @IsOptional()
  @IsIn(MEMORY_SCOPES)
  scope?: (typeof MEMORY_SCOPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  scopeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
}

export class SupersedeUiMemoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  replacementMemoryId!: string;
}

export class AcceptUiMemoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  effectiveRevision?: string;
}
