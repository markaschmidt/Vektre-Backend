import { createSolidRgbaPng, cropPng, readPngMeta } from './png-crop.js';
import {
  estimateOutputCount,
  normalizeSplitConfig,
} from './handlers/image-split.handler.js';
import { BadRequestException } from '@nestjs/common';

describe('png-crop', () => {
  it('reads PNG metadata and crops a region', () => {
    const png = createSolidRgbaPng(8, 8, [10, 20, 30, 255]);
    const meta = readPngMeta(png);
    expect(meta.width).toBe(8);
    expect(meta.height).toBe(8);

    const cropped = cropPng(png, { left: 2, top: 2, width: 3, height: 3 });
    const croppedMeta = readPngMeta(cropped);
    expect(croppedMeta.width).toBe(3);
    expect(croppedMeta.height).toBe(3);
  });
});

describe('normalizeSplitConfig', () => {
  it('accepts grid configs', () => {
    const config = normalizeSplitConfig({
      mode: 'grid',
      grid: { rows: 2, columns: 3 },
    });
    expect(config.mode).toBe('grid');
    expect(estimateOutputCount(config)).toBe(6);
  });

  it('rejects invalid regions', () => {
    expect(() =>
      normalizeSplitConfig({
        mode: 'regions',
        regions: [{ x: 0, y: 0, width: 0, height: 10 }],
      }),
    ).toThrow(BadRequestException);
  });
});
