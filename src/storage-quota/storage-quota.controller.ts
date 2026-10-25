import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';
import { StorageQuotaService } from './storage-quota.service.js';

@Controller()
export class StorageQuotaController {
  constructor(private readonly storageQuota: StorageQuotaService) {}

  @Get('storage/me')
  getUserUsage(@CurrentUser() user: AuthenticatedUser) {
    return this.storageQuota.getUserUsage(user.id);
  }

  @Get('organizations/:organizationId/storage')
  getOrganizationUsage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ) {
    return this.storageQuota.getOrganizationUsage(user.id, organizationId);
  }
}
