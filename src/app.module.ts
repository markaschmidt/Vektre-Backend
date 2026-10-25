import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { UserModule } from './user/user.module.js';
import { GenerativeModelModule } from './generative-model/generative-model.module.js';
import { GoogleDriveModule } from './integrations/google-drive/google-drive.module.js';
import { NotionModule } from './integrations/notion/notion.module.js';
import { ObsidianModule } from './integrations/obsidian/obsidian.module.js';
import { outboundConfig } from './config/outbound.config.js';
import { integrationCryptoConfig } from './config/integration-crypto.config.js';
import { rigAnythingConfig } from './config/riganything.config.js';
import { mesh2MotionConfig } from './config/mesh2motion.config.js';
import { billingConfig } from './config/billing.config.js';
import { ProjectsModule } from './projects/projects.module.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { InvitesModule } from './invites/invites.module.js';
import { CollaborationDocumentsModule } from './collaboration-documents/collaboration-documents.module.js';
import { CanvasWorkflowsModule } from './canvas-workflows/canvas-workflows.module.js';
import { RiggingModule } from './rigging/rigging.module.js';
import { Mesh2MotionModule } from './mesh2motion/mesh2motion.module.js';
import { BillingModule } from './billing/billing.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { StorageQuotaModule } from './storage-quota/storage-quota.module.js';
import { orgIntegrationsConfig } from './config/org-integrations.config.js';
import { UiAgentModule } from './ui-agent/ui-agent.module.js';
import { uiAiConfig } from './config/ui-ai.config.js';
import { telemetryConfig } from './config/telemetry.config.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        outboundConfig,
        integrationCryptoConfig,
        rigAnythingConfig,
        mesh2MotionConfig,
        billingConfig,
        orgIntegrationsConfig,
        uiAiConfig,
        telemetryConfig,
      ],
    }),
    TelemetryModule,
    QueuesModule,
    IntegrationsModule,
    AuthModule,
    UserModule,
    BillingModule,
    OrganizationsModule,
    StorageQuotaModule,
    GenerativeModelModule,
    ProjectsModule,
    CollaborationModule,
    CollaborationDocumentsModule,
    UiAgentModule,
    CanvasWorkflowsModule,
    RiggingModule,
    Mesh2MotionModule,
    NotificationsModule,
    InvitesModule,
    GoogleDriveModule,
    NotionModule,
    ObsidianModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
