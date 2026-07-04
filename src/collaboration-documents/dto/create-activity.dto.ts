import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const ACTIVITY_TYPES = ['model_generation', 'image_generation', 'asset_import', 'project_sync', 'ai_task'];

export class CreateActivityDto {
  @IsIn(ACTIVITY_TYPES)
  activityType!:
    | 'model_generation'
    | 'image_generation'
    | 'asset_import'
    | 'project_sync'
    | 'ai_task';

  /** Existing generative-model/import requestId to link this durable activity to. */
  @IsOptional()
  @IsString()
  requestId?: string;

  /** Surface-specific target anchor, e.g. { objectId, placement } for canvas. */
  @IsOptional()
  @IsObject()
  target?: Record<string, unknown>;
}
