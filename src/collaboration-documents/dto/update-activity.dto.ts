import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const ACTIVITY_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'];

export class UpdateActivityDto {
  @IsIn(ACTIVITY_STATUSES)
  status!: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

  /** e.g. { assetId, objectId, placement } once generation completes. */
  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}
