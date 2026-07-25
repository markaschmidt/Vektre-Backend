import {
  countMultiviewAssets,
  resolveHunyuanModelVariant,
  resolveMultiviewAssetIds,
} from './hunyuan-3d-model.js';

describe('resolveHunyuanModelVariant', () => {
  it('defaults to 3.1', () => {
    expect(resolveHunyuanModelVariant()).toBe('3.1');
  });

  it('auto-selects 2mv when two or more view assets are present', () => {
    expect(
      resolveHunyuanModelVariant(
        {},
        countMultiviewAssets({ front: 'a', back: 'b' }),
      ),
    ).toBe('2mv');
  });

  it('respects explicit hunyuanModel override', () => {
    expect(resolveHunyuanModelVariant({ hunyuanModel: '3.1' }, 4)).toBe('3.1');
    expect(resolveHunyuanModelVariant({ hunyuanModel: '2mv' }, 0)).toBe('2mv');
  });
});

describe('resolveMultiviewAssetIds', () => {
  it('merges wired ports over config multiviewAssetIds', () => {
    expect(
      resolveMultiviewAssetIds(
        {
          multiviewAssetIds: {
            front: 'cfg-front',
            left: 'cfg-left',
          },
        },
        [
          { portId: 'front', assetId: 'port-front' },
          { portId: 'right', assetId: 'port-right' },
        ],
      ),
    ).toEqual({
      front: 'port-front',
      left: 'cfg-left',
      right: 'port-right',
    });
  });
});
