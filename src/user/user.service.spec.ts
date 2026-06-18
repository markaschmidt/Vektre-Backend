import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { UserService } from './user.service.js';
import { AppDataService } from '../integrations/app-data.service.js';
import { USER_OPS_QUEUE } from '../queues/queue-names.js';

const mockQueue = { add: jest.fn() };
const mockAppData = {
  upsertUserProfile: jest.fn(),
  createRequestStatus: jest.fn(),
  getUserProfile: jest.fn(),
};

const savedProfile = {
  userId: 'user-1',
  displayName: 'Mark Schmidt',
  avatarUrl: 'https://example.com/a.png',
  plan: 'indie_pro' as const,
  preferences: {
    onboardingCompleted: true,
    firstName: 'Mark',
    lastName: 'Schmidt',
    role: 'Developer',
    userType: 'indie' as const,
    useCase: 'game_development' as const,
    company: 'Optional Studio',
    selectedPlan: 'indie_pro' as const,
  },
  organizationId: null,
  storageId: null,
  onDemand: { monthlyCap: null },
  createdAt: new Date('2026-06-09T00:00:00Z'),
  updatedAt: new Date('2026-06-09T01:00:00Z'),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getQueueToken(USER_OPS_QUEUE), useValue: mockQueue },
        { provide: AppDataService, useValue: mockAppData },
      ],
    }).compile();
    service = module.get(UserService);
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('returns 404 when no profile row exists', async () => {
      mockAppData.getUserProfile.mockResolvedValue(null);
      await expect(service.getProfile('user-1')).rejects.toThrow(NotFoundException);
    });

    it('returns snake_case API profile when a row exists', async () => {
      mockAppData.getUserProfile.mockResolvedValue(savedProfile);
      const result = await service.getProfile('user-1');
      expect(result).toEqual(
        expect.objectContaining({
          id: 'user-1',
          display_name: 'Mark Schmidt',
          onboarding_completed: true,
          plan: 'indie_pro',
          preferences: expect.objectContaining({
            firstName: 'Mark',
            selectedPlan: 'indie_pro',
          }),
        }),
      );
      expect(result.preferences).not.toHaveProperty('onboardingCompleted');
    });
  });

  describe('updateProfile', () => {
    it('creates a profile on first PATCH (onboarding)', async () => {
      mockAppData.getUserProfile
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(savedProfile);

      const result = await service.updateProfile('user-1', {
        displayName: 'Mark Schmidt',
        avatarUrl: 'https://example.com/a.png',
        plan: 'indie_pro',
        preferences: {
          onboardingCompleted: true,
          firstName: 'Mark',
          lastName: 'Schmidt',
          role: 'Developer',
          userType: 'indie',
          useCase: 'game_development',
          company: 'Optional Studio',
          selectedPlan: 'indie_pro',
        },
      });

      expect(mockAppData.upsertUserProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          plan: 'indie_pro',
          preferences: expect.objectContaining({ onboardingCompleted: true }),
        }),
      );
      expect(result.onboarding_completed).toBe(true);
    });

    it('enqueues preference recalculation when preferences are provided', async () => {
      mockAppData.getUserProfile
        .mockResolvedValueOnce(savedProfile)
        .mockResolvedValueOnce(savedProfile);

      await service.updateProfile('user-1', {
        preferences: { company: 'New Studio' },
      });

      expect(mockAppData.createRequestStatus).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'recalculate-preferences',
        expect.objectContaining({ userId: 'user-1' }),
        expect.objectContaining({ jobId: expect.stringContaining('user-user-1-prefs-') }),
      );
    });

    it('rejects completed onboarding when required fields are missing', async () => {
      mockAppData.getUserProfile.mockResolvedValue(null);

      await expect(
        service.updateProfile('user-1', {
          preferences: {
            onboardingCompleted: true,
            firstName: 'Mark',
            lastName: 'Schmidt',
            userType: 'indie',
            useCase: 'game_development',
            selectedPlan: 'indie_pro',
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects enterprise onboarding with an indie plan', async () => {
      mockAppData.getUserProfile.mockResolvedValue(null);

      await expect(
        service.updateProfile('user-1', {
          plan: 'indie_pro',
          preferences: {
            onboardingCompleted: true,
            firstName: 'Mark',
            lastName: 'Schmidt',
            role: 'Developer',
            userType: 'enterprise',
            useCase: 'game_development',
            selectedPlan: 'indie_pro',
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects onboarding when top-level plan conflicts with selectedPlan', async () => {
      mockAppData.getUserProfile.mockResolvedValue(null);

      await expect(
        service.updateProfile('user-1', {
          plan: 'indie_free',
          preferences: {
            onboardingCompleted: true,
            firstName: 'Mark',
            lastName: 'Schmidt',
            role: 'Developer',
            userType: 'indie',
            useCase: 'game_development',
            selectedPlan: 'indie_pro',
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('syncProviderDocuments', () => {
    it('creates a status row and enqueues the sync job with a stable jobId', async () => {
      const result = await service.syncProviderDocuments('user-1', 'google');
      expect(mockAppData.createRequestStatus).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', type: 'sync-provider-documents', status: 'queued' }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'sync-provider-documents',
        expect.objectContaining({ provider: 'google' }),
        expect.objectContaining({ jobId: expect.stringContaining('user-user-1-sync-google-') }),
      );
      expect(result.status).toBe('queued');
    });
  });
});
