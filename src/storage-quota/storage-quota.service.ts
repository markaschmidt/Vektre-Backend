import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AppDataService } from '../integrations/app-data.service.js';
import type { UserPlan } from '../integrations/app-data.types.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { OrganizationsRepository } from '../organizations/repositories/organizations.repository.js';
import type { StorageUsageApi } from './models/storage-quota.model.js';

export const STORAGE_QUOTA_BYTES: Readonly<Record<UserPlan, number>> = {
  free: 2 * 1024 ** 3,
  professional: 20 * 1024 ** 3,
  studio: 500 * 1024 ** 3,
  enterprise: 1024 ** 4,
};

@Injectable()
export class StorageQuotaService {
  constructor(
    private readonly appData: AppDataService,
    private readonly organizations: OrganizationsRepository,
    private readonly organizationAccess: OrganizationsService,
  ) {}

  async getUserUsage(userId: string): Promise<StorageUsageApi> {
    const profile = await this.appData.getUserProfile(userId);
    const plan = profile?.plan ?? 'free';
    const usedBytes = await this.organizations.getUserStorageUsageBytes(userId);
    return buildUsage(
      'user',
      userId,
      plan,
      STORAGE_QUOTA_BYTES[plan],
      usedBytes,
    );
  }

  async getOrganizationUsage(
    userId: string,
    organizationId: string,
  ): Promise<StorageUsageApi> {
    await this.organizationAccess.requireMember(userId, organizationId);
    return this.getOrganizationUsageInternal(organizationId);
  }

  async assertWithinQuota(
    userId: string,
    projectId: string,
    incomingBytes: number,
    replacingAssetId?: string,
  ): Promise<void> {
    if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0) {
      throw new BadRequestException(
        'Asset size must be a non-negative integer',
      );
    }

    const project = await this.appData.getProjectForUser(userId, projectId);
    if (!project) throw new NotFoundException('Project not found');

    const usage = project.organizationId
      ? await this.getOrganizationUsageInternal(project.organizationId)
      : await this.getUserUsage(project.ownerUserId);
    const existing = replacingAssetId
      ? await this.appData.getProjectAsset(replacingAssetId)
      : null;
    const replacedBytes =
      existing?.projectId === projectId ? (existing.sizeBytes ?? 0) : 0;
    const projectedBytes = usage.used_bytes - replacedBytes + incomingBytes;

    if (projectedBytes > usage.quota_bytes) {
      throw new PayloadTooLargeException({
        statusCode: 413,
        code: 'storage_quota_exceeded',
        message: 'Cloud storage quota exceeded',
        quota_bytes: usage.quota_bytes,
        used_bytes: usage.used_bytes,
        incoming_bytes: incomingBytes,
      });
    }
  }

  private async getOrganizationUsageInternal(
    organizationId: string,
  ): Promise<StorageUsageApi> {
    const organization =
      await this.organizationAccess.requireOrganization(organizationId);
    const ownerProfile = await this.appData.getUserProfile(
      organization.createdBy,
    );
    const plan = ownerProfile?.plan ?? 'free';
    const quotaBytes =
      organization.storageQuotaOverrideBytes ?? STORAGE_QUOTA_BYTES[plan];
    const usedBytes =
      await this.organizations.getOrganizationStorageUsageBytes(organizationId);
    return buildUsage(
      'organization',
      organizationId,
      plan,
      quotaBytes,
      usedBytes,
    );
  }
}

function buildUsage(
  scope: StorageUsageApi['scope'],
  subjectId: string,
  plan: UserPlan,
  quotaBytes: number,
  usedBytes: number,
): StorageUsageApi {
  const safeUsed = Math.max(0, usedBytes);
  return {
    scope,
    subject_id: subjectId,
    plan,
    quota_bytes: quotaBytes,
    used_bytes: safeUsed,
    remaining_bytes: Math.max(0, quotaBytes - safeUsed),
    percent_used:
      quotaBytes === 0
        ? 100
        : Math.round((safeUsed / quotaBytes) * 10_000) / 100,
  };
}
