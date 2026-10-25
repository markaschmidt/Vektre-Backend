import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SNAPSHOT_PREVIEW_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type SnapshotPreviewMimeType =
  (typeof SNAPSHOT_PREVIEW_MIME_TYPES)[number];

export class CreateSnapshotDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class CreateSnapshotPreviewUploadDto {
  @IsIn(SNAPSHOT_PREVIEW_MIME_TYPES as unknown as string[])
  contentType!: SnapshotPreviewMimeType;
}

export class CompleteSnapshotPreviewDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8_000_000)
  byteLength?: number;
}
