import { AssetsService } from './assets.service.js';
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
