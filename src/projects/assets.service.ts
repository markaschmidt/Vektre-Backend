import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import { SupabaseService } from '../integrations/supabase.js';
import type {
  UploadProjectAssetDto,
  UploadProjectAssetChunkDto,
  ImportGeneratedAssetDto,
} from './dto/project.dto.js';

const SUPABASE_ASSET_REF_PREFIX = 'supabase://project-assets';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Store an asset in Supabase Storage with metadata in Postgres.
   */
  async uploadAsset(
    userId: string,
    projectId: string,
    dto: UploadProjectAssetDto,
  ): Promise<{
    assetId: string;
    storageRef: string;
    sizeBytes: number;
    chunkCount: number;
  }> {
    await this.assertProjectAccess(userId, projectId);

    const assetId = dto.assetId ?? `asset_${randomUUID()}`;
    const bytes = decodeBase64(dto.dataBase64);
    const bucket = this.supabase.getStorageBucket();
    const objectPath = buildAssetObjectPath(projectId, assetId, dto.name);
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;

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
    });

    await this.supabase.uploadObject(objectPath, Buffer.from(bytes), dto.mimeType, bucket);
    await this.appData.updateProjectAssetStatus(assetId, 'ready', {
      sizeBytes: bytes.byteLength,
      checksum: dto.checksum,
      storageRef,
      bucket,
      objectPath,
    });

    this.logger.log(`Asset ${assetId} stored in Supabase Storage for project ${projectId}`);
    return { assetId, storageRef, sizeBytes: bytes.byteLength, chunkCount: 1 };
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
  ): Promise<{ assetId: string; chunkIndex: number; byteLength: number }> {
    await this.assertProjectAccess(userId, projectId);

    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new NotFoundException('Asset not found');
    }

    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    const bytes = decodeBase64(dto.dataBase64);
    const chunkPath = `${chunkPrefix(projectId, assetId)}/${dto.chunkIndex}`;

    await this.supabase.uploadObject(chunkPath, Buffer.from(bytes), asset.mimeType, bucket);

    if (dto.isFinalChunk) {
      const prefix = chunkPrefix(projectId, assetId);
      const chunkPaths = (await this.supabase.listObjectPaths(prefix, bucket))
        .sort((a, b) => chunkIndexFromPath(a) - chunkIndexFromPath(b));
      const buffers = await Promise.all(
        chunkPaths.map((path) => this.supabase.downloadObject(path, bucket)),
      );
      const merged = Buffer.concat(buffers);
      const objectPath =
        asset.objectPath ?? buildAssetObjectPath(projectId, assetId, asset.name);
      const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;

      await this.supabase.uploadObject(objectPath, merged, asset.mimeType, bucket);
      await this.supabase.deleteObjectsWithPrefix(prefix, bucket);
      await this.appData.updateProjectAssetStatus(assetId, 'ready', {
        sizeBytes: merged.byteLength,
        checksum: dto.checksum ?? asset.checksum,
        storageRef,
        bucket,
        objectPath,
      });
    }

    return { assetId, chunkIndex: dto.chunkIndex, byteLength: bytes.byteLength };
  }

  /**
   * Read a Supabase Storage-backed asset and return the base64 payload.
   */
  async getAssetBytes(
    userId: string,
    projectId: string,
    assetId: string,
  ): Promise<{
    assetId: string;
    name: string;
    mimeType?: string;
    sizeBytes: number;
    dataBase64: string;
  }> {
    await this.assertProjectAccess(userId, projectId);

    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new NotFoundException('Asset not found');
    }
    if (!asset.objectPath) {
      throw new NotFoundException('Asset bytes not found');
    }

    const buffer = await this.supabase.downloadObject(
      asset.objectPath,
      asset.bucket ?? this.supabase.getStorageBucket(),
    );
    return {
      assetId,
      name: asset.name,
      mimeType: asset.mimeType,
      sizeBytes: buffer.byteLength,
      dataBase64: buffer.toString('base64'),
    };
  }

  /**
   * Server-side import: download a generated asset from a provider URL,
   * then store the bytes in Supabase Storage.
   */
  async importGeneratedAsset(
    userId: string,
    projectId: string,
    dto: ImportGeneratedAssetDto,
  ): Promise<{ assetId: string; storageRef: string; sizeBytes: number; chunkCount: number }> {
    await this.assertProjectAccess(userId, projectId);

    const assetId = `asset_${randomUUID()}`;
    const bucket = this.supabase.getStorageBucket();
    const objectPath = buildAssetObjectPath(projectId, assetId, dto.name);
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;

    this.logger.log(`Importing generated asset from ${dto.sourceProvider}: ${dto.sourceUrl}`);
    const response = await fetch(dto.sourceUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch generated asset from ${dto.sourceProvider}: ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType =
      dto.mimeType ?? response.headers.get('content-type') ?? 'application/octet-stream';

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
    });

    await this.supabase.uploadObject(objectPath, buffer, contentType, bucket);
    await this.appData.updateProjectAssetStatus(assetId, 'ready', {
      sizeBytes: buffer.byteLength,
      storageRef,
      bucket,
      objectPath,
    });

    this.logger.log(`Generated asset ${assetId} imported into Supabase for project ${projectId}`);
    return { assetId, storageRef, sizeBytes: buffer.byteLength, chunkCount: 1 };
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
    this.logger.log(`Asset ${assetId} deleted from project ${projectId}`);
  }

  async deleteAssetStorage(asset: {
    projectId: string;
    assetId: string;
    bucket?: string;
    objectPath?: string;
  }): Promise<void> {
    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    if (asset.objectPath) {
      await this.supabase.deleteObject(asset.objectPath, bucket);
    }
    await this.supabase.deleteObjectsWithPrefix(chunkPrefix(asset.projectId, asset.assetId), bucket);
  }

  private async assertProjectAccess(userId: string, projectId: string): Promise<void> {
    const project = await this.appData.getProjectForUser(userId, projectId);
    if (!project) {
      throw new ForbiddenException('Project not found or access denied');
    }
  }
}

function buildAssetObjectPath(projectId: string, assetId: string, filename: string): string {
  const safeName = filename.replace(/[^\w.\-]+/g, '_');
  return `projects/${projectId}/assets/${assetId}/${safeName}`;
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
