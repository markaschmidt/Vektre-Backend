import { PayloadTooLargeException } from '@nestjs/common';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { OrganizationsService } from '../organizations/organizations.service.js';
import type { OrganizationsRepository } from '../organizations/repositories/organizations.repository.js';
import {
  STORAGE_QUOTA_BYTES,
  StorageQuotaService,
} from './storage-quota.service.js';

describe('StorageQuotaService', () => {
  const appData = {
    getUserProfile: jest.fn(),
    getProjectForUser: jest.fn(),
    getProjectAsset: jest.fn(),
  };
  const repository = {
    getUserStorageUsageBytes: jest.fn(),
    getOrganizationStorageUsageBytes: jest.fn(),
  };
  const organizationAccess = {
    requireMember: jest.fn(),
    requireOrganization: jest.fn(),
  };
  let service: StorageQuotaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageQuotaService(
      appData as unknown as AppDataService,
      repository as unknown as OrganizationsRepository,
      organizationAccess as unknown as OrganizationsService,
    );
    repository.getUserStorageUsageBytes.mockResolvedValue(0);
    appData.getProjectAsset.mockResolvedValue(null);
  });

  it.each([
    ['free', 2 * 1024 ** 3],
    ['professional', 20 * 1024 ** 3],
    ['studio', 500 * 1024 ** 3],
    ['enterprise', 1024 ** 4],
  ] as const)('returns the %s plan quota', async (plan, expected) => {
    appData.getUserProfile.mockResolvedValue({ plan });

    const result = await service.getUserUsage('user-1');

    expect(result.quota_bytes).toBe(expected);
    expect(result.plan).toBe(plan);
  });

  it('rejects an upload that would exceed the quota', async () => {
    appData.getProjectForUser.mockResolvedValue({
      projectId: 'project-1',
      ownerUserId: 'user-1',
      organizationId: null,
    });
    appData.getUserProfile.mockResolvedValue({ plan: 'free' });
    repository.getUserStorageUsageBytes.mockResolvedValue(
      STORAGE_QUOTA_BYTES.free - 10,
    );

    await expect(
      service.assertWithinQuota('user-1', 'project-1', 11),
    ).rejects.toThrow(PayloadTooLargeException);
  });

  it('uses an organization enterprise override', async () => {
    organizationAccess.requireMember.mockResolvedValue({ role: 'contributor' });
    organizationAccess.requireOrganization.mockResolvedValue({
      organizationId: 'org-1',
      createdBy: 'owner-1',
      storageQuotaOverrideBytes: 5 * 1024 ** 4,
    });
    appData.getUserProfile.mockResolvedValue({ plan: 'enterprise' });
    repository.getOrganizationStorageUsageBytes.mockResolvedValue(1024);

    const result = await service.getOrganizationUsage('user-1', 'org-1');

    expect(result.quota_bytes).toBe(5 * 1024 ** 4);
    expect(result.used_bytes).toBe(1024);
  });
});
