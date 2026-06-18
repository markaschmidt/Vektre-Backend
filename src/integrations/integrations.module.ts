import { Module } from '@nestjs/common';
import { AppDataService } from './app-data.service.js';
import { SupabaseService } from './supabase.js';

@Module({
  providers: [SupabaseService, AppDataService],
  exports: [SupabaseService, AppDataService],
})
export class IntegrationsModule {}
