import { ProjectsProcessor } from './projects.processor.js';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { AssetsService } from './assets.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { UpsertProjectAssetJob } from './models/project-op-job.model.js';

describe('ProjectsProcessor.handleAssetUpsert', () => {
  const appData = {
    updateRequestStatus: jest.fn().mockResolvedValue(undefined),
    upsertProjectAsset: jest.fn().mockResolvedValue({ assetId: 'prop-1' }),
    updateProjectAssetStatus: jest.fn().mockResolvedValue({ assetId: 'prop-1', status: 'ready' }),
  };
  const assets = {};
  const notifications = {};

  let processor: ProjectsProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new ProjectsProcessor(
      appData as unknown as AppDataService,
      assets as unknown as AssetsService,
      notifications as unknown as NotificationsService,
    );
  });

  it('marks metadata-only assets ready after upsert', async () => {
    const job: UpsertProjectAssetJob = {
      requestId: 'req-1',
      actorUserId: 'user-1',
      projectId: 'proj-1',
      assetId: 'prop-1',
      assetType: 'prop',
      name: 'chair.glb',
      storageRef: 'supabase://project-assets/projects/proj-1/assets/prop-1/chair.glb',
      metadata: { projectRelativePath: 'chair.glb' },
    };

    await (processor as unknown as { handleAssetUpsert: (j: UpsertProjectAssetJob) => Promise<void> }).handleAssetUpsert(job);

    expect(appData.updateProjectAssetStatus).toHaveBeenCalledWith('prop-1', 'ready');
  });

  it('leaves byte-pending assets generating', async () => {
    const job: UpsertProjectAssetJob = {
      requestId: 'req-2',
      actorUserId: 'user-1',
      projectId: 'proj-1',
      assetId: 'prop-2',
      assetType: 'prop',
      name: 'chair.glb',
      sizeBytes: 4096,
      storageRef: 'supabase://project-assets/projects/proj-1/assets/prop-2/chair.glb',
    };

    await (processor as unknown as { handleAssetUpsert: (j: UpsertProjectAssetJob) => Promise<void> }).handleAssetUpsert(job);

    expect(appData.updateProjectAssetStatus).not.toHaveBeenCalled();
  });
});
