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
}

export interface GoogleDriveFileList {
  files: GoogleDriveFile[];
  nextPageToken?: string;
}

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
