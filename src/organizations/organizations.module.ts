import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ORG_INTEGRATION_OPS_QUEUE } from '../queues/queue-names.js';
import { OrgIntegrationProviderService } from './integrations/org-integration-provider.service.js';
import { OrgIntegrationsController } from './integrations/org-integrations.controller.js';
import { OrgIntegrationsProcessor } from './integrations/org-integrations.processor.js';
import { OrgIntegrationsService } from './integrations/org-integrations.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { OrganizationsRepository } from './repositories/organizations.repository.js';

@Module({
  imports: [
    IntegrationsModule,
    BullModule.registerQueue({ name: ORG_INTEGRATION_OPS_QUEUE }),
  ],
  controllers: [OrganizationsController, OrgIntegrationsController],
  providers: [
    OrganizationsRepository,
    OrganizationsService,
    OrgIntegrationProviderService,
    OrgIntegrationsService,
    OrgIntegrationsProcessor,
  ],
  exports: [OrganizationsRepository, OrganizationsService],
})
export class OrganizationsModule {}
