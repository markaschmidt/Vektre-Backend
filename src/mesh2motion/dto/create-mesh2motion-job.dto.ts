import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  MESH2MOTION_SKELETON_TYPES,
  type Mesh2MotionSkeletonType,
} from '../models/mesh2motion-job.model.js';

export type Mesh2MotionBoneNaming = 'default' | 'mixamo';
export type Mesh2MotionExportContents = 'full' | 'skeleton';

/**
 * Start a Mesh2Motion archetype rig+animate job for an existing storage-backed GLB.
 * Asset ids in this codebase are opaque strings (not necessarily UUIDs).
 */
export class CreateMesh2MotionJobDto {
  @IsString()
  @MaxLength(200)
  assetId!: string;

  /**
   * Required archetype template. Must match a Mesh2Motion skeleton type the
   * worker supports (human biped, fox, bird, etc.).
   */
  @IsString()
  @IsIn(MESH2MOTION_SKELETON_TYPES)
  skeletonType!: Mesh2MotionSkeletonType;

  /**
   * Desktop client field: animation clip names to bake.
   * Alias of `animationNames` (either may be sent).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  animations?: string[];

  /**
   * Optional subset of animation clip names (API/docs alias for `animations`).
   * Omit or send [] to let the worker use its default pack for the skeleton.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  animationNames?: string[];

  /** Passed through to animator `options.bone_naming`. */
  @IsOptional()
  @IsIn(['default', 'mixamo'])
  boneNaming?: Mesh2MotionBoneNaming;

  /** Passed through to animator export mode when supported. */
  @IsOptional()
  @IsIn(['full', 'skeleton'])
  exportContents?: Mesh2MotionExportContents;

  /** Passed through to animator `options.mirror`. */
  @IsOptional()
  @IsBoolean()
  mirror?: boolean;

  /** Passed through to animator when supported. */
  @IsOptional()
  @IsBoolean()
  headWeightCorrection?: boolean;

  /** Passed through to animator `options.hand_skeleton` when non-null. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(200)
  handSkeleton?: string | null;

  /** Passed through to animator `options.bone_overrides` when non-null. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsObject()
  boneOverrides?: Record<string, unknown> | null;

  /**
   * Optional client-stable key to make create idempotent across retries.
   * Server also derives a per-job idempotency key for the Mesh2Motion worker.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientRequestId?: string;
}

export interface Mesh2MotionWorkerOptions {
  boneNaming?: Mesh2MotionBoneNaming;
  exportContents?: Mesh2MotionExportContents;
  mirror?: boolean;
  headWeightCorrection?: boolean;
  handSkeleton?: string | null;
  boneOverrides?: Record<string, unknown> | null;
}

/** Resolve clip list from either desktop (`animations`) or API (`animationNames`). */
export function resolveMesh2MotionAnimations(
  dto: Pick<CreateMesh2MotionJobDto, 'animations' | 'animationNames'>,
): string[] | null {
  const names =
    (dto.animations && dto.animations.length > 0
      ? dto.animations
      : dto.animationNames) ?? [];
  return names.length > 0 ? names : null;
}

export function resolveMesh2MotionWorkerOptions(
  dto: CreateMesh2MotionJobDto,
): Mesh2MotionWorkerOptions {
  return {
    boneNaming: dto.boneNaming,
    exportContents: dto.exportContents,
    mirror: dto.mirror,
    headWeightCorrection: dto.headWeightCorrection,
    handSkeleton: dto.handSkeleton ?? null,
    boneOverrides: dto.boneOverrides ?? null,
  };
}
