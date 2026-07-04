import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
