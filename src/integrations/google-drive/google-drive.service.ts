import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GoogleConfig } from '../../config/outbound.config.js';
import { outboundJson } from '../outbound-http.js';
import { ProviderError } from '../provider-error.model.js';
import type {
  GoogleDriveUser,
  GoogleDriveFile,
  GoogleDriveFileList,
} from './google-drive.model.js';

const PROVIDER = 'google-drive';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';

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
}
