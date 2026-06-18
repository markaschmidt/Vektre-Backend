import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import type { NotificationStatusFilter } from '../models/notification.model.js';

export class ListNotificationsDto {
  @IsOptional()
  @IsIn(['all', 'unread'])
  status?: NotificationStatusFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** ISO timestamp cursor. Returns notifications created before this value. */
  @IsOptional()
  @IsISO8601()
  before?: string;
}
