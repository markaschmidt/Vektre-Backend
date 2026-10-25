import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import type { ProjectAssetRow } from '../integrations/app-data.types.js';
import { SupabaseService } from '../integrations/supabase.js';
import { requireProjectAccess } from './project-access.js';
import { normalizeAssetMetadata } from './asset-conventions.js';
import {
  toReadyUploadResponse,
  type ProjectAssetBytesResponse,
  type ProjectAssetChunkUploadResponse,
  type ProjectAssetUploadResponse,
} from './models/project-asset.model.js';
import type {
  UploadProjectAssetDto,
  UploadProjectAssetChunkDto,
  ImportGeneratedAssetDto,
} from './dto/project.dto.js';
import { StorageQuotaService } from '../storage-quota/storage-quota.service.js';
import { canonicalSha256 } from '@markaschmidt/ui-builder-contracts';
import { UiContextIndexQueue } from '../ui-agent/indexer/ui-context-index.queue.js';

const SUPABASE_ASSET_REF_PREFIX = 'supabase://project-assets';

/** Short-lived assets staged before Google Drive export (deleted after upload). */
export const EXPORT_STAGING_ASSET_TYPE = 'export_staging';

export function isEphemeralExportStagingAsset(asset: {
  assetType: string;
  metadata?: Record<string, unknown>;
}): boolean {
  return (
    asset.assetType === EXPORT_STAGING_ASSET_TYPE ||
    asset.metadata?.ephemeral === true
  );
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
    private readonly storageQuota: StorageQuotaService,
    private readonly contextIndexQueue: UiContextIndexQueue,
  ) {}

  /**
   * Store an asset in Supabase Storage with metadata in Postgres.
   */
  async uploadAsset(
    userId: string,
    projectId: string,
    dto: UploadProjectAssetDto,
  ): Promise<ProjectAssetUploadResponse> {
    await this.assertProjectAccess(userId, projectId);

    const assetId = dto.assetId ?? `asset_${randomUUID()}`;
    const bytes = decodeBase64(dto.dataBase64);
    await this.storageQuota.assertWithinQuota(
      userId,
      projectId,
      bytes.byteLength,
      assetId,
    );
    const bucket = this.supabase.getStorageBucket();
    const objectPath = buildAssetObjectPath(projectId, assetId, dto.name);
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;
    const metadata = normalizeAssetMetadata(
      assetId,
      projectId,
      dto.assetType,
      dto.name,
      dto.metadata,
    );

    await this.appData.upsertProjectAsset({
      assetId,
      projectId,
      uploadedByUserId: userId,
      assetType: dto.assetType,
      name: dto.name,
      mimeType: dto.mimeType,
      sizeBytes: bytes.byteLength,
      storageRef,
      bucket,
      objectPath,
      checksum: dto.checksum,
      sourceProvider: dto.sourceProvider,
      requestId: dto.requestId,
      promptHash: dto.promptHash,
      metadata,
    });

    await this.supabase.uploadObject(
      objectPath,
      Buffer.from(bytes),
      dto.mimeType,
      bucket,
    );
    await this.appData.updateProjectAssetStatus(assetId, 'ready', {
      sizeBytes: bytes.byteLength,
      checksum: dto.checksum,
      storageRef,
      bucket,
      objectPath,
    });
    await this.enqueueAssetIndex(projectId, assetId);

    this.logger.log(
      `Asset ${assetId} stored in Supabase Storage for project ${projectId}`,
    );
    return toReadyUploadResponse({
      assetId,
      storageRef,
      sizeBytes: bytes.byteLength,
      mimeType: dto.mimeType,
      assetType: dto.assetType,
      metadata,
    });
  }

  /**
   * Upload one chunk to Supabase Storage. On the final chunk, chunks are merged
   * into the canonical asset object path.
   */
  async uploadAssetChunk(
    userId: string,
    projectId: string,
    assetId: string,
    dto: UploadProjectAssetChunkDto,
  ): Promise<ProjectAssetChunkUploadResponse> {
    await this.assertProjectAccess(userId, projectId);

    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new NotFoundException('Asset not found');
    }

    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    const bytes = decodeBase64(dto.dataBase64);
    const chunkPath = `${chunkPrefix(projectId, assetId)}/${dto.chunkIndex}`;

    await this.supabase.uploadObject(
      chunkPath,
      Buffer.from(bytes),
      asset.mimeType,
      bucket,
    );

    if (dto.isFinalChunk) {
      const prefix = chunkPrefix(projectId, assetId);
      const chunkPaths = (
        await this.supabase.listObjectPaths(prefix, bucket)
      ).sort((a, b) => chunkIndexFromPath(a) - chunkIndexFromPath(b));
      const buffers = await Promise.all(
        chunkPaths.map((path) => this.supabase.downloadObject(path, bucket)),
      );
      const merged = Buffer.concat(buffers);
      await this.storageQuota.assertWithinQuota(
        userId,
        projectId,
        merged.byteLength,
        assetId,
      );
      const objectPath =
        asset.objectPath ??
        buildAssetObjectPath(projectId, assetId, asset.name);
      const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;

      await this.supabase.uploadObject(
        objectPath,
        merged,
        asset.mimeType,
        bucket,
      );
      await this.supabase.deleteObjectsWithPrefix(prefix, bucket);
      await this.appData.updateProjectAssetStatus(assetId, 'ready', {
        sizeBytes: merged.byteLength,
        checksum: dto.checksum ?? asset.checksum,
        storageRef,
        bucket,
        objectPath,
      });
      await this.enqueueAssetIndex(projectId, assetId);

      return {
        assetId,
        chunkIndex: dto.chunkIndex,
        byteLength: bytes.byteLength,
        status: 'ready',
        storageRef,
        sizeBytes: merged.byteLength,
        mimeType: asset.mimeType,
        assetType: asset.assetType,
      };
    }

    return {
      assetId,
      chunkIndex: dto.chunkIndex,
      byteLength: bytes.byteLength,
      status: 'uploading',
    };
  }

  /**
   * Read a Supabase Storage-backed asset and return the base64 payload.
   */
  async getAssetBytes(
    userId: string,
    projectId: string,
    assetId: string,
  ): Promise<ProjectAssetBytesResponse> {
    await this.assertProjectAccess(userId, projectId);

    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) {
      this.logger.warn(
        `getAssetBytes 404: asset row missing projectId=${projectId} assetId=${assetId}`,
      );
      throw new NotFoundException('Asset not found');
    }
    if (!asset.objectPath) {
      this.logger.warn(
        `getAssetBytes 404: objectPath missing projectId=${projectId} assetId=${assetId} status=${asset.status}`,
      );
      throw new NotFoundException('Asset bytes not available');
    }

    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    let buffer: Buffer;
    try {
      buffer = await this.supabase.downloadObject(asset.objectPath, bucket);
    } catch (err) {
      this.logger.error(
        `getAssetBytes 404: storage object missing projectId=${projectId} assetId=${assetId} objectPath=${asset.objectPath} bucket=${bucket}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new NotFoundException('Asset bytes not found in storage');
    }

    return {
      assetId,
      name: asset.name,
      mimeType: asset.mimeType,
      sizeBytes: buffer.byteLength,
      dataBase64: buffer.toString('base64'),
      assetType: asset.assetType,
      metadata: asset.metadata,
      status: asset.status,
    };
  }

  /**
   * Remove ephemeral export-staging assets after a successful Drive upload.
   * Failures are logged but do not propagate.
   */
  async cleanupEphemeralStagingAssetIfNeeded(
    userId: string,
    projectId: string,
    assetId: string,
  ): Promise<void> {
    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) return;
    if (!isEphemeralExportStagingAsset(asset)) return;

    try {
      await this.deleteAsset(userId, projectId, assetId);
      this.logger.log(`Cleaned up ephemeral staging asset ${assetId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to clean up staging asset ${assetId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Server-side import: download a generated asset from a provider URL,
   * then store the bytes in Supabase Storage.
   */
  async importGeneratedAsset(
    userId: string,
    projectId: string,
    dto: ImportGeneratedAssetDto,
  ): Promise<ProjectAssetUploadResponse> {
    await this.assertProjectAccess(userId, projectId);

    const assetId = dto.assetId ?? `asset_${randomUUID()}`;
    const bucket = this.supabase.getStorageBucket();
    const objectPath = buildAssetObjectPath(projectId, assetId, dto.name);
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;
    const metadata = normalizeAssetMetadata(
      assetId,
      projectId,
      dto.assetType,
      dto.name,
      dto.metadata,
    );

    this.logger.log(
      `Importing generated asset from ${dto.sourceProvider}: ${dto.sourceUrl}`,
    );
    const response = await fetch(dto.sourceUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch generated asset from ${dto.sourceProvider}: ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType =
      dto.mimeType ??
      response.headers.get('content-type') ??
      'application/octet-stream';
    await this.storageQuota.assertWithinQuota(
      userId,
      projectId,
      buffer.byteLength,
      assetId,
    );

    await this.appData.upsertProjectAsset({
      assetId,
      projectId,
      uploadedByUserId: userId,
      assetType: dto.assetType,
      name: dto.name,
      mimeType: contentType,
      sizeBytes: buffer.byteLength,
      storageRef,
      bucket,
      objectPath,
      sourceProvider: dto.sourceProvider,
      requestId: dto.requestId,
      promptHash: dto.promptHash,
      metadata,
    });

    await this.supabase.uploadObject(objectPath, buffer, contentType, bucket);
    await this.appData.updateProjectAssetStatus(assetId, 'ready', {
      sizeBytes: buffer.byteLength,
      storageRef,
      bucket,
      objectPath,
    });
    await this.enqueueAssetIndex(projectId, assetId);

    this.logger.log(
      `Generated asset ${assetId} imported into Supabase for project ${projectId}`,
    );
    return toReadyUploadResponse({
      assetId,
      storageRef,
      sizeBytes: buffer.byteLength,
      mimeType: contentType,
      assetType: dto.assetType,
      metadata,
    });
  }

  /**
   * Persist already-fetched generated bytes (e.g. OpenAI b64 PNG) into project storage.
   */
  async materializeGeneratedBytes(
    userId: string,
    projectId: string,
    input: {
      assetId: string;
      assetType: string;
      name: string;
      mimeType: string;
      bytes: Buffer;
      requestId?: string;
      promptHash?: string;
      sourceProvider?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ProjectAssetUploadResponse> {
    await this.assertProjectAccess(userId, projectId);
    await this.storageQuota.assertWithinQuota(
      userId,
      projectId,
      input.bytes.byteLength,
      input.assetId,
    );

    const bucket = this.supabase.getStorageBucket();
    const objectPath = buildAssetObjectPath(
      projectId,
      input.assetId,
      input.name,
    );
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;
    const metadata = normalizeAssetMetadata(
      input.assetId,
      projectId,
      input.assetType,
      input.name,
      input.metadata,
    );

    await this.appData.upsertProjectAsset({
      assetId: input.assetId,
      projectId,
      uploadedByUserId: userId,
      assetType: input.assetType,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      storageRef,
      bucket,
      objectPath,
      sourceProvider: input.sourceProvider,
      requestId: input.requestId,
      promptHash: input.promptHash,
      metadata,
    });

    await this.supabase.uploadObject(
      objectPath,
      input.bytes,
      input.mimeType,
      bucket,
    );
    await this.appData.updateProjectAssetStatus(input.assetId, 'ready', {
      sizeBytes: input.bytes.byteLength,
      storageRef,
      bucket,
      objectPath,
    });
    await this.enqueueAssetIndex(projectId, input.assetId);

    return toReadyUploadResponse({
      assetId: input.assetId,
      storageRef,
      sizeBytes: input.bytes.byteLength,
      mimeType: input.mimeType,
      assetType: input.assetType,
      metadata,
    });
  }

  /**
   * Create a short-lived signed URL for a project asset (provider image inputs).
   */
  async createSignedAssetUrl(
    userId: string,
    projectId: string,
    assetId: string,
    expiresInSeconds = 3600,
  ): Promise<{ signedUrl: string; mimeType?: string }> {
    await this.assertProjectAccess(userId, projectId);
    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new NotFoundException('Asset not found');
    }
    if (!asset.objectPath) {
      throw new NotFoundException('Asset bytes not available');
    }
    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    const signedUrl = await this.supabase.createSignedDownloadUrl(
      asset.objectPath,
      expiresInSeconds,
      bucket,
    );
    return { signedUrl, mimeType: asset.mimeType };
  }

  /**
   * Resolve a cloud or local-scoped asset the user can access.
   * Cloud: project membership. Local: ownerUserId must match.
   */
  async resolveAccessibleAsset(
    userId: string,
    assetId: string,
  ): Promise<ProjectAssetRow> {
    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.status === 'deleted') {
      throw new NotFoundException('Asset not found');
    }
    if (asset.projectId) {
      await this.assertProjectAccess(userId, asset.projectId);
      return asset;
    }
    if (asset.localProjectId) {
      if (asset.ownerUserId !== userId) {
        throw new ForbiddenException('Asset not found');
      }
      return asset;
    }
    throw new NotFoundException('Asset not found');
  }

  async createSignedDownloadUrlForAsset(
    asset: ProjectAssetRow,
    expiresInSeconds: number,
  ): Promise<string> {
    if (!asset.objectPath) {
      throw new NotFoundException('Asset bytes not available');
    }
    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    return this.supabase.createSignedDownloadUrl(
      asset.objectPath,
      expiresInSeconds,
      bucket,
    );
  }

  /**
   * Reserve a rigged output asset path and return a signed PUT URL for the worker.
   */
  async reserveRiggedAssetUpload(
    userId: string,
    source: ProjectAssetRow,
    opts?: { outputAssetId?: string; name?: string },
  ): Promise<{
    assetId: string;
    storagePath: string;
    storageRef: string;
    bucket: string;
    uploadUrl: string;
  }> {
    return this.reserveDerivedModelAssetUpload(userId, source, {
      outputAssetId: opts?.outputAssetId,
      name: opts?.name,
      idPrefix: 'rigged',
      sourceProvider: 'riganything',
      assetRole: 'rigged_model',
      extraMetadata: { rigged: true },
    });
  }

  /**
   * Reserve storage for a Mesh2Motion output GLB (skeleton + baked animations).
   * Same cloud/local scoping as the source asset.
   */
  async reserveMesh2MotionAssetUpload(
    userId: string,
    source: ProjectAssetRow,
    opts?: {
      outputAssetId?: string;
      name?: string;
      skeletonType?: string;
    },
  ): Promise<{
    assetId: string;
    storagePath: string;
    storageRef: string;
    bucket: string;
    uploadUrl: string;
  }> {
    return this.reserveDerivedModelAssetUpload(userId, source, {
      outputAssetId: opts?.outputAssetId,
      name: opts?.name,
      idPrefix: 'm2m',
      sourceProvider: 'mesh2motion',
      assetRole: 'animated_model',
      extraMetadata: {
        rigged: true,
        animated: true,
        skeletonType: opts?.skeletonType ?? null,
      },
    });
  }

  private async reserveDerivedModelAssetUpload(
    userId: string,
    source: ProjectAssetRow,
    opts: {
      outputAssetId?: string;
      name?: string;
      idPrefix: string;
      sourceProvider: string;
      assetRole: string;
      extraMetadata?: Record<string, unknown>;
    },
  ): Promise<{
    assetId: string;
    storagePath: string;
    storageRef: string;
    bucket: string;
    uploadUrl: string;
  }> {
    const assetId = opts.outputAssetId ?? `${opts.idPrefix}-${randomUUID()}`;
    const name = opts.name ?? `${assetId}.glb`;
    const bucket = this.supabase.getStorageBucket();
    const objectPath = source.projectId
      ? buildAssetObjectPath(source.projectId, assetId, name)
      : buildLocalAssetObjectPath(
          userId,
          source.localProjectId!,
          assetId,
          name,
        );
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;
    const metadata = normalizeAssetMetadata(
      assetId,
      source.projectId ?? source.localProjectId ?? 'local',
      source.assetType || 'model',
      name,
      {
        ...(source.metadata ?? {}),
        sourceAssetId: source.assetId,
        assetRole: opts.assetRole,
        ...opts.extraMetadata,
      },
    );

    await this.appData.upsertProjectAsset({
      assetId,
      projectId: source.projectId,
      localProjectId: source.localProjectId,
      ownerUserId: source.ownerUserId ?? userId,
      uploadedByUserId: userId,
      assetType: source.assetType || 'model',
      name,
      mimeType: 'model/gltf-binary',
      storageRef,
      bucket,
      objectPath,
      sourceProvider: opts.sourceProvider,
      metadata,
      status: 'generating',
    });

    const signed = await this.supabase.createSignedUploadUrl(
      objectPath,
      bucket,
      {
        upsert: true,
      },
    );

    return {
      assetId,
      storagePath: objectPath,
      storageRef,
      bucket,
      uploadUrl: signed.signedUrl,
    };
  }

  async markAssetReadyFromStorage(
    assetId: string,
    opts?: { sizeBytes?: number },
  ): Promise<ProjectAssetRow | null> {
    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset?.objectPath) {
      throw new NotFoundException('Asset not found');
    }
    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    const exists = await this.supabase.objectExists(asset.objectPath, bucket);
    if (!exists) {
      throw new NotFoundException('Asset bytes not found in storage');
    }
    const sizeBytes = opts?.sizeBytes ?? asset.sizeBytes;
    if (asset.projectId && sizeBytes !== undefined) {
      await this.storageQuota.assertWithinQuota(
        asset.uploadedByUserId,
        asset.projectId,
        sizeBytes,
        asset.assetId,
      );
    }
    const ready = await this.appData.updateProjectAssetStatus(
      assetId,
      'ready',
      {
        sizeBytes,
        storageRef: asset.storageRef,
        bucket,
        objectPath: asset.objectPath,
      },
    );
    if (asset.projectId) {
      await this.enqueueAssetIndex(asset.projectId, assetId);
    }
    return ready;
  }

  /**
   * Persist a generated GLB for a local-only desktop project into Supabase.
   */
  async materializeLocalGeneratedAsset(
    userId: string,
    localProjectId: string,
    input: {
      assetId: string;
      assetType: string;
      name: string;
      mimeType: string;
      bytes?: Buffer;
      sourceUrl?: string;
      requestId?: string;
      promptHash?: string;
      sourceProvider?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<ProjectAssetUploadResponse> {
    const bucket = this.supabase.getStorageBucket();
    const objectPath = buildLocalAssetObjectPath(
      userId,
      localProjectId,
      input.assetId,
      input.name,
    );
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;
    const metadata = normalizeAssetMetadata(
      input.assetId,
      localProjectId,
      input.assetType,
      input.name,
      {
        ...(input.metadata ?? {}),
        localProjectId,
      },
    );

    let buffer = input.bytes;
    if (!buffer && input.sourceUrl) {
      const response = await fetch(input.sourceUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch generated asset: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
    }
    if (!buffer) {
      throw new Error(
        'materializeLocalGeneratedAsset requires bytes or sourceUrl',
      );
    }

    await this.appData.upsertProjectAsset({
      assetId: input.assetId,
      localProjectId,
      ownerUserId: userId,
      uploadedByUserId: userId,
      assetType: input.assetType,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: buffer.byteLength,
      storageRef,
      bucket,
      objectPath,
      sourceProvider: input.sourceProvider,
      requestId: input.requestId,
      promptHash: input.promptHash,
      metadata,
      status: 'generating',
    });

    await this.supabase.uploadObject(
      objectPath,
      buffer,
      input.mimeType,
      bucket,
    );
    await this.appData.updateProjectAssetStatus(input.assetId, 'ready', {
      sizeBytes: buffer.byteLength,
      storageRef,
      bucket,
      objectPath,
    });

    return toReadyUploadResponse({
      assetId: input.assetId,
      storageRef,
      sizeBytes: buffer.byteLength,
      mimeType: input.mimeType,
      assetType: input.assetType,
      metadata,
    });
  }

  /**
   * Delete asset bytes from Supabase Storage and mark metadata deleted.
   */
  async deleteAsset(
    userId: string,
    projectId: string,
    assetId: string,
  ): Promise<void> {
    await this.assertProjectAccess(userId, projectId);

    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new NotFoundException('Asset not found');
    }

    await this.deleteAssetStorage(asset);
    await this.appData.removeProjectAsset(projectId, assetId);
    await this.contextIndexQueue.enqueueSource({
      kind: 'source',
      projectId,
      sourceKind: 'asset',
      sourceId: assetId,
      sourceHash: canonicalSha256({ assetId, status: 'deleted' }),
    });
    this.logger.log(`Asset ${assetId} deleted from project ${projectId}`);
  }

  async deleteAssetStorage(asset: {
    projectId?: string | null;
    assetId: string;
    bucket?: string;
    objectPath?: string;
  }): Promise<void> {
    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    if (asset.objectPath) {
      await this.supabase.deleteObject(asset.objectPath, bucket);
    }
    if (asset.projectId) {
      await this.supabase.deleteObjectsWithPrefix(
        chunkPrefix(asset.projectId, asset.assetId),
        bucket,
      );
    }
  }

  private async enqueueAssetIndex(
    projectId: string,
    assetId: string,
  ): Promise<void> {
    await this.contextIndexQueue.enqueueAsset(projectId, assetId);
  }

  private async assertProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<void> {
    await requireProjectAccess(this.appData, userId, projectId);
  }
}

function buildAssetObjectPath(
  projectId: string,
  assetId: string,
  filename: string,
): string {
  const safeName = filename.replace(/[^\w.-]+/g, '_');
  return `projects/${projectId}/assets/${assetId}/${safeName}`;
}

function buildLocalAssetObjectPath(
  ownerUserId: string,
  localProjectId: string,
  assetId: string,
  filename: string,
): string {
  const safeName = filename.replace(/[^\w.-]+/g, '_');
  const safeLocal = localProjectId.replace(/[^\w.-]+/g, '_');
  const safeOwner = ownerUserId.replace(/[^\w.-]+/g, '_');
  return `local/${safeOwner}/${safeLocal}/assets/${assetId}/${safeName}`;
}

function chunkPrefix(projectId: string, assetId: string): string {
  return `projects/${projectId}/assets/${assetId}/chunks`;
}

function chunkIndexFromPath(path: string): number {
  const segment = path.split('/').pop() ?? '0';
  return Number(segment);
}

function decodeBase64(dataBase64: string): Uint8Array {
  const normalized = dataBase64.includes(',')
    ? dataBase64.slice(dataBase64.indexOf(',') + 1)
    : dataBase64;
  return Buffer.from(normalized, 'base64');
}
