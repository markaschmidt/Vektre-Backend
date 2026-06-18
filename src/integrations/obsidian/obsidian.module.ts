import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObsidianController } from './obsidian.controller.js';

/**
 * ObsidianModule – boundary module documenting that Obsidian filesystem
 * access is not supported in the hosted backend.
 *
 * See ObsidianController for the full rationale and future extension path.
 */
@Module({
  imports: [ConfigModule],
  controllers: [ObsidianController],
})
export class ObsidianModule {}
