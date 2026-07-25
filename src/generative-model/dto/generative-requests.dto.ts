import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IMAGE_PROVIDER_IDS } from '../image-generation/image-generation.types.js';

/** Where the desktop initiated the generative request (for cost attribution). */
export const GENERATION_SURFACES = [
  'storyboard',
  'foundry',
  'canvas',
  'direct',
] as const;

export class MultiviewImageUrlsDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  front?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  back?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  left?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  right?: string;
}

export class Create3dRequestDto {
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  /**
   * Required for project cost attribution (Foundry / storyboard / settings).
   * Actor userId is taken from the auth token — do not send a client userId.
   * May be a client-supplied project id (not necessarily a UUID).
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  projectId?: string;

  /**
   * Local-only desktop project id. When set (and projectId omitted), the
   * completed GLB is persisted to Supabase under the caller's ownership so
   * RigAnything can consume it without a separate upload.
   * Mutually exclusive with projectId.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  localProjectId?: string;

  @IsOptional()
  @IsIn(GENERATION_SURFACES as unknown as string[])
  surface?: (typeof GENERATION_SURFACES)[number];

  /** `3.1` (default) single image or prompt; `2mv` multiview orthographic set. */
  @IsOptional()
  @IsIn(['3.1', '2mv', 'tencent/hunyuan-3d-3.1', 'tencent/hunyuan3d-2mv'])
  hunyuanModel?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MultiviewImageUrlsDto)
  multiviewImageUrls?: MultiviewImageUrlsDto;

  /** Prop (default) | hero — Hunyuan 3.1 only. */
  @IsOptional()
  @IsIn(['prop', 'hero'])
  qualityTier?: 'prop' | 'hero';

  /** Hunyuan 3.1: 40_000–1_500_000. Also used as fallback for 2mv when targetFaceNum omitted. */
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(1500000)
  faceCount?: number;

  /** Hunyuan 2mv: 100–1_000_000 (preferred over faceCount when hunyuanModel is 2mv). */
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(1000000)
  targetFaceNum?: number;

  @IsOptional()
  @IsInt()
  @Min(16)
  @Max(512)
  octreeResolution?: number;

  @IsOptional()
  @IsIn([
    'Normal',
    'Geometry',
    'LowPoly',
    'normal',
    'geometry',
    'lowpoly',
    'low_poly',
  ])
  generateType?: string;

  @IsOptional()
  @IsBoolean()
  enablePbr?: boolean;

  @IsOptional()
  @IsBoolean()
  useCustomFaceCount?: boolean;

  @IsOptional()
  @IsInt()
  @Min(40000)
  @Max(1500000)
  customFaceCount?: number;
}

export class CreateDocumentSuggestionDto {
  @IsString()
  @MaxLength(8000)
  documentText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  context?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  projectId?: string;

  @IsOptional()
  @IsIn(GENERATION_SURFACES as unknown as string[])
  surface?: (typeof GENERATION_SURFACES)[number];
}

export class CreateConceptArtDto {
  @IsString()
  @MaxLength(8000)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  style?: string;

  @IsOptional()
  @IsIn(IMAGE_PROVIDER_IDS as unknown as string[])
  provider?: (typeof IMAGE_PROVIDER_IDS)[number];

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'auto'])
  quality?: 'low' | 'medium' | 'high' | 'auto';

  @IsOptional()
  @IsIn(['1024x1024', '1024x1536', '1536x1024', 'auto'])
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  aspectRatio?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  variants?: number;

  /**
   * Required for project cost attribution from Storyboard.
   * Actor userId comes from Authorization — never trust a body userId.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  projectId?: string;

  @IsOptional()
  @IsIn(GENERATION_SURFACES as unknown as string[])
  surface?: (typeof GENERATION_SURFACES)[number];
}
