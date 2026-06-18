import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { USER_OPS_QUEUE } from '../queues/queue-names.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { bullJobId } from '../queues/bull-job-id.js';
import { defaultJobOptions } from '../queues/job-options.js';
import type { UserOnboardingPreferences } from '../integrations/app-data.types.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import type {
  SyncProviderDocumentsJob,
  RecalculatePreferencesJob,
} from './models/user-op-job.model.js';
import {
  buildDisplayName,
  mergeProfilePatch,
} from './user-profile.helpers.js';
import {
  toUserProfileApiResponse,
  type UserProfileApiResponse,
} from './models/user-profile-api.model.js';

const PERSONAL_OR_INDIE_PLANS = new Set(['indie_free', 'indie_pro']);
const ENTERPRISE_PLANS = new Set(['corp_starter', 'corp_team', 'corp_enterprise']);

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectQueue(USER_OPS_QUEUE)
    private readonly userOpsQueue: Queue,
    private readonly appData: AppDataService,
  ) {}

  /**
   * Returns the app profile. No row → 404 so the client can route to /onboarding.
   * Does not auto-create a profile stub.
   */
  async getProfile(userId: string): Promise<UserProfileApiResponse> {
    const existing = await this.appData.getUserProfile(userId);
    if (!existing) {
      throw new NotFoundException('Profile not found');
    }
    return toUserProfileApiResponse(existing);
  }

  /**
   * Creates or updates the profile. Onboarding completes via PATCH with
   * preferences.onboardingCompleted = true.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileApiResponse> {
    const existing = await this.appData.getUserProfile(userId);
    const prefs = this.normalizePreferences(dto.preferences as UserOnboardingPreferences | undefined);
    if (
      prefs?.onboardingCompleted === true &&
      dto.plan !== undefined &&
      prefs.selectedPlan !== undefined &&
      dto.plan !== prefs.selectedPlan
    ) {
      throw new BadRequestException('plan must match preferences.selectedPlan');
    }

    const displayName = buildDisplayName(
      dto.displayName,
      prefs?.firstName,
      prefs?.lastName,
      existing?.displayName,
    );

    const profile = mergeProfilePatch(userId, existing, {
      displayName,
      avatarUrl: dto.avatarUrl,
      plan: dto.plan,
      preferences: prefs,
    });

    await this.appData.upsertUserProfile(profile);

    if (prefs?.onboardingCompleted === true) {
      this.logger.log(`Onboarding completed for user ${userId}`);
    }

    if (prefs && Object.keys(prefs).length > 0) {
      const requestId = randomUUID();
      const jobId = bullJobId('user', userId, 'prefs', requestId);
      const payload: RecalculatePreferencesJob = { userId, requestId };

      await this.appData.createRequestStatus({
        requestId,
        userId,
        type: 'recalculate-preferences',
        status: 'queued',
      });

      await this.userOpsQueue.add('recalculate-preferences', payload, {
        ...defaultJobOptions,
        jobId,
      });
    }

    const saved = await this.appData.getUserProfile(userId);
    return toUserProfileApiResponse(saved!);
  }

  /**
   * Queue a provider document sync (e.g. Google Drive).
   */
  async syncProviderDocuments(
    userId: string,
    provider: string,
  ): Promise<{ requestId: string; status: string }> {
    const requestId = randomUUID();
    const jobId = bullJobId('user', userId, 'sync', provider, requestId);

    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: 'sync-provider-documents',
      status: 'queued',
    });

    const payload: SyncProviderDocumentsJob = { userId, provider, requestId };
    await this.userOpsQueue.add('sync-provider-documents', payload, {
      ...defaultJobOptions,
      jobId,
    });

    this.logger.log(`Enqueued provider sync: ${jobId}`);
    return { requestId, status: 'queued' };
  }

  private normalizePreferences(
    prefs: UserOnboardingPreferences | undefined,
  ): UserOnboardingPreferences | undefined {
    if (!prefs) return undefined;

    const normalized: UserOnboardingPreferences = {
      ...prefs,
      firstName: normalizeText(prefs.firstName),
      lastName: normalizeText(prefs.lastName),
      role: normalizeText(prefs.role),
      company: normalizeOptionalText(prefs.company),
    };

    if (normalized.onboardingCompleted === true) {
      this.assertValidOnboardingPreferences(normalized);
    }

    return normalized;
  }

  private assertValidOnboardingPreferences(
    prefs: UserOnboardingPreferences,
  ): void {
    const missing = [
      ['firstName', prefs.firstName],
      ['lastName', prefs.lastName],
      ['role', prefs.role],
      ['userType', prefs.userType],
      ['useCase', prefs.useCase],
      ['selectedPlan', prefs.selectedPlan],
    ]
      .filter(([, value]) => !value)
      .map(([field]) => field);

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required onboarding field(s): ${missing.join(', ')}`,
      );
    }

    const selectedPlan = prefs.selectedPlan!;
    if (
      (prefs.userType === 'personal' || prefs.userType === 'indie') &&
      !PERSONAL_OR_INDIE_PLANS.has(selectedPlan)
    ) {
      throw new BadRequestException(
        'selectedPlan must be indie_free or indie_pro for personal/indie users',
      );
    }

    if (prefs.userType === 'enterprise' && !ENTERPRISE_PLANS.has(selectedPlan)) {
      throw new BadRequestException(
        'selectedPlan must be corp_starter, corp_team, or corp_enterprise for enterprise users',
      );
    }
  }
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized === '' ? undefined : normalized;
}
