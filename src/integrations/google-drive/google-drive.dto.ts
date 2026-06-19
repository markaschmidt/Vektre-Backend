import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class GoogleDriveConnectDto {
  /** Google access token from Supabase session.provider_token after OAuth. */
  @IsString()
  accessToken!: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  /** Unix ms expiry when known (optional). */
  @IsOptional()
  @IsInt()
  @Min(0)
  expiresAt?: number;
}

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

export class GoogleDriveExportDto {
  /** Preferred filename (with or without `.md`). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  /** Alias for `fileName` used by some clients. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  /** Markdown body to upload. */
  @IsOptional()
  @IsString()
  @MaxLength(5_000_000)
  markdown?: string;

  /** Alias for `markdown` used by some clients. */
  @IsOptional()
  @IsString()
  @MaxLength(5_000_000)
  content?: string;

  /**
   * Target format. Accepts `markdown`, `google-doc`, or a Drive MIME type.
   * Defaults to a `.md` file in Drive.
   */
  @IsOptional()
  @IsString()
  mimeType?: string;

  /** Optional Drive folder ID to create the file inside. */
  @IsOptional()
  @IsString()
  folderId?: string;

  /** When set, replaces media on an existing markdown file in Drive. */
  @IsOptional()
  @IsString()
  fileId?: string;

  /** Export a stored project asset (e.g. generated 3D model) by reference. */
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  /** Inline binary payload (base64). Prefer assetId for large files. */
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  contentBase64?: string;
}
