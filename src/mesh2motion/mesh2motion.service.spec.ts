import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Mesh2MotionService } from './mesh2motion.service.js';

describe('Mesh2MotionService', () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue({
      enabled: true,
      url: 'http://69.62.65.80:8010',
      apiKey: '',
      signedDownloadTtlSec: 1800,
    }),
  };

  const appData = {
    getMesh2MotionJobByIdempotencyKey: jest.fn().mockResolvedValue(null),
    createMesh2MotionJob: jest.fn().mockResolvedValue({}),
    getMesh2MotionJob: jest.fn(),
    getProjectAsset: jest.fn(),
  };

  const assets = {
    resolveAccessibleAsset: jest.fn(),
    reserveMesh2MotionAssetUpload: jest.fn(),
    createSignedDownloadUrlForAsset: jest.fn(),
  };

  const queue = {
    add: jest.fn().mockResolvedValue({ id: 'bull-1' }),
  };

  const client = {
    listSkeletons: jest.fn(),
    health: jest.fn(),
  };

  let service: Mesh2MotionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new Mesh2MotionService(
      config as never,
      appData as never,
      assets as never,
      client as never,
      queue as never,
    );
  });

  it('rejects when Mesh2Motion is not configured', async () => {
    config.getOrThrow.mockReturnValueOnce({
      enabled: false,
      url: '',
      apiKey: '',
    });
    await expect(
      service.createJob('user-1', {
        assetId: 'asset-1',
        skeletonType: 'human',
      }),
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
      service.createJob('user-1', {
        assetId: 'asset-1',
        skeletonType: 'human',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enqueues a mesh2motion job for a ready GLB', async () => {
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
    assets.reserveMesh2MotionAssetUpload.mockResolvedValue({
      assetId: 'm2m-1',
      storagePath: 'projects/proj-1/assets/m2m-1/m2m-1.glb',
      storageRef:
        'supabase://project-assets/projects/proj-1/assets/m2m-1/m2m-1.glb',
      bucket: 'project-assets',
      uploadUrl: 'https://signed.example/upload',
    });

    const result = await service.createJob('user-1', {
      assetId: 'asset-1',
      skeletonType: 'fox',
      animationNames: ['Walk', 'Idle'],
    });

    expect(result.status).toBe('queued');
    expect(result.assetId).toBe('asset-1');
    expect(result.outputAssetId).toBe('m2m-1');
    expect(result.skeletonType).toBe('fox');
    expect(appData.createMesh2MotionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        skeletonType: 'fox',
        animationNames: ['Walk', 'Idle'],
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'mesh2motion-rig',
      expect.objectContaining({
        sourceAssetId: 'asset-1',
        outputAssetId: 'm2m-1',
        skeletonType: 'fox',
        animationNames: ['Walk', 'Idle'],
      }),
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('accepts desktop client animations field and worker options', async () => {
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
    assets.reserveMesh2MotionAssetUpload.mockResolvedValue({
      assetId: 'm2m-1',
      storagePath: 'projects/proj-1/assets/m2m-1/m2m-1.glb',
      storageRef:
        'supabase://project-assets/projects/proj-1/assets/m2m-1/m2m-1.glb',
      bucket: 'project-assets',
      uploadUrl: 'https://signed.example/upload',
    });

    await service.createJob('user-1', {
      assetId: 'asset-1',
      skeletonType: 'human',
      animations: ['Idle_A', 'Walk'],
      boneNaming: 'default',
      exportContents: 'full',
      mirror: false,
      headWeightCorrection: false,
    });

    expect(appData.createMesh2MotionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        animationNames: ['Idle_A', 'Walk'],
        resultJson: expect.objectContaining({
          workerOptions: {
            boneNaming: 'default',
            exportContents: 'full',
            mirror: false,
            headWeightCorrection: false,
            handSkeleton: null,
            boneOverrides: null,
          },
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'mesh2motion-rig',
      expect.objectContaining({
        animationNames: ['Idle_A', 'Walk'],
        workerOptions: {
          boneNaming: 'default',
          exportContents: 'full',
          mirror: false,
          headWeightCorrection: false,
          handSkeleton: null,
          boneOverrides: null,
        },
      }),
      expect.any(Object),
    );
  });

  it('returns ownership-checked status with signed URL when completed', async () => {
    appData.getMesh2MotionJob.mockResolvedValue({
      jobId: 'job-1',
      userId: 'user-1',
      status: 'completed',
      sourceAssetId: 'asset-1',
      outputAssetId: 'm2m-1',
      projectId: 'proj-1',
      localProjectId: null,
      skeletonType: 'human',
      animationNames: null,
      errorMessage: null,
      resultJson: { workerStatus: 'completed' },
    });
    appData.getProjectAsset.mockResolvedValue({
      assetId: 'm2m-1',
      objectPath: 'projects/proj-1/assets/m2m-1/m2m-1.glb',
    });
    assets.createSignedDownloadUrlForAsset.mockResolvedValue(
      'https://signed.example/animated.glb',
    );

    const status = await service.getJob('user-1', 'job-1');
    expect(status.animatedAssetUrl).toBe('https://signed.example/animated.glb');
    expect(status.status).toBe('completed');
    expect(status.skeletonType).toBe('human');
  });
});
