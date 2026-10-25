import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { AppDataService } from '../../integrations/app-data.service.js';
import type { OrganizationProvider } from '../../integrations/app-data.types.js';
import { IntegrationCryptoService } from '../../integrations/integration-crypto.service.js';
import { bullJobId } from '../../queues/bull-job-id.js';
import { defaultJobOptions } from '../../queues/job-options.js';
import {
  JOB_ORG_INTEGRATION_VALIDATE,
  ORG_INTEGRATION_OPS_QUEUE,
} from '../../queues/queue-names.js';
import type {
  ExchangeOrganizationOAuthDto,
  UpsertGitLfsIntegrationDto,
  UpsertPerforceIntegrationDto,
} from '../dto/organization.dto.js';
import { ORGANIZATION_PROVIDERS } from '../models/organization.model.js';
import { OrganizationsService } from '../organizations.service.js';
import { OrganizationsRepository } from '../repositories/organizations.repository.js';
import { OrgIntegrationProviderService } from './org-integration-provider.service.js';

export interface ValidateOrgIntegrationJob {
  requestId: string;
  actorUserId: string;
  organizationId: string;
  provider: OrganizationProvider;
}

@Injectable()
export class OrgIntegrationsService {
  constructor(
    @InjectQueue(ORG_INTEGRATION_OPS_QUEUE)
    private readonly integrationQueue: Queue,
    private readonly organizationAccess: OrganizationsService,
    private readonly organizations: OrganizationsRepository,
    private readonly crypto: IntegrationCryptoService,
    private readonly provider: OrgIntegrationProviderService,
    private readonly appData: AppDataService,
  ) {}

  async list(userId: string, organizationId: string) {
    await this.organizationAccess.requireRole(userId, organizationId, [
      'executive',
      'contributor',
      'inspector',
    ]);
    const rows =
      await this.organizations.listProviderCredentials(organizationId);
    const byProvider = new Map(rows.map((row) => [row.provider, row]));
    return ORGANIZATION_PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      return {
        provider,
        connected: row?.status === 'connected',
        status: row?.status ?? 'disconnected',
        metadata: row?.metadata ?? {},
        updated_at: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async exchangeGitHub(
    userId: string,
    organizationId: string,
    dto: ExchangeOrganizationOAuthDto,
  ) {
    await this.organizationAccess.requireExecutive(userId, organizationId);
    const result = await this.provider.exchangeGitHubCode(
      dto.code,
      dto.redirectUri,
    );
    await this.saveCredential(
      userId,
      organizationId,
      'github',
      result.payload,
      result.metadata,
    );
    return { provider: 'github', connected: true, metadata: result.metadata };
  }

  async exchangeFigma(
    userId: string,
    organizationId: string,
    dto: ExchangeOrganizationOAuthDto,
  ) {
    await this.organizationAccess.requireExecutive(userId, organizationId);
    const result = await this.provider.exchangeFigmaCode(
      dto.code,
      dto.redirectUri,
    );
    await this.saveCredential(
      userId,
      organizationId,
      'figma',
      result.payload,
      result.metadata,
    );
    return { provider: 'figma', connected: true, metadata: result.metadata };
  }

  async upsertPerforce(
    userId: string,
    organizationId: string,
    dto: UpsertPerforceIntegrationDto,
  ) {
    await this.organizationAccess.requireExecutive(userId, organizationId);
    const metadata = {
      serverUrl: dto.serverUrl,
      username: dto.username,
      workspace: dto.workspace ?? null,
    };
    await this.saveCredential(
      userId,
      organizationId,
      'perforce',
      { ...metadata, credential: dto.credential },
      metadata,
    );
    return { provider: 'perforce', connected: true, metadata };
  }

  async upsertGitLfs(
    userId: string,
    organizationId: string,
    dto: UpsertGitLfsIntegrationDto,
  ) {
    await this.organizationAccess.requireExecutive(userId, organizationId);
    const metadata = {
      endpoint: dto.endpoint,
      ...(dto.metadata ?? {}),
    };
    await this.saveCredential(
      userId,
      organizationId,
      'git_lfs',
      {
        endpoint: dto.endpoint,
        username: dto.username,
        token: dto.token,
      },
      metadata,
    );
    return { provider: 'git_lfs', connected: true, metadata };
  }

  async disconnect(
    userId: string,
    organizationId: string,
    provider: OrganizationProvider,
  ): Promise<void> {
    await this.organizationAccess.requireExecutive(userId, organizationId);
    await this.requireCredential(organizationId, provider);
    await this.organizations.disconnectProvider(
      organizationId,
      provider,
      userId,
    );
  }

  async enqueueValidation(
    userId: string,
    organizationId: string,
    provider: OrganizationProvider,
  ) {
    await this.organizationAccess.requireExecutive(userId, organizationId);
    await this.requireCredential(organizationId, provider);
    const requestId = randomUUID();
    const job: ValidateOrgIntegrationJob = {
      requestId,
      actorUserId: userId,
      organizationId,
      provider,
    };
    await this.appData.createRequestStatus({
      requestId,
      userId,
      type: JOB_ORG_INTEGRATION_VALIDATE,
      status: 'queued',
      outputRef: `organization:${organizationId}:integration:${provider}`,
    });
    await this.integrationQueue.add(JOB_ORG_INTEGRATION_VALIDATE, job, {
      ...defaultJobOptions,
      jobId: bullJobId('org-integration', organizationId, provider, requestId),
    });
    return { requestId, status: 'queued' as const };
  }

  async getValidationStatus(
    userId: string,
    organizationId: string,
    requestId: string,
  ) {
    await this.organizationAccess.requireExecutive(userId, organizationId);
    const row = await this.appData.getRequestStatus(requestId);
    const expectedOutput = `organization:${organizationId}:integration:`;
    if (
      !row ||
      row.type !== JOB_ORG_INTEGRATION_VALIDATE ||
      !row.outputRef?.startsWith(expectedOutput)
    ) {
      throw new NotFoundException('Integration validation request not found');
    }
    return {
      request_id: row.requestId,
      status: row.status,
      error_message: row.errorMessage ?? null,
      updated_at: row.updatedAt.toISOString(),
    };
  }

  async processValidation(job: ValidateOrgIntegrationJob): Promise<void> {
    await this.organizationAccess.requireExecutive(
      job.actorUserId,
      job.organizationId,
    );
    const row = await this.requireCredential(job.organizationId, job.provider);
    const payload = this.decryptPayload(row.encryptedPayload);
    try {
      const providerMetadata = await this.provider.validate(
        job.provider,
        payload,
      );
      await this.organizations.updateProviderStatus(
        job.organizationId,
        job.provider,
        'connected',
        { ...row.metadata, ...providerMetadata },
      );
    } catch (error) {
      await this.organizations.updateProviderStatus(
        job.organizationId,
        job.provider,
        'invalid',
        row.metadata,
      );
      throw error;
    }
  }

  async listGitHubRepositories(userId: string, organizationId: string) {
    await this.organizationAccess.requireRole(userId, organizationId, [
      'executive',
      'contributor',
    ]);
    return this.provider.listGitHubRepositories(
      await this.getPayload(organizationId, 'github'),
    );
  }

  async listFigmaTeamProjects(
    userId: string,
    organizationId: string,
    teamId: string,
  ) {
    await this.organizationAccess.requireRole(userId, organizationId, [
      'executive',
      'contributor',
    ]);
    return this.provider.listFigmaTeamProjects(
      await this.getPayload(organizationId, 'figma'),
      teamId,
    );
  }

  async listFigmaProjectFiles(
    userId: string,
    organizationId: string,
    projectId: string,
  ) {
    await this.organizationAccess.requireRole(userId, organizationId, [
      'executive',
      'contributor',
    ]);
    return this.provider.listFigmaProjectFiles(
      await this.getPayload(organizationId, 'figma'),
      projectId,
    );
  }

  private async saveCredential(
    userId: string,
    organizationId: string,
    provider: OrganizationProvider,
    payload: Record<string, unknown>,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.organizations.upsertProviderCredential({
      organizationId,
      provider,
      encryptedPayload: this.crypto.encrypt(JSON.stringify(payload)),
      status: 'connected',
      metadata,
      updatedBy: userId,
    });
  }

  private async getPayload(
    organizationId: string,
    provider: OrganizationProvider,
  ) {
    const row = await this.requireCredential(organizationId, provider);
    return this.decryptPayload(row.encryptedPayload);
  }

  private async requireCredential(
    organizationId: string,
    provider: OrganizationProvider,
  ) {
    const row = await this.organizations.getProviderCredential(
      organizationId,
      provider,
    );
    if (!row || row.status === 'disconnected' || !row.encryptedPayload) {
      throw new NotFoundException('Organization integration is not connected');
    }
    return row;
  }

  private decryptPayload(encryptedPayload: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(this.crypto.decrypt(encryptedPayload));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored organization integration payload is invalid');
    }
    return parsed as Record<string, unknown>;
  }
}
