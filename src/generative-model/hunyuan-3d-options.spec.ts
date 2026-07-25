import {
  HUNYUAN_3D_DEFAULT_OPTIONS,
  resolveHunyuan3dOptions,
} from './hunyuan-3d-options.js';

describe('resolveHunyuan3dOptions', () => {
  it('defaults to Prop preset when config is empty', () => {
    expect(resolveHunyuan3dOptions()).toEqual(HUNYUAN_3D_DEFAULT_OPTIONS);
    expect(resolveHunyuan3dOptions({ preferImageInput: true })).toEqual(
      HUNYUAN_3D_DEFAULT_OPTIONS,
    );
  });

  it('uses explicit canvas Prop fields from buildBackendActionConfig', () => {
    expect(
      resolveHunyuan3dOptions({
        qualityTier: 'prop',
        faceCount: 40_000,
        generateType: 'LowPoly',
        enablePbr: false,
      }),
    ).toEqual({
      face_count: 40_000,
      generate_type: 'Geometry',
      enable_pbr: false,
    });
  });

  it('uses Hero tier preset', () => {
    expect(resolveHunyuan3dOptions({ qualityTier: 'hero' })).toEqual({
      face_count: 500_000,
      generate_type: 'Normal',
      enable_pbr: false,
    });
  });

  it('explicit faceCount overrides tier preset', () => {
    expect(
      resolveHunyuan3dOptions({
        qualityTier: 'hero',
        faceCount: 80_000,
        generateType: 'LowPoly',
      }),
    ).toEqual({
      face_count: 80_000,
      generate_type: 'Geometry',
      enable_pbr: false,
    });
  });

  it('supports snake_case direct API fields', () => {
    expect(
      resolveHunyuan3dOptions({
        face_count: 120_000,
        generate_type: 'Normal',
        enable_pbr: true,
      }),
    ).toEqual({
      face_count: 120_000,
      generate_type: 'Normal',
      enable_pbr: true,
    });
  });

  it('uses customFaceCount when useCustomFaceCount is true', () => {
    expect(
      resolveHunyuan3dOptions({
        useCustomFaceCount: true,
        customFaceCount: 75_000,
        generateType: 'LowPoly',
      }),
    ).toEqual({
      face_count: 75_000,
      generate_type: 'Geometry',
      enable_pbr: false,
    });
  });

  it('maps desktop LowPoly alias to Replicate Geometry', () => {
    expect(
      resolveHunyuan3dOptions({ generateType: 'lowpoly' }).generate_type,
    ).toBe('Geometry');
    expect(
      resolveHunyuan3dOptions({ generateType: 'Geometry' }).generate_type,
    ).toBe('Geometry');
  });

  it('clamps face count to Hunyuan 3.1 bounds', () => {
    expect(
      resolveHunyuan3dOptions({ faceCount: 2_000_000 }).face_count,
    ).toBe(1_500_000);
    expect(resolveHunyuan3dOptions({ faceCount: 10 }).face_count).toBe(40_000);
  });
});
