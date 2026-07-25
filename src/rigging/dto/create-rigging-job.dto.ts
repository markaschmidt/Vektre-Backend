import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Start a RigAnything job for an existing storage-backed asset.
 * Asset ids in this codebase are opaque strings (not necessarily UUIDs).
 */
export class CreateRiggingJobDto {
  @IsString()
  @MaxLength(200)
  assetId!: string;

  @IsOptional()
  @IsBoolean()
  simplify?: boolean = true;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(50_000)
  targetFaceCount?: number = 8192;

  /**
   * Optional client-stable key to make create idempotent across retries.
   * Server also derives a per-job idempotency key for the RunPod worker.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientRequestId?: string;
}
