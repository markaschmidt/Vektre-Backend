import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GoogleConfig } from '../../config/outbound.config.js';
import { outboundJson } from '../outbound-http.js';
import { ProviderError, classifyHttpStatus } from '../provider-error.model.js';
import type {
  GoogleDriveUser,
  GoogleDriveFile,
  GoogleDriveFileList,
  GoogleDriveExportResult,
  GoogleDriveExportTarget,
} from './google-drive.model.js';

const PROVIDER = 'google-drive';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

interface DriveAboutResponse {
  user: {
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  };
}

interface DriveFilesResponse {
  files: {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
  }[];
  nextPageToken?: string;
}

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(private readonly config: ConfigService) {}

  private get cfg(): GoogleConfig {
    return this.config.get<GoogleConfig>('outbound.google')!;
  }

  private authHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
  }

  /**
   * Return user info from the Google Drive /about endpoint.
   * The access token must be a Supabase-managed Google OAuth token.
   */
  async getAbout(opts: {
    accessToken: string;
    userId: string;
  }): Promise<GoogleDriveUser> {
    const url = `${DRIVE_BASE}/about?fields=user`;
    const { data } = await outboundJson<DriveAboutResponse>({
      provider: PROVIDER,
      url,
      headers: this.authHeaders(opts.accessToken),
      timeoutMs: this.cfg.timeoutMs,
      userId: opts.userId,
    });

    return {
      displayName: data.user.displayName,
      emailAddress: data.user.emailAddress,
      photoLink: data.user.photoLink,
    };
  }

  /**
   * List files in Google Drive.
   * Uses the minimal file fields needed for the import workflow.
   */
  async listFiles(opts: {
    accessToken: string;
    userId: string;
    pageToken?: string;
    query?: string;
  }): Promise<GoogleDriveFileList> {
    const params = new URLSearchParams({
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
      pageSize: '100',
      orderBy: 'modifiedTime desc',
    });

    if (opts.pageToken) params.set('pageToken', opts.pageToken);
    if (opts.query) params.set('q', opts.query);

    const url = `${DRIVE_BASE}/files?${params.toString()}`;
    const { data } = await outboundJson<DriveFilesResponse>({
      provider: PROVIDER,
      url,
      headers: this.authHeaders(opts.accessToken),
      timeoutMs: this.cfg.timeoutMs,
      userId: opts.userId,
    });

    return {
      files: data.files ?? [],
      nextPageToken: data.nextPageToken,
    };
  }

  /**
   * Get metadata for a single file.
   */
  async getFile(opts: {
    accessToken: string;
    userId: string;
    fileId: string;
  }): Promise<GoogleDriveFile> {
    const params = new URLSearchParams({
      fields: 'id,name,mimeType,size,modifiedTime,webViewLink',
    });
    const url = `${DRIVE_BASE}/files/${opts.fileId}?${params.toString()}`;
    const { data } = await outboundJson<GoogleDriveFile>({
      provider: PROVIDER,
      url,
      headers: this.authHeaders(opts.accessToken),
      timeoutMs: this.cfg.timeoutMs,
      userId: opts.userId,
    });
    return data;
  }

  /**
   * Export a Google Workspace document (Docs, Sheets, etc.) as a different MIME type.
   * Returns raw buffer – callers are responsible for persisting to storage.
   */
  async exportFile(opts: {
    accessToken: string;
    userId: string;
    fileId: string;
    mimeType: string;
  }): Promise<{ buffer: Buffer; mimeType: string }> {
    const url = `${DRIVE_BASE}/files/${opts.fileId}/export?mimeType=${encodeURIComponent(opts.mimeType)}`;

    const response = await fetch(url, {
      headers: this.authHeaders(opts.accessToken),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw ProviderError.permanent(
        PROVIDER,
        `Export failed HTTP ${response.status}: ${text.slice(0, 300)}`,
        response.status,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), mimeType: opts.mimeType };
  }

  /**
   * Download binary content of a non-workspace file (e.g. PDF, image).
   */
  async downloadFile(opts: {
    accessToken: string;
    userId: string;
    fileId: string;
    mimeType: string;
  }): Promise<{ buffer: Buffer; mimeType: string }> {
    const url = `${DRIVE_BASE}/files/${opts.fileId}?alt=media`;

    const response = await fetch(url, {
      headers: this.authHeaders(opts.accessToken),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw ProviderError.permanent(
        PROVIDER,
        `Download failed HTTP ${response.status}: ${text.slice(0, 300)}`,
        response.status,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    this.logger.log(
      JSON.stringify({
        event: 'google_drive_download_complete',
        fileId: opts.fileId,
        userId: opts.userId,
        bytes: arrayBuffer.byteLength,
      }),
    );
    return { buffer: Buffer.from(arrayBuffer), mimeType: opts.mimeType };
  }

  /**
   * Resolve the best export MIME type for a Google Workspace document.
   * Returns null for non-workspace files that use direct download.
   */
  getExportMimeType(googleMimeType: string): string | null {
    const exportMap: Record<string, string> = {
      'application/vnd.google-apps.document': 'text/plain',
      'application/vnd.google-apps.spreadsheet':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.google-apps.presentation':
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.google-apps.drawing': 'image/png',
    };
    return exportMap[googleMimeType] ?? null;
  }

  /**
   * Upload content from Vektre into the user's Google Drive.
   * Supports markdown/text, binary files, and Google Doc conversion.
   */
  async exportToDrive(opts: {
    accessToken: string;
    userId: string;
    fileName: string;
    mimeType: string;
    content: Buffer | string;
    contentMimeType: string;
    folderId?: string;
    fileId?: string;
  }): Promise<GoogleDriveExportResult> {
    if (opts.fileId) {
      return this.updateDriveExport({
        accessToken: opts.accessToken,
        userId: opts.userId,
        fileName: opts.fileName,
        mimeType: opts.mimeType,
        content: opts.content,
        contentMimeType: opts.contentMimeType,
        fileId: opts.fileId,
      });
    }

    return this.createDriveExport(opts);
  }

  /** @deprecated Use exportToDrive — kept for callers passing markdown-only payloads. */
  async exportMarkdown(opts: {
    accessToken: string;
    userId: string;
    fileName: string;
    content: string;
    targetMimeType?: GoogleDriveExportTarget;
    folderId?: string;
    fileId?: string;
  }): Promise<GoogleDriveExportResult> {
    const targetMimeType = opts.targetMimeType ?? 'text/markdown';
    return this.exportToDrive({
      accessToken: opts.accessToken,
      userId: opts.userId,
      fileName: opts.fileName,
      mimeType: targetMimeType,
      content: opts.content,
      contentMimeType:
        targetMimeType === 'application/vnd.google-apps.document'
          ? 'text/markdown'
          : 'text/markdown',
      folderId: opts.folderId,
      fileId: opts.fileId,
    });
  }

  resolveExportTargetMimeType(mimeType?: string): GoogleDriveExportTarget {
    const normalized = mimeType?.trim().toLowerCase();
    if (!normalized) return 'text/markdown';

    if (
      normalized === 'google-doc' ||
      normalized === 'google_doc' ||
      normalized === 'googledoc' ||
      normalized === 'application/vnd.google-apps.document'
    ) {
      return 'application/vnd.google-apps.document';
    }

    return 'text/markdown';
  }

  private async createDriveExport(opts: {
    accessToken: string;
    userId: string;
    fileName: string;
    mimeType: string;
    content: Buffer | string;
    contentMimeType: string;
    folderId?: string;
  }): Promise<GoogleDriveExportResult> {
    const metadata: Record<string, unknown> = {
      name: normalizeDriveExportFileName(opts.fileName, opts.mimeType),
      mimeType: opts.mimeType,
    };
    if (opts.folderId) metadata.parents = [opts.folderId];

    const file = await this.uploadMultipart({
      accessToken: opts.accessToken,
      userId: opts.userId,
      method: 'POST',
      url: `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`,
      metadata,
      content: opts.content,
      contentMimeType: opts.contentMimeType,
    });

    return toExportResult(file);
  }

  private async updateDriveExport(opts: {
    accessToken: string;
    userId: string;
    fileName: string;
    mimeType: string;
    content: Buffer | string;
    contentMimeType: string;
    fileId: string;
  }): Promise<GoogleDriveExportResult> {
    const existing = await this.getFile({
      accessToken: opts.accessToken,
      userId: opts.userId,
      fileId: opts.fileId,
    });

    if (existing.mimeType.startsWith('application/vnd.google-apps.')) {
      throw ProviderError.permanent(
        PROVIDER,
        'Updating native Google Workspace files is not supported. Export without fileId to create a new file.',
        400,
      );
    }

    const file = await this.uploadMultipart({
      accessToken: opts.accessToken,
      userId: opts.userId,
      method: 'PATCH',
      url: `${DRIVE_UPLOAD_BASE}/files/${opts.fileId}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink`,
      metadata: {
        name: normalizeDriveExportFileName(opts.fileName, opts.mimeType),
        mimeType: opts.mimeType,
      },
      content: opts.content,
      contentMimeType: opts.contentMimeType,
    });

    return toExportResult(file);
  }

  private async uploadMultipart(opts: {
    accessToken: string;
    userId: string;
    method: 'POST' | 'PATCH';
    url: string;
    metadata: Record<string, unknown>;
    content: Buffer | string;
    contentMimeType: string;
  }): Promise<GoogleDriveFile> {
    const boundary = `vektre_${cryptoRandomBoundary()}`;
    const body = buildMultipartBody(
      boundary,
      opts.metadata,
      opts.content,
      opts.contentMimeType,
    );

    const response = await fetch(opts.url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: body as BodyInit,
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw classifyHttpStatus(PROVIDER, response.status, text.slice(0, 300));
    }

    const data = (await response.json()) as GoogleDriveFile;
    this.logger.log(
      JSON.stringify({
        event: 'google_drive_export_complete',
        userId: opts.userId,
        fileId: data.id,
        mimeType: data.mimeType,
      }),
    );
    return data;
  }
}

function toExportResult(file: GoogleDriveFile): GoogleDriveExportResult {
  return {
    fileId: file.id,
    fileName: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink,
    modifiedTime: file.modifiedTime,
  };
}

export function normalizeDriveExportFileName(
  fileName: string,
  mimeType: string,
): string {
  const trimmed = fileName.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  if (!trimmed) {
    return mimeType === 'text/markdown' ? 'Untitled.md' : 'Untitled';
  }

  if (mimeType === 'text/markdown') {
    return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
  }

  if (mimeType === 'application/vnd.google-apps.document') {
    return trimmed.replace(/\.md$/i, '');
  }

  return trimmed;
}

function buildMultipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  content: Buffer | string,
  contentMimeType: string,
): Buffer {
  const prefix = Buffer.from(
    [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${contentMimeType}`,
      '',
    ].join('\r\n'),
  );
  const contentBuffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([prefix, contentBuffer, suffix]);
}

function cryptoRandomBoundary(): string {
  return Math.random().toString(36).slice(2, 14);
}
