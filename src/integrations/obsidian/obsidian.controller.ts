import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.model.js';

/**
 * OBSIDIAN INTEGRATION BOUNDARY
 *
 * The original Tauri application accessed the user's local Obsidian vault
 * directly via the filesystem using Tauri's Rust backend. A hosted NestJS
 * API server cannot reach the user's local machine; `localhost` in NestJS
 * context is the API server, not the end-user's device.
 *
 * Current status: NOT SUPPORTED for the cloud backend.
 *
 * Future path (if needed):
 * - User installs the Obsidian Local REST API plugin (https://github.com/coddingtonbear/obsidian-local-rest-api).
 * - User provides their Obsidian endpoint URL and API key via secure settings.
 * - NestJS proxies calls using the user-provided config stored in a secure column.
 * - OBSIDIAN_API_KEY and OBSIDIAN_PORT (.env) would only apply to a
 *   server-local Obsidian instance (e.g. a dev VM with Obsidian running).
 *
 * Environment variables (from .env) that would apply to a self-hosted path:
 * - OBSIDIAN_API_KEY: Bearer token for the Local REST API plugin.
 * - OBSIDIAN_PORT: Port the Local REST API plugin listens on (default 27123).
 */
@Controller('integrations/obsidian')
export class ObsidianController {
  constructor(private readonly config: ConfigService) {}

  /**
   * GET /integrations/obsidian/status
   * Returns the current availability of the Obsidian integration.
   * This endpoint is available so clients can gracefully degrade
   * rather than getting an unexpected 404.
   */
  @Get('status')
  getStatus(@CurrentUser() _user: AuthenticatedUser): {
    available: boolean;
    reason: string;
  } {
    const hasServerLocalConfig = Boolean(
      this.config.get<string>('OBSIDIAN_API_KEY'),
    );

    if (hasServerLocalConfig) {
      return {
        available: true,
        reason:
          'Server-local Obsidian REST plugin is configured. This only works for self-hosted deployments.',
      };
    }

    return {
      available: false,
      reason:
        'Obsidian integration is not available in this deployment. ' +
        'Local vault access requires the Tauri desktop client. ' +
        'Future support via Obsidian Local REST API plugin is planned.',
    };
  }

  /**
   * ALL other Obsidian endpoints return 503 until the REST plugin path is implemented.
   * Placeholder so clients can detect feature unavailability with a structured response.
   */
  @Get('*path')
  unavailable(): never {
    throw new ServiceUnavailableException(
      'Obsidian integration is not available in the hosted backend. ' +
        'Use the Tauri desktop client for local vault access.',
    );
  }
}
