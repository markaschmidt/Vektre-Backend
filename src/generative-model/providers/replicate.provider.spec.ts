import {
  ReplicateProviderAdapter,
  buildHunyuanInput,
  collectOutputUrls,
} from '../../integrations/replicate.provider.js';
import type { ReplicatePrediction } from '../../integrations/replicate.provider.js';

describe('ReplicateProviderAdapter.normalise', () => {
  let adapter: ReplicateProviderAdapter;

  beforeEach(() => {
    adapter = new ReplicateProviderAdapter({ get: () => ({
      token: 'test-token',
      baseUrl: 'https://api.replicate.com',
      timeoutMs: 30_000,
      maxRetries: 3,
      backoffMs: 1_000,
    })} as never);
  });

  // ─── Status mapping ────────────────────────────────────────────────────────

  it('maps starting to running', () => {
    expect(adapter.normalise(makePrediction('starting')).status).toBe('running');
  });

  it('maps processing to running', () => {
    expect(adapter.normalise(makePrediction('processing')).status).toBe('running');
  });

  it('maps succeeded to succeeded', () => {
    expect(adapter.normalise(makePrediction('succeeded')).status).toBe('succeeded');
  });

  it('maps failed to failed with errorMessage', () => {
    const result = adapter.normalise(makePrediction('failed', null, 'bad input'));
    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('bad input');
  });

  it('maps canceled to canceled', () => {
    expect(adapter.normalise(makePrediction('canceled')).status).toBe('canceled');
  });

  // ─── Flat string[] output (legacy / other models) ─────────────────────────

  it('extracts model and preview URLs from flat string array', () => {
    const pred = makePrediction('succeeded', [
      'https://delivery.replicate.com/foo/model.glb',
      'https://delivery.replicate.com/foo/preview.png',
      'https://delivery.replicate.com/foo/archive.zip',
    ]);
    const result = adapter.normalise(pred);
    expect(result.modelUrls).toHaveLength(2);
    expect(result.modelUrls[0]).toContain('.glb');
    expect(result.modelUrls[1]).toContain('.zip');
    expect(result.previewUrls).toHaveLength(1);
    expect(result.previewUrls[0]).toContain('.png');
  });

  it('returns empty arrays when output is null', () => {
    const result = adapter.normalise(makePrediction('succeeded', null));
    expect(result.modelUrls).toHaveLength(0);
    expect(result.previewUrls).toHaveLength(0);
  });

  // ─── Nested object output (Hunyuan 3D 3.1 actual shape) ──────────────────

  it('extracts model URL from Hunyuan nested { model, images } output', () => {
    const pred = makePrediction('succeeded', {
      model: 'https://delivery.replicate.com/foo/output.glb',
      images: ['https://delivery.replicate.com/foo/preview.png'],
    });
    const result = adapter.normalise(pred);
    expect(result.modelUrls).toHaveLength(1);
    expect(result.modelUrls[0]).toContain('.glb');
    expect(result.previewUrls).toHaveLength(1);
    expect(result.previewUrls[0]).toContain('.png');
  });

  it('extracts model URL from deeply nested output object', () => {
    const pred = makePrediction('succeeded', {
      results: {
        mesh: 'https://delivery.replicate.com/foo/output.gltf',
        thumbnail: 'https://delivery.replicate.com/foo/thumb.webp',
      },
    });
    const result = adapter.normalise(pred);
    expect(result.modelUrls).toHaveLength(1);
    expect(result.modelUrls[0]).toContain('.gltf');
    expect(result.previewUrls).toHaveLength(1);
    expect(result.previewUrls[0]).toContain('.webp');
  });

  it('handles single string output', () => {
    const pred = makePrediction('succeeded', 'https://delivery.replicate.com/foo/model.obj');
    const result = adapter.normalise(pred);
    expect(result.modelUrls).toHaveLength(1);
    expect(result.modelUrls[0]).toContain('.obj');
  });

  it('does not treat .gif as a preview URL', () => {
    const pred = makePrediction('succeeded', [
      'https://delivery.replicate.com/foo/anim.gif',
    ]);
    const result = adapter.normalise(pred);
    expect(result.previewUrls).toHaveLength(0);
    expect(result.modelUrls).toHaveLength(0);
  });
});

// ─── buildHunyuanInput ────────────────────────────────────────────────────────

describe('buildHunyuanInput', () => {
  it('includes fixed Hunyuan defaults', () => {
    const input = buildHunyuanInput(undefined, 'a sword');
    expect(input.enable_pbr).toBe(false);
    expect(input.face_count).toBe(500_000);
    expect(input.generate_type).toBe('Normal');
  });

  it('sets prompt for text-to-3D mode', () => {
    const input = buildHunyuanInput(undefined, 'a dragon');
    expect(input.prompt).toBe('a dragon');
    expect('image' in input).toBe(false);
  });

  it('sets image for image-to-3D mode', () => {
    const input = buildHunyuanInput('https://example.com/ref.png', undefined);
    expect(input.image).toBe('https://example.com/ref.png');
    expect('prompt' in input).toBe(false);
  });

  it('image takes priority when both provided (XOR safety fallback)', () => {
    const input = buildHunyuanInput('https://example.com/ref.png', 'a sword');
    expect(input.image).toBe('https://example.com/ref.png');
    expect('prompt' in input).toBe(false);
  });

  it('does not include requestId or userId', () => {
    const input = buildHunyuanInput(undefined, 'test') as Record<string, unknown>;
    expect('requestId' in input).toBe(false);
    expect('userId' in input).toBe(false);
  });
});

// ─── collectOutputUrls ────────────────────────────────────────────────────────

describe('collectOutputUrls', () => {
  it('collects from a flat string array', () => {
    const urls = collectOutputUrls([
      'https://a.com/model.glb',
      'https://b.com/preview.png',
    ]);
    expect(urls).toHaveLength(2);
  });

  it('collects from nested object', () => {
    const urls = collectOutputUrls({
      model: 'https://a.com/model.glb',
      images: ['https://b.com/preview.png'],
    });
    expect(urls).toHaveLength(2);
  });

  it('collects a bare string', () => {
    expect(collectOutputUrls('https://a.com/model.glb')).toEqual(['https://a.com/model.glb']);
  });

  it('ignores non-http strings', () => {
    expect(collectOutputUrls('not-a-url')).toEqual([]);
  });

  it('returns empty for null/undefined', () => {
    expect(collectOutputUrls(null)).toEqual([]);
    expect(collectOutputUrls(undefined)).toEqual([]);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePrediction(
  status: ReplicatePrediction['status'],
  output: unknown = null,
  error: string | null = null,
): ReplicatePrediction {
  return { id: 'pred-123', status, output, error };
}
