import {
  isMetadataOnlyUpsert,
  isPreviewAssetId,
  modelPreviewAssetId,
  normalizeAssetMetadata,
  projectManifestAssetId,
  relatedAssetId,
  resolvePostUpsertAssetStatus,
} from './asset-conventions.js';

describe('asset-conventions', () => {
  it('builds canonical preview and manifest asset ids', () => {
    expect(modelPreviewAssetId('prop-123')).toBe('prop-123-preview');
    expect(isPreviewAssetId('prop-123-preview')).toBe(true);
    expect(projectManifestAssetId('proj-1')).toBe('proj-1-vkt');
    expect(relatedAssetId('prop-123', 'material.bin')).toBe('prop-123-material.bin');
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
    expect(model.projectRelativePath).toBe('chair.glb');
  });

  it('marks metadata-only upserts ready after processing', () => {
    expect(isMetadataOnlyUpsert({ metadata: { designBinding: true } })).toBe(true);
    expect(
      resolvePostUpsertAssetStatus({ metadata: { designBinding: true } }),
    ).toBe('ready');
    expect(
      resolvePostUpsertAssetStatus({ sizeBytes: 1024, metadata: {} }),
    ).toBe('generating');
  });
});
