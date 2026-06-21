export interface GoogleDriveUser {
  displayName: string;
  emailAddress: string;
  photoLink?: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  isFolder?: boolean;
}

export interface GoogleDriveFileList {
  folders: GoogleDriveFile[];
  files: GoogleDriveFile[];
  nextPageToken?: string;
}

/** Vektre proprietary MIME types stored as opaque blobs in Drive. */
export const VEKTRE_MIME_TYPES = {
  /** .vkts — Vektre Sheet: portable document/sheet snapshot (all content, layout, assets) */
  VKTS: 'application/vnd.vektre.vkts',
} as const;

/** Google Workspace MIME types we have no import/export support for. */
export const UNSUPPORTED_IMPORT_MIME_TYPES = new Set([
  'application/vnd.google-apps.presentation', // Slides
  'application/vnd.google-apps.spreadsheet',  // Sheets
  'application/vnd.google-apps.form',
  'application/vnd.google-apps.site',
  'application/vnd.google-apps.map',
]);

export interface GoogleDriveImportJob {
  requestId: string;
  userId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  exportMimeType?: string;
}

export interface GoogleDriveExportResult {
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
}

export type GoogleDriveExportTarget =
  | 'text/markdown'
  | 'application/vnd.google-apps.document';

export interface GoogleDriveExportInput {
  fileName: string;
  mimeType: string;
  content: Buffer | string;
  contentMimeType: string;
  folderId?: string;
  fileId?: string;
}
