import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { RiggingService } from './rigging.service.js';

describe('RiggingService', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      enabled: true,
      url: 'https://example.proxy.runpod.net',
      apiKey: 'secret',
      signedDownloadTtlSec: 1800,
    }),
  };

  const appData = {
    getRiggingJobByIdempotencyKey: jest.fn().mockResolvedValue(null),
    createRiggingJob: jest.fn().mockResolvedValue({}),
    getRiggingJob: jest.fn(),
    getProjectAsset: jest.fn(),
  };

  const assets = {
    resolveAccessibleAsset: jest.fn(),
    reserveRiggedAssetUpload: jest.fn(),
    createSignedDownloadUrlForAsset: jest.fn(),
  };

  const queue = {
    add: jest.fn().mockResolvedValue({ id: 'bull-1' }),
  };

  let service: RiggingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RiggingService(
      config as never,
      appData as never,
      assets as never,
      queue as never,
    );
  });

  it('rejects when RigAnything is not configured', async () => {
    config.getOrThrow.mockReturnValueOnce({ enabled: false, url: '', apiKey: '' });
    await expect(
      service.createJob('user-1', { assetId: 'asset-1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects non-ready source assets', async () => {
    assets.resolveAccessibleAsset.mockResolvedValue({
      assetId: 'asset-1',
      status: 'generating',
      objectPath: 'projects/p/a/file.glb',
      name: 'file.glb',
      mimeType: 'model/gltf-binary',
    });
    await expect(
      service.createJob('user-1', { assetId: 'asset-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enqueues a rigging job for a ready GLB', async () => {
    assets.resolveAccessibleAsset.mockResolvedValue({
      assetId: 'asset-1',
      projectId: 'proj-1',
      localProjectId: null,
      status: 'ready',
      objectPath: 'projects/proj-1/assets/asset-1/model.glb',
      name: 'model.glb',
      mimeType: 'model/gltf-binary',
      assetType: 'model',
    });
    assets.reserveRiggedAssetUpload.mockResolvedValue({
      assetId: 'rigged-1',
      storagePath: 'projects/proj-1/assets/rigged-1/rigged-1.glb',
      storageRef: 'supabase://project-assets/projects/proj-1/assets/rigged-1/rigged-1.glb',
      bucket: 'project-assets',
      uploadUrl: 'https://signed.example/upload',
    });

    const result = await service.createJob('user-1', {
      assetId: 'asset-1',
      simplify: true,
      targetFaceCount: 8192,
    });

    expect(result.status).toBe('queued');
    expect(result.assetId).toBe('asset-1');
    expect(result.outputAssetId).toBe('rigged-1');
    expect(appData.createRiggingJob).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'rig-anything',
      expect.objectContaining({
        sourceAssetId: 'asset-1',
        outputAssetId: 'rigged-1',
        targetFaceCount: 8192,
      }),
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('returns ownership-checked status with signed URL when completed', async () => {
    appData.getRiggingJob.mockResolvedValue({
      jobId: 'job-1',
      userId: 'user-1',
      status: 'completed',
      sourceAssetId: 'asset-1',
      outputAssetId: 'rigged-1',
      projectId: 'proj-1',
      localProjectId: null,
      simplify: true,
      targetFaceCount: 8192,
      errorMessage: null,
      resultJson: { workerStatus: 'completed' },
    });
    appData.getProjectAsset.mockResolvedValue({
      assetId: 'rigged-1',
      objectPath: 'projects/proj-1/assets/rigged-1/rigged-1.glb',
    });
    assets.createSignedDownloadUrlForAsset.mockResolvedValue(
      'https://signed.example/rigged.glb',
    );

    const status = await service.getJob('user-1', 'job-1');
    expect(status.riggedAssetUrl).toBe('https://signed.example/rigged.glb');
    expect(status.status).toBe('completed');
  });
});
