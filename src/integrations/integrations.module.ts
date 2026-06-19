import { Module } from '@nestjs/common';
import { AppDataService } from './app-data.service.js';
import { SupabaseService } from './supabase.js';
import { IntegrationCryptoService } from './integration-crypto.service.js';
import { ProviderCredentialService } from './provider-credential.service.js';

@Module({
  providers: [
    SupabaseService,
    AppDataService,
    IntegrationCryptoService,
    ProviderCredentialService,
  ],
  exports: [
    SupabaseService,
    AppDataService,
    IntegrationCryptoService,
    ProviderCredentialService,
  ],
})
export class IntegrationsModule {}
