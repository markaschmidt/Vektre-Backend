import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppDataService } from '../integrations/app-data.service.js';
import { SupabaseService } from '../integrations/supabase.js';
import type {
  OrganizationMemberRow,
  OrganizationRole,
} from '../integrations/app-data.types.js';
import type {
  AddOrganizationMemberDto,
  CreateOrganizationDto,
  UpdateOrganizationDto,
  UpdateOrganizationMemberDto,
  UploadOrganizationLogoDto,
} from './dto/organization.dto.js';
import type {
  OrganizationDetails,
  OrganizationLogoUploadResponse,
  OrganizationWithRole,
} from './models/organization.model.js';
import {
  ORGANIZATION_LOGO_MAX_BYTES,
  ORGANIZATION_LOGO_MAX_PX,
  ORGANIZATION_LOGOS_BUCKET,
} from './models/organization.model.js';
import {
  assertLogoDimensionsWithinLimit,
  readOrganizationLogoDimensions,
} from './org-logo-image.js';
import { OrganizationsRepository } from './repositories/organizations.repository.js';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly appData: AppDataService,
    private readonly supabase: SupabaseService,
  ) {}

  async create(
    userId: string,
    dto: CreateOrganizationDto,
  ): Promise<OrganizationWithRole> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Organization name is required');

    const logo = normalizeOrganizationLogo(dto);
    const organizationId = randomUUID();
    const slug = buildSlug(dto.slug ?? name, organizationId);
    const organization = await this.organizations.createOrganization({
      organizationId,
      name,
      slug,
      createdBy: userId,
      ...logo,
    });

    try {
      await this.organizations.upsertMember({
        organizationId,
        userId,
        role: 'executive',
        addedByUserId: userId,
      });
    } catch (error) {
      await this.organizations.deleteOrganization(organizationId);
      throw error;
    }

    const profile = await this.appData.getUserProfile(userId);
    if (profile && !profile.organizationId) {
      await this.appData.upsertUserProfile({
        ...profile,
        organizationId,
        updatedAt: new Date(),
      });
    }

    return { ...organization, role: 'executive' };
  }

  async listForUser(userId: string): Promise<OrganizationWithRole[]> {
    const memberships = await this.organizations.listMembershipsForUser(userId);
    const byId = await this.organizations.getOrganizationsByIds(
      memberships.map((membership) => membership.organizationId),
    );
    return memberships.flatMap((membership) => {
      const organization = byId.get(membership.organizationId);
      return organization ? [{ ...organization, role: membership.role }] : [];
    });
  }

  async getForUser(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationDetails> {
    const membership = await this.requireMember(userId, organizationId);
    const organization = await this.requireOrganization(organizationId);
    const members = await this.organizations.listMembers(organizationId);
    return { ...organization, role: membership.role, members };
  }

  async update(
    userId: string,
    organizationId: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationWithRole> {
    const membership = await this.requireExecutive(userId, organizationId);
    await this.requireOrganization(organizationId);

    const patch: {
      name?: string;
      logoUrl?: string | null;
      logoWidth?: number | null;
      logoHeight?: number | null;
    } = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Organization name is required');
      patch.name = name;
    }

    if (
      dto.logoUrl !== undefined ||
      dto.logoWidth !== undefined ||
      dto.logoHeight !== undefined
    ) {
      Object.assign(patch, normalizeOrganizationLogo(dto));
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('No organization fields to update');
    }

    const organization = await this.organizations.updateOrganization(
      organizationId,
      patch,
    );
    return { ...organization, role: membership.role };
  }

  /**
   * Stage a logo for onboarding / create-org flows. Uploads via service role
   * and returns a public URL + dimensions to pass into POST /organizations.
   */
  async uploadLogo(
    userId: string,
    dto: UploadOrganizationLogoDto,
  ): Promise<OrganizationLogoUploadResponse> {
    return this.storeLogoBytes(userId, null, dto);
  }

  /**
   * Upload a logo for an existing organization and update its logo fields.
   * Executive-only.
   */
  async uploadLogoForOrganization(
    userId: string,
    organizationId: string,
    dto: UploadOrganizationLogoDto,
  ): Promise<OrganizationWithRole> {
    const membership = await this.requireExecutive(userId, organizationId);
    await this.requireOrganization(organizationId);
    const uploaded = await this.storeLogoBytes(userId, organizationId, dto);
    const organization = await this.organizations.updateOrganization(
      organizationId,
      {
        logoUrl: uploaded.logoUrl,
        logoWidth: uploaded.logoWidth,
        logoHeight: uploaded.logoHeight,
      },
    );
    return { ...organization, role: membership.role };
  }

  async addMember(
    actorUserId: string,
    organizationId: string,
    dto: AddOrganizationMemberDto,
  ): Promise<OrganizationMemberRow> {
    await this.requireExecutive(actorUserId, organizationId);
    return this.organizations.upsertMember({
      organizationId,
      userId: dto.userId.trim(),
      role: dto.role,
      addedByUserId: actorUserId,
    });
  }

  async updateMember(
    actorUserId: string,
    organizationId: string,
    memberUserId: string,
    dto: UpdateOrganizationMemberDto,
  ): Promise<OrganizationMemberRow> {
    await this.requireExecutive(actorUserId, organizationId);
    const existing = await this.organizations.getMembership(
      organizationId,
      memberUserId,
    );
    if (!existing || existing.status !== 'active') {
      throw new NotFoundException('Organization member not found');
    }
    if (existing.role === 'executive' && dto.role !== 'executive') {
      await this.assertNotLastExecutive(organizationId);
    }
    return this.organizations.upsertMember({
      organizationId,
      userId: memberUserId,
      role: dto.role,
      addedByUserId: existing.addedByUserId,
    });
  }

  async removeMember(
    actorUserId: string,
    organizationId: string,
    memberUserId: string,
  ): Promise<void> {
    await this.requireExecutive(actorUserId, organizationId);
    const existing = await this.organizations.getMembership(
      organizationId,
      memberUserId,
    );
    if (!existing || existing.status !== 'active') {
      throw new NotFoundException('Organization member not found');
    }
    if (existing.role === 'executive') {
      await this.assertNotLastExecutive(organizationId);
    }
    await this.organizations.removeMember(organizationId, memberUserId);
  }

  async requireMember(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMemberRow> {
    const membership = await this.organizations.getMembership(
      organizationId,
      userId,
    );
    if (!membership || membership.status !== 'active') {
      throw new NotFoundException('Organization not found');
    }
    return membership;
  }

  async requireExecutive(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMemberRow> {
    const membership = await this.requireMember(userId, organizationId);
    if (membership.role !== 'executive') {
      throw new ForbiddenException('Organization executive access required');
    }
    return membership;
  }

  async requireRole(
    userId: string,
    organizationId: string,
    roles: readonly OrganizationRole[],
  ): Promise<OrganizationMemberRow> {
    const membership = await this.requireMember(userId, organizationId);
    if (!roles.includes(membership.role)) {
      throw new ForbiddenException(
        'Organization role does not permit this action',
      );
    }
    return membership;
  }

  async requireOrganization(organizationId: string) {
    const organization =
      await this.organizations.getOrganization(organizationId);
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  private async assertNotLastExecutive(organizationId: string): Promise<void> {
    if ((await this.organizations.countActiveExecutives(organizationId)) <= 1) {
      throw new BadRequestException(
        'The last organization executive cannot be removed or demoted',
      );
    }
  }

  private async storeLogoBytes(
    userId: string,
    organizationId: string | null,
    dto: UploadOrganizationLogoDto,
  ): Promise<OrganizationLogoUploadResponse> {
    const bytes = Buffer.from(decodeBase64(dto.dataBase64));
    if (bytes.byteLength === 0) {
      throw new BadRequestException('Logo payload is empty');
    }
    if (bytes.byteLength > ORGANIZATION_LOGO_MAX_BYTES) {
      throw new BadRequestException(
        `Logo must be at most ${ORGANIZATION_LOGO_MAX_BYTES} bytes`,
      );
    }

    assertLogoDimensionsWithinLimit(dto.logoWidth, dto.logoHeight);
    const measured = readOrganizationLogoDimensions(bytes, dto.mimeType);
    if (
      measured.width !== dto.logoWidth ||
      measured.height !== dto.logoHeight
    ) {
      throw new BadRequestException(
        `Declared logo size ${dto.logoWidth}x${dto.logoHeight} does not match image ${measured.width}x${measured.height}`,
      );
    }
    assertLogoDimensionsWithinLimit(measured.width, measured.height);

    const extension = extensionForMime(dto.mimeType);
    const objectPath = organizationId
      ? `${organizationId}/${randomUUID()}.${extension}`
      : `staging/${userId}/${randomUUID()}.${extension}`;

    await this.supabase.uploadObject(
      objectPath,
      bytes,
      dto.mimeType,
      ORGANIZATION_LOGOS_BUCKET,
    );
    const logoUrl = this.supabase.getPublicObjectUrl(
      objectPath,
      ORGANIZATION_LOGOS_BUCKET,
    );

    return {
      logoUrl,
      logoWidth: measured.width,
      logoHeight: measured.height,
      objectPath,
      mimeType: dto.mimeType,
      sizeBytes: bytes.byteLength,
    };
  }
}

function buildSlug(value: string, organizationId: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!base) throw new BadRequestException('Organization slug is invalid');
  return `${base}-${organizationId.slice(0, 8)}`;
}

function normalizeOrganizationLogo(input: {
  logoUrl?: string | null;
  logoWidth?: number | null;
  logoHeight?: number | null;
}): {
  logoUrl: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
} {
  if (input.logoUrl === null) {
    if (input.logoWidth != null || input.logoHeight != null) {
      throw new BadRequestException(
        'Clearing logoUrl requires logoWidth and logoHeight to be null or omitted',
      );
    }
    return { logoUrl: null, logoWidth: null, logoHeight: null };
  }

  if (input.logoUrl === undefined) {
    if (input.logoWidth != null || input.logoHeight != null) {
      throw new BadRequestException(
        'logoWidth and logoHeight require logoUrl',
      );
    }
    return { logoUrl: null, logoWidth: null, logoHeight: null };
  }

  const logoUrl = input.logoUrl.trim();
  if (!logoUrl) {
    throw new BadRequestException('logoUrl must be a non-empty URL');
  }
  if (input.logoWidth == null || input.logoHeight == null) {
    throw new BadRequestException(
      `logoUrl requires logoWidth and logoHeight (1–${ORGANIZATION_LOGO_MAX_PX})`,
    );
  }
  assertLogoDimension('logoWidth', input.logoWidth);
  assertLogoDimension('logoHeight', input.logoHeight);
  return {
    logoUrl,
    logoWidth: input.logoWidth,
    logoHeight: input.logoHeight,
  };
}

function assertLogoDimension(field: string, value: number): void {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > ORGANIZATION_LOGO_MAX_PX
  ) {
    throw new BadRequestException(
      `${field} must be an integer between 1 and ${ORGANIZATION_LOGO_MAX_PX}`,
    );
  }
}

function decodeBase64(dataBase64: string): Uint8Array {
  const normalized = dataBase64.includes(',')
    ? dataBase64.slice(dataBase64.indexOf(',') + 1)
    : dataBase64;
  return Buffer.from(normalized, 'base64');
}

function extensionForMime(
  mimeType: UploadOrganizationLogoDto['mimeType'],
): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
  }
}

