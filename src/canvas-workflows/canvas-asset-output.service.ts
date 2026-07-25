import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import { SupabaseService } from '../integrations/supabase.js';
import { normalizeAssetMetadata } from '../projects/asset-conventions.js';
import { modelPreviewAssetId } from '../projects/asset-conventions.js';

const SUPABASE_ASSET_REF_PREFIX = 'supabase://project-assets';

export interface MaterializeAssetInput {
  projectId: string;
  userId: string;
  assetId: string;
  assetType: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
  requestId?: string;
  promptHash?: string;
  sourceProvider?: string;
  metadata?: Record<string, unknown>;
}

export interface MaterializedAsset {
  assetId: string;
  storageRef: string;
  sizeBytes: number;
  mimeType: string;
  assetType: string;
  metadata: Record<string, unknown>;
  name: string;
}

/**
 * Shared project-asset materialization for canvas action outputs.
 * All handlers should create ready assets through this service.
 */
@Injectable()
export class CanvasAssetOutputService {
  private readonly logger = new Logger(CanvasAssetOutputService.name);

  constructor(
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
  ) {}

  buildPromptHash(parts: string[]): string {
    return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
  }

  childSliceAssetId(parentAssetId: string, runId: string, index: number): string {
    return `${parentAssetId}-slice-${runId.slice(0, 8)}-${index}`;
  }

  async materializeBytes(input: MaterializeAssetInput): Promise<MaterializedAsset> {
    const bucket = this.supabase.getStorageBucket();
    const objectPath = buildAssetObjectPath(
      input.projectId,
      input.assetId,
      input.name,
    );
    const storageRef = `${SUPABASE_ASSET_REF_PREFIX}/${objectPath}`;
    const metadata = normalizeAssetMetadata(
      input.assetId,
      input.projectId,
      input.assetType,
      input.name,
      {
        ...(input.metadata ?? {}),
        canvasOutput: true,
      },
    );

    await this.appData.upsertProjectAsset({
      assetId: input.assetId,
      projectId: input.projectId,
      uploadedByUserId: input.userId,
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

    this.logger.log(
      JSON.stringify({
        event: 'canvas_asset_materialized',
        assetId: input.assetId,
        projectId: input.projectId,
        requestId: input.requestId,
        sizeBytes: input.bytes.byteLength,
      }),
    );

    return {
      assetId: input.assetId,
      storageRef,
      sizeBytes: input.bytes.byteLength,
      mimeType: input.mimeType,
      assetType: input.assetType,
      metadata,
      name: input.name,
    };
  }

  async materializeFromUrl(input: {
    projectId: string;
    userId: string;
    assetId: string;
    assetType: string;
    name: string;
    sourceUrl: string;
    sourceProvider: string;
    mimeType?: string;
    requestId?: string;
    promptHash?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MaterializedAsset> {
    const response = await fetch(input.sourceUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch generated asset from ${input.sourceProvider}: ${response.status}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType =
      input.mimeType ??
      response.headers.get('content-type') ??
      'application/octet-stream';

    return this.materializeBytes({
      projectId: input.projectId,
      userId: input.userId,
      assetId: input.assetId,
      assetType: input.assetType,
      name: input.name,
      mimeType,
      bytes: buffer,
      requestId: input.requestId,
      promptHash: input.promptHash,
      sourceProvider: input.sourceProvider,
      metadata: input.metadata,
    });
  }

  async createSignedAssetUrl(
    projectId: string,
    assetId: string,
    expiresInSeconds = 3600,
  ): Promise<{ assetId: string; signedUrl: string; mimeType?: string }> {
    const asset = await this.appData.getProjectAsset(assetId);
    if (!asset || asset.projectId !== projectId) {
      throw new Error(`Asset ${assetId} not found in project ${projectId}`);
    }
    if (!asset.objectPath) {
      throw new Error(`Asset ${assetId} has no stored bytes`);
    }
    const bucket = asset.bucket ?? this.supabase.getStorageBucket();
    const { data, error } = await this.supabase
      .getAdminClient()
      .storage.from(bucket)
      .createSignedUrl(asset.objectPath, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new Error(
        `Failed to sign asset URL for ${assetId}: ${error?.message ?? 'empty'}`,
      );
    }
    return {
      assetId,
      signedUrl: data.signedUrl,
      mimeType: asset.mimeType,
    };
  }

  previewIdFor(assetId: string): string {
    return modelPreviewAssetId(assetId);
  }
}

function buildAssetObjectPath(
  projectId: string,
  assetId: string,
  filename: string,
): string {
  const safeName = filename.replace(/[^\w.\-]+/g, '_');
  return `projects/${projectId}/assets/${assetId}/${safeName}`;
}
