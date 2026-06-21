import {
  AssetsService,
  EXPORT_STAGING_ASSET_TYPE,
  isEphemeralExportStagingAsset,
} from './assets.service.js';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { SupabaseService } from '../integrations/supabase.js';

describe('AssetsService', () => {
  let service: AssetsService;
  const appData = {
    getProjectForUser: jest.fn().mockResolvedValue({ projectId: 'proj-1' }),
    upsertProjectAsset: jest.fn().mockResolvedValue({ assetId: 'asset-1' }),
    updateProjectAssetStatus: jest.fn().mockResolvedValue({ assetId: 'asset-1', status: 'ready' }),
    getProjectAsset: jest.fn(),
    removeProjectAsset: jest.fn(),
  };
  const supabase = {
    getStorageBucket: jest.fn().mockReturnValue('project-assets'),
    uploadObject: jest.fn().mockResolvedValue(undefined),
    downloadObject: jest.fn().mockResolvedValue(Buffer.from('hello')),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    deleteObjectsWithPrefix: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssetsService(
      appData as unknown as AppDataService,
      supabase as unknown as SupabaseService,
    );
  });

  it('uploads decoded bytes to Supabase Storage', async () => {
    const result = await service.uploadAsset('user-1', 'proj-1', {
      assetType: 'image',
      name: 'photo.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from('hello').toString('base64'),
    });

    expect(appData.upsertProjectAsset).toHaveBeenCalled();
    expect(supabase.uploadObject).toHaveBeenCalledWith(
      expect.stringContaining('projects/proj-1/assets/'),
      expect.any(Buffer),
      'image/png',
      'project-assets',
    );
    expect(result.sizeBytes).toBe(5);
    expect(appData.updateProjectAssetStatus).toHaveBeenCalledWith(
      expect.any(String),
      'ready',
      expect.objectContaining({ sizeBytes: 5 }),
    );
  });

  it('downloads asset bytes from Supabase Storage', async () => {
    appData.getProjectAsset.mockResolvedValue({
      assetId: 'asset-1',
      projectId: 'proj-1',
      name: 'model.glb',
      assetType: 'model',
      objectPath: 'projects/proj-1/assets/asset-1/file.bin',
      bucket: 'project-assets',
      mimeType: 'model/gltf-binary',
    });

    const result = await service.getAssetBytes('user-1', 'proj-1', 'asset-1');
    expect(supabase.downloadObject).toHaveBeenCalledWith(
      'projects/proj-1/assets/asset-1/file.bin',
      'project-assets',
    );
    expect(result.dataBase64).toBe(Buffer.from('hello').toString('base64'));
    expect(result.name).toBe('model.glb');
    expect(result.assetType).toBe('model');
  });

  it('passes metadata through on upload', async () => {
    await service.uploadAsset('user-1', 'proj-1', {
      assetType: EXPORT_STAGING_ASSET_TYPE,
      name: 'My Storyboard.vkts',
      mimeType: 'application/vnd.vektre.vkts',
      dataBase64: Buffer.from('vkts').toString('base64'),
      metadata: { ephemeral: true, purpose: 'google_drive_export' },
    });

    expect(appData.upsertProjectAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: EXPORT_STAGING_ASSET_TYPE,
        metadata: { ephemeral: true, purpose: 'google_drive_export' },
      }),
    );
  });

  it('cleans up ephemeral staging assets after export', async () => {
    appData.getProjectAsset.mockResolvedValue({
      assetId: 'export-1',
      projectId: 'proj-1',
      assetType: EXPORT_STAGING_ASSET_TYPE,
      metadata: { ephemeral: true },
      objectPath: 'projects/proj-1/assets/export-1/file.bin',
      bucket: 'project-assets',
    });

    await service.cleanupEphemeralStagingAssetIfNeeded('user-1', 'proj-1', 'export-1');
    expect(supabase.deleteObject).toHaveBeenCalled();
    expect(appData.removeProjectAsset).toHaveBeenCalledWith('proj-1', 'export-1');
  });

  it('skips cleanup for non-ephemeral assets', async () => {
    appData.getProjectAsset.mockResolvedValue({
      assetId: 'asset-1',
      projectId: 'proj-1',
      assetType: 'model',
      objectPath: 'projects/proj-1/assets/asset-1/file.bin',
      bucket: 'project-assets',
    });

    await service.cleanupEphemeralStagingAssetIfNeeded('user-1', 'proj-1', 'asset-1');
    expect(supabase.deleteObject).not.toHaveBeenCalled();
    expect(appData.removeProjectAsset).not.toHaveBeenCalled();
  });

  it('deletes storage objects and metadata', async () => {
    appData.getProjectAsset.mockResolvedValue({
      assetId: 'asset-1',
      projectId: 'proj-1',
      objectPath: 'projects/proj-1/assets/asset-1/file.bin',
      bucket: 'project-assets',
    });

    await service.deleteAsset('user-1', 'proj-1', 'asset-1');
    expect(supabase.deleteObject).toHaveBeenCalled();
    expect(appData.removeProjectAsset).toHaveBeenCalledWith('proj-1', 'asset-1');
  });
});

describe('isEphemeralExportStagingAsset', () => {
  it('detects export_staging asset type', () => {
    expect(
      isEphemeralExportStagingAsset({ assetType: EXPORT_STAGING_ASSET_TYPE }),
    ).toBe(true);
  });

  it('detects metadata.ephemeral flag', () => {
    expect(
      isEphemeralExportStagingAsset({ assetType: 'other', metadata: { ephemeral: true } }),
    ).toBe(true);
  });

  it('returns false for permanent assets', () => {
    expect(isEphemeralExportStagingAsset({ assetType: 'model' })).toBe(false);
  });
});
