import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { StorageQuotaController } from './storage-quota.controller.js';
import { StorageQuotaService } from './storage-quota.service.js';

@Module({
  imports: [IntegrationsModule, OrganizationsModule],
  controllers: [StorageQuotaController],
  providers: [StorageQuotaService],
  exports: [StorageQuotaService],
})
export class StorageQuotaModule {}
