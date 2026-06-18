import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';

@Module({
  imports: [IntegrationsModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
  exports: [],
})
export class AuthModule {}
