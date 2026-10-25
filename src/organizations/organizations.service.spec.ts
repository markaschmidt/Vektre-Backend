import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { SupabaseService } from '../integrations/supabase.js';
import { OrganizationsService } from './organizations.service.js';
import type { OrganizationsRepository } from './repositories/organizations.repository.js';

/** 1×1 opaque PNG */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('OrganizationsService', () => {
  const repository = {
    createOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    deleteOrganization: jest.fn(),
    upsertMember: jest.fn(),
    getMembership: jest.fn(),
    countActiveExecutives: jest.fn(),
    getOrganization: jest.fn(),
    listMembers: jest.fn(),
    listMembershipsForUser: jest.fn(),
    getOrganizationsByIds: jest.fn(),
    removeMember: jest.fn(),
  };
  const appData = {
    getUserProfile: jest.fn(),
    upsertUserProfile: jest.fn(),
  };
  const supabase = {
    uploadObject: jest.fn().mockResolvedValue(undefined),
    getPublicObjectUrl: jest
      .fn()
      .mockReturnValue('https://cdn.example.com/org-logos/staging/user-1/a.png'),
  };
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrganizationsService(
      repository as unknown as OrganizationsRepository,
      appData as unknown as AppDataService,
      supabase as unknown as SupabaseService,
    );
  });

  it('creates an organization with the caller as executive', async () => {
    repository.createOrganization.mockImplementation(
      (input: {
        organizationId: string;
        name: string;
        slug: string;
        createdBy: string;
      }) =>
        Promise.resolve({
          ...input,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    );
    repository.upsertMember.mockResolvedValue({ role: 'executive' });
    appData.getUserProfile.mockResolvedValue({
      userId: 'user-1',
      preferences: {},
      onDemand: { monthlyCap: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create('user-1', { name: 'Acme Studio' });

    expect(result.role).toBe('executive');
    expect(repository.upsertMember).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        role: 'executive',
      }),
    );
    expect(appData.upsertUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: result.organizationId }),
    );
  });

  it('denies organization administration to non-executives', async () => {
    repository.getMembership.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'contributor',
      status: 'active',
    });

    await expect(service.requireExecutive('user-1', 'org-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('prevents demoting the last executive', async () => {
    repository.getMembership
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        userId: 'actor',
        role: 'executive',
        status: 'active',
      })
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        userId: 'actor',
        role: 'executive',
        status: 'active',
        addedByUserId: 'actor',
      });
    repository.countActiveExecutives.mockResolvedValue(1);

    await expect(
      service.updateMember('actor', 'org-1', 'actor', {
        role: 'contributor',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.upsertMember).not.toHaveBeenCalled();
  });

  it('creates an organization with a logo at most 128x128', async () => {
    repository.createOrganization.mockImplementation((input: object) =>
      Promise.resolve({
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    repository.upsertMember.mockResolvedValue({ role: 'executive' });
    appData.getUserProfile.mockResolvedValue({
      userId: 'user-1',
      preferences: {},
      onDemand: { monthlyCap: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.create('user-1', {
      name: 'Acme Studio',
      logoUrl: 'https://cdn.example.com/acme.png',
      logoWidth: 128,
      logoHeight: 64,
    });

    expect(repository.createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: 'https://cdn.example.com/acme.png',
        logoWidth: 128,
        logoHeight: 64,
      }),
    );
  });

  it('rejects logos larger than 128px', async () => {
    await expect(
      service.create('user-1', {
        name: 'Acme Studio',
        logoUrl: 'https://cdn.example.com/acme.png',
        logoWidth: 256,
        logoHeight: 128,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.createOrganization).not.toHaveBeenCalled();
  });

  it('updates organization logo for executives', async () => {
    repository.getMembership.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'executive',
      status: 'active',
    });
    repository.getOrganization.mockResolvedValue({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repository.updateOrganization.mockResolvedValue({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      createdBy: 'user-1',
      logoUrl: 'https://cdn.example.com/logo.png',
      logoWidth: 96,
      logoHeight: 96,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.update('user-1', 'org-1', {
      logoUrl: 'https://cdn.example.com/logo.png',
      logoWidth: 96,
      logoHeight: 96,
    });

    expect(result.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(repository.updateOrganization).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        logoUrl: 'https://cdn.example.com/logo.png',
        logoWidth: 96,
        logoHeight: 96,
      }),
    );
  });

  it('uploads a staged logo via Nest storage (not client Supabase)', async () => {
    const result = await service.uploadLogo('user-1', {
      dataBase64: PNG_1X1_BASE64,
      mimeType: 'image/png',
      logoWidth: 1,
      logoHeight: 1,
    });

    expect(supabase.uploadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^staging\/user-1\/.+\.png$/),
      expect.any(Buffer),
      'image/png',
      'org-logos',
    );
    expect(result).toEqual(
      expect.objectContaining({
        logoUrl: 'https://cdn.example.com/org-logos/staging/user-1/a.png',
        logoWidth: 1,
        logoHeight: 1,
        mimeType: 'image/png',
      }),
    );
  });

  it('rejects staged logo when declared size mismatches bytes', async () => {
    await expect(
      service.uploadLogo('user-1', {
        dataBase64: PNG_1X1_BASE64,
        mimeType: 'image/png',
        logoWidth: 64,
        logoHeight: 64,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(supabase.uploadObject).not.toHaveBeenCalled();
  });

  it('uploads logo for an organization and updates the row', async () => {
    repository.getMembership.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'executive',
      status: 'active',
    });
    repository.getOrganization.mockResolvedValue({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repository.updateOrganization.mockResolvedValue({
      organizationId: 'org-1',
      name: 'Acme',
      slug: 'acme',
      createdBy: 'user-1',
      logoUrl: 'https://cdn.example.com/org-logos/staging/user-1/a.png',
      logoWidth: 1,
      logoHeight: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.uploadLogoForOrganization('user-1', 'org-1', {
      dataBase64: PNG_1X1_BASE64,
      mimeType: 'image/png',
      logoWidth: 1,
      logoHeight: 1,
    });

    expect(supabase.uploadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^org-1\/.+\.png$/),
      expect.any(Buffer),
      'image/png',
      'org-logos',
    );
    expect(repository.updateOrganization).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        logoUrl: 'https://cdn.example.com/org-logos/staging/user-1/a.png',
        logoWidth: 1,
        logoHeight: 1,
      }),
    );
    expect(result.role).toBe('executive');
  });
});
