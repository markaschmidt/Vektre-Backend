import type { ProjectAssetStatus } from '../integrations/app-data.types.js';

export const MODEL_PREVIEW_SUFFIX = '-preview';

const MODEL_ASSET_TYPES = new Set([
  'prop',
  'character',
  'model',
  'design',
  'image',
  'art',
  'concept_art',
]);

/** Canonical project manifest asset id: `{projectId}-vkt`. */
export function projectManifestAssetId(projectId: string): string {
  return `${projectId}-vkt`;
}

/** Preview image asset id for a repository item: `{repositoryItemId}-preview`. */
export function modelPreviewAssetId(repositoryItemId: string): string {
  return `${repositoryItemId}${MODEL_PREVIEW_SUFFIX}`;
}

export function isPreviewAssetId(assetId: string): boolean {
  return assetId.endsWith(MODEL_PREVIEW_SUFFIX);
}

export function isProjectManifestAssetId(assetId: string, projectId: string): boolean {
  return assetId === projectManifestAssetId(projectId);
}

export function sanitizeRelatedFilename(filename: string): string {
  return filename.replace(/[^\w.\-]+/g, '_');
}

/** Related file asset id: `{repositoryItemId}-{sanitizedFilename}`. */
export function relatedAssetId(repositoryItemId: string, filename: string): string {
  return `${repositoryItemId}-${sanitizeRelatedFilename(filename)}`;
}

export function isModelLikeAssetType(assetType: string): boolean {
  return MODEL_ASSET_TYPES.has(assetType);
}

/**
 * Apply cloud repository metadata defaults without reminting client asset ids.
 */
export function normalizeAssetMetadata(
  assetId: string,
  projectId: string,
  assetType: string,
  name: string,
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...(metadata ?? {}) };

  if (isPreviewAssetId(assetId)) {
    const parentId = assetId.slice(0, -MODEL_PREVIEW_SUFFIX.length);
    if (parentId) {
      meta.parentAssetId ??= parentId;
    }
    meta.assetRole ??= 'model_preview';
  }

  if (isProjectManifestAssetId(assetId, projectId)) {
    meta.assetRole ??= 'project_manifest';
  }

  if (
    !meta.projectRelativePath &&
    isModelLikeAssetType(assetType) &&
    !isPreviewAssetId(assetId) &&
    (name.endsWith('.glb') || name.endsWith('.gltf'))
  ) {
    meta.projectRelativePath = name;
  }

  return meta;
}

/** Metadata-only upserts have no bytes yet and should not stay `generating`. */
export function isMetadataOnlyUpsert(input: {
  sizeBytes?: number;
  storageRef?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  if (input.metadata?.awaitingBytes === true) return false;
  if (input.metadata?.bytesExpected === true) return false;
  if (typeof input.sizeBytes === 'number' && input.sizeBytes > 0) return false;
  return true;
}

export function resolvePostUpsertAssetStatus(input: {
  sizeBytes?: number;
  storageRef?: string;
  metadata?: Record<string, unknown>;
}): 'ready' | 'generating' {
  return isMetadataOnlyUpsert(input) ? 'ready' : 'generating';
}

/** Usable for LRU `/bytes` fetches — ready/active rows with stored object paths. */
export function isAssetBytesReady(row: {
  status: ProjectAssetStatus;
  objectPath?: string;
}): boolean {
  return (
    (row.status === 'ready' || row.status === 'active') && Boolean(row.objectPath)
  );
}
