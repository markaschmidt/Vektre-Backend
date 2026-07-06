import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const ACTIVITY_TYPES = [
  'model_generation',
  'image_generation',
  'asset_import',
  'project_sync',
  'ai_task',
  'comment_created',
  'comment_replied',
  'comment_resolved',
] as const;

export class CreateActivityDto {
  @IsIn(ACTIVITY_TYPES)
  activityType!:
    | 'model_generation'
    | 'image_generation'
    | 'asset_import'
    | 'project_sync'
    | 'ai_task'
    | 'comment_created'
    | 'comment_replied'
    | 'comment_resolved';

  /** Existing generative-model/import requestId to link this durable activity to. */
  @IsOptional()
  @IsString()
  requestId?: string;

  /** Surface-specific target anchor, e.g. { objectId, placement, assetId } for canvas/import. */
  @IsOptional()
  @IsObject()
  target?: Record<string, unknown>;

  /** Optional initial result payload for import/sync handoff. */
  @IsOptional()
  @IsObject()
  result?: Record<string, unknown>;
}
