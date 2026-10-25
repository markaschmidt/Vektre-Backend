import { ForbiddenException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AppDataService } from '../../integrations/app-data.service.js';
import type { IntegrationCryptoService } from '../../integrations/integration-crypto.service.js';
import type { OrganizationsService } from '../organizations.service.js';
import type { OrganizationsRepository } from '../repositories/organizations.repository.js';
import type { OrgIntegrationProviderService } from './org-integration-provider.service.js';
import { OrgIntegrationsService } from './org-integrations.service.js';

describe('OrgIntegrationsService', () => {
  const queue = { add: jest.fn() };
  const access = {
    requireMember: jest.fn(),
    requireExecutive: jest.fn(),
    requireRole: jest.fn(),
  };
  const repository = {
    listProviderCredentials: jest.fn(),
    getProviderCredential: jest.fn(),
    upsertProviderCredential: jest.fn(),
    disconnectProvider: jest.fn(),
  };
  const crypto = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn((value: string) => value.replace('encrypted:', '')),
  };
  const provider = {};
  const appData = {
    createRequestStatus: jest.fn(),
    getRequestStatus: jest.fn(),
  };
  let service: OrgIntegrationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrgIntegrationsService(
      queue as unknown as Queue,
      access as unknown as OrganizationsService,
      repository as unknown as OrganizationsRepository,
      crypto as unknown as IntegrationCryptoService,
      provider as unknown as OrgIntegrationProviderService,
      appData as unknown as AppDataService,
    );
  });

  it('lists only non-secret integration status and metadata', async () => {
    repository.listProviderCredentials.mockResolvedValue([
      {
        provider: 'github',
        encryptedPayload: 'encrypted:secret',
        status: 'connected',
        metadata: { account: 'vektre' },
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);

    const result = await service.list('user-1', 'org-1');

    expect(result[0]).toEqual(
      expect.objectContaining({
        provider: 'github',
        connected: true,
        metadata: { account: 'vektre' },
      }),
    );
    expect(result[0]).not.toHaveProperty('encryptedPayload');
  });

  it('enqueues validation with durable request status', async () => {
    repository.getProviderCredential.mockResolvedValue({
      provider: 'perforce',
      encryptedPayload: 'encrypted:{}',
      status: 'connected',
    });

    const result = await service.enqueueValidation(
      'user-1',
      'org-1',
      'perforce',
    );

    expect(appData.createRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: result.requestId,
        status: 'queued',
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'org-integration-validate',
      expect.objectContaining({
        organizationId: 'org-1',
        provider: 'perforce',
      }),
      expect.any(Object),
    );
    const addCall = queue.add.mock.calls[0] as unknown as [
      string,
      unknown,
      { jobId: string },
    ];
    expect(addCall[2].jobId).toContain('org-integration');
  });

  it('returns validation status only for the requested organization', async () => {
    appData.getRequestStatus.mockResolvedValue({
      requestId: 'request-1',
      type: 'org-integration-validate',
      status: 'completed',
      outputRef: 'organization:org-1:integration:github',
      updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    });

    await expect(
      service.getValidationStatus('user-1', 'org-1', 'request-1'),
    ).resolves.toEqual({
      request_id: 'request-1',
      status: 'completed',
      error_message: null,
      updated_at: '2026-08-09T00:00:00.000Z',
    });
    expect(access.requireExecutive).toHaveBeenCalledWith('user-1', 'org-1');
  });

  it('does not disconnect a provider when the caller is not an executive', async () => {
    access.requireExecutive.mockRejectedValueOnce(
      new ForbiddenException('Organization executive access required'),
    );

    await expect(
      service.disconnect('user-1', 'org-1', 'github'),
    ).rejects.toThrow(ForbiddenException);
    expect(repository.disconnectProvider).not.toHaveBeenCalled();
  });
});
