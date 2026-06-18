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
import { ProjectsModule } from './projects/projects.module.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [outboundConfig],
    }),
    QueuesModule,
    IntegrationsModule,
    AuthModule,
    UserModule,
    GenerativeModelModule,
    ProjectsModule,
    CollaborationModule,
    NotificationsModule,
    GoogleDriveModule,
    NotionModule,
    ObsidianModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
