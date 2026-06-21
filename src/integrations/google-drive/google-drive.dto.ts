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

  /**
   * When set, list the contents of this Drive folder instead of root/recent.
   * Pass the folder's Drive file ID.
   */
  @IsOptional()
  @IsString()
  folderId?: string;
}

export class GoogleDriveImportFileDto {
  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class GoogleDriveExportDto {
  /** Preferred filename (with or without extension). */
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
   * Target format. Accepts `markdown`, `google-doc`, `vkts`,
   * `application/vnd.vektre.vkts`, or another Drive MIME type.
   */
  @IsOptional()
  @IsString()
  mimeType?: string;

  /** Optional Drive folder ID to create the file inside. */
  @IsOptional()
  @IsString()
  folderId?: string;

  /** When set, replaces media on an existing file in Drive (not Google Docs). */
  @IsOptional()
  @IsString()
  fileId?: string;

  /**
   * Load bytes from project storage (preferred for large .vkts exports).
   * Requires `projectId`. Stage via POST /projects/:projectId/assets/upload first.
   */
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  /** Inline binary payload (base64). Small local-only fallback; prefer assetId for large files. */
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  contentBase64?: string;
}
