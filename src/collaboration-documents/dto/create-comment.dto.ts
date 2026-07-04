import { IsArray, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  /** Surface-specific structured anchor (see CollaborationSurface.commentAnchorSchema). */
  @IsOptional()
  @IsObject()
  anchor?: Record<string, unknown>;

  /** Optional project asset this comment is attached to instead of/alongside a document. */
  @IsOptional()
  @IsString()
  assetId?: string;

  /** User ids @-mentioned in the comment body, notified via NotificationsService. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedUserIds?: string[];
}
