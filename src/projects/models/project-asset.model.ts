import type { ProjectAssetRow, ProjectAssetStatus } from '../../integrations/app-data.types.js';

/** Response from synchronous upload/import endpoints once bytes are stored. */
export interface ProjectAssetUploadResponse {
  assetId: string;
  storageRef: string;
  sizeBytes: number;
  chunkCount: number;
  status: 'ready';
  mimeType?: string;
  assetType: string;
  metadata?: Record<string, unknown>;
}

/** Chunk upload progress; final chunk includes ready status when merge completes. */
export interface ProjectAssetChunkUploadResponse {
  assetId: string;
  chunkIndex: number;
  byteLength: number;
  status: 'uploading' | 'ready';
  storageRef?: string;
  sizeBytes?: number;
  mimeType?: string;
  assetType?: string;
}

/** Asset row returned by GET /projects/:projectId/assets. */
export interface ProjectAssetListItem {
  assetId: string;
  projectId: string;
  assetType: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageRef: string;
  status: ProjectAssetStatus;
  checksum?: string;
  sourceProvider?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** True when GET .../bytes should succeed for this row. */
  bytesAvailable: boolean;
}

export interface ProjectAssetBytesResponse {
  assetId: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
  dataBase64: string;
  assetType: string;
  metadata?: Record<string, unknown>;
  status: ProjectAssetStatus;
}

/** Queued metadata upsert — operation status is separate from durable asset status. */
export interface ProjectAssetUpsertOperationResponse {
  requestId: string;
  projectId: string;
  assetId: string;
  /** BullMQ operation lifecycle — poll GET /requests/:requestId if needed. */
  operationStatus: 'queued';
  /** Expected durable asset status once the job completes. */
  expectedAssetStatus: 'ready' | 'generating';
}

export function toProjectAssetListItem(row: ProjectAssetRow): ProjectAssetListItem {
  // True only when GET .../bytes is expected to succeed (ready/active + stored object).
  const bytesAvailable =
    (row.status === 'ready' || row.status === 'active') && Boolean(row.objectPath);
  return {
    assetId: row.assetId,
    // Cloud list endpoints always have projectId; fall back for safety.
    projectId: row.projectId ?? row.localProjectId ?? '',
    assetType: row.assetType,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    storageRef: row.storageRef,
    status: row.status,
    checksum: row.checksum,
    sourceProvider: row.sourceProvider,
    requestId: row.requestId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    bytesAvailable,
  };
}

export function toReadyUploadResponse(input: {
  assetId: string;
  storageRef: string;
  sizeBytes: number;
  chunkCount?: number;
  mimeType?: string;
  assetType: string;
  metadata?: Record<string, unknown>;
}): ProjectAssetUploadResponse {
  return {
    assetId: input.assetId,
    storageRef: input.storageRef,
    sizeBytes: input.sizeBytes,
    chunkCount: input.chunkCount ?? 1,
    status: 'ready',
    mimeType: input.mimeType,
    assetType: input.assetType,
    metadata: input.metadata,
  };
}
