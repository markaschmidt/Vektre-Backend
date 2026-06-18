import { IsOptional, IsString } from 'class-validator';

export class GoogleDriveListFilesDto {
  @IsOptional()
  @IsString()
  pageToken?: string;

  @IsOptional()
  @IsString()
  query?: string;
}

export class GoogleDriveImportFileDto {
  @IsOptional()
  @IsString()
  mimeType?: string;
}
