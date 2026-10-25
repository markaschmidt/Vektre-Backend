import { uiAgentCapabilities } from './ui-agent.capabilities.js';
import { UiAgentCapabilitiesSchema } from '@markaschmidt/ui-builder-contracts';

describe('uiAgentCapabilities', () => {
  it('advertises schema, catalogs, limits, and feature flags without worker policy', () => {
    const capabilities = uiAgentCapabilities();
    expect(UiAgentCapabilitiesSchema.parse(capabilities).yjsSchemaVersion).toBe(
      2,
    );
    expect(capabilities.documentContract).toBe('VektreUIDocumentV2');
    expect(capabilities.migrations.hudDocumentV1).toBe(true);
    expect(capabilities.documentKinds).toContain('hud');
    expect(capabilities.componentKinds).toContain('progress_bar');
    expect(capabilities.features.chat).toBe(true);
    expect(capabilities.features.memory).toBe(true);
    expect(JSON.stringify(capabilities)).not.toContain('workerPolicy');
  });
});
