import {
  buildGeneratedPropNaming,
  isMetadataOnlyUpsert,
  isPreviewAssetId,
  mintPropAssetId,
  modelPreviewAssetId,
  normalizeAssetMetadata,
  projectManifestAssetId,
  relatedAssetId,
  resolvePostUpsertAssetStatus,
  slugifyPropName,
} from './asset-conventions.js';

describe('asset-conventions', () => {
  it('builds canonical preview and manifest asset ids', () => {
    expect(modelPreviewAssetId('prop-123')).toBe('prop-123-preview');
    expect(isPreviewAssetId('prop-123-preview')).toBe(true);
    expect(projectManifestAssetId('proj-1')).toBe('proj-1-vkt');
    expect(relatedAssetId('prop-123', 'material.bin')).toBe(
      'prop-123-material.bin',
    );
  });

  it('mints prop ids and prefers client-supplied preferredAssetId', () => {
    expect(mintPropAssetId('prop-1784949056849-Make-a-gnome')).toBe(
      'prop-1784949056849-Make-a-gnome',
    );
    expect(mintPropAssetId()).toMatch(/^prop-\d+$/);
  });

  it('slugifies prompts for prop file names', () => {
    expect(slugifyPropName('Render a green apple!')).toBe(
      'render-a-green-apple',
    );
    expect(slugifyPropName('')).toBe('generated-3d-model');
  });

  it('builds Foundry-compatible prop naming', () => {
    const naming = buildGeneratedPropNaming({
      assetId: 'prop-123',
      prompt: 'Render a green apple',
    });
    expect(naming.name).toBe('render-a-green-apple.glb');
    expect(naming.projectRelativePath).toBe(
      'props/prop-123/render-a-green-apple.glb',
    );
    expect(naming.displayName).toBe('Render a green apple');
  });

  it('prefers explicit displayName over prompt for UI title', () => {
    const naming = buildGeneratedPropNaming({
      assetId: 'prop-1739123456789-Wooden_Crate',
      prompt: 'a wooden crate for a medieval game',
      displayName: 'Wooden_Crate',
    });
    expect(naming.displayName).toBe('Wooden_Crate');
    expect(naming.name).toBe('a-wooden-crate-for-a-medieval-game.glb');
  });

  it('applies preview and model metadata defaults', () => {
    const preview = normalizeAssetMetadata(
      'prop-1-preview',
      'proj-1',
      'image',
      'preview.png',
    );
    expect(preview.parentAssetId).toBe('prop-1');
    expect(preview.assetRole).toBe('model_preview');

    const model = normalizeAssetMetadata(
      'prop-1',
      'proj-1',
      'prop',
      'chair.glb',
    );
    expect(model.projectRelativePath).toBe('props/prop-1/chair.glb');
    expect(model.displayName).toBe('chair');
  });

  it('marks metadata-only upserts ready after processing', () => {
    expect(isMetadataOnlyUpsert({ metadata: { designBinding: true } })).toBe(
      true,
    );
    expect(
      resolvePostUpsertAssetStatus({ metadata: { designBinding: true } }),
    ).toBe('ready');
    expect(
      resolvePostUpsertAssetStatus({ sizeBytes: 1024, metadata: {} }),
    ).toBe('generating');
  });
});
