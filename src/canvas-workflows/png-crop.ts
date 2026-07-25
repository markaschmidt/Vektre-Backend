import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

/**
 * Minimal PNG cropper (8-bit grayscale / RGB / RGBA) using only Node zlib.
 * Used when the optional `sharp` package is not installed in the runtime.
 */

export interface PngCropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PngImageMeta {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  channels: number;
}

export function readPngMeta(bytes: Buffer): PngImageMeta {
  assertPngSignature(bytes);
  const ihdr = findChunk(bytes, 'IHDR');
  if (!ihdr) throw new Error('PNG missing IHDR');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth}; only 8-bit is supported without sharp`);
  }
  const channels = channelsForColorType(colorType);
  return { width, height, colorType, bitDepth, channels };
}

export function cropPng(bytes: Buffer, rect: PngCropRect): Buffer {
  const meta = readPngMeta(bytes);
  const { left, top, width, height } = clampRect(rect, meta.width, meta.height);
  const raw = decodePngPixels(bytes, meta);
  const out = Buffer.alloc(height * (1 + width * meta.channels));

  for (let y = 0; y < height; y++) {
    const srcY = top + y;
    const srcRowStart = srcY * (1 + meta.width * meta.channels) + 1;
    const dstRowStart = y * (1 + width * meta.channels);
    out[dstRowStart] = 0; // filter None
    const srcOffset = srcRowStart + left * meta.channels;
    raw.copy(
      out,
      dstRowStart + 1,
      srcOffset,
      srcOffset + width * meta.channels,
    );
  }

  return encodePng({
    width,
    height,
    colorType: meta.colorType,
    bitDepth: 8,
    channels: meta.channels,
    filteredRows: out,
  });
}

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(
        `Unsupported PNG color type ${colorType}; install sharp for broader image support`,
      );
  }
}

function assertPngSignature(bytes: Buffer): void {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(sig)) {
    throw new Error('Input is not a PNG image');
  }
}

function findChunk(bytes: Buffer, type: string): Buffer | null {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (chunkType === type) {
      return bytes.subarray(dataStart, dataEnd);
    }
    offset = dataEnd + 4;
  }
  return null;
}

function collectIdat(bytes: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (chunkType === 'IDAT') {
      parts.push(bytes.subarray(dataStart, dataEnd));
    }
    if (chunkType === 'IEND') break;
    offset = dataEnd + 4;
  }
  if (parts.length === 0) throw new Error('PNG missing IDAT');
  return Buffer.concat(parts);
}

function decodePngPixels(bytes: Buffer, meta: PngImageMeta): Buffer {
  const compressed = collectIdat(bytes);
  const inflated = inflateSync(compressed);
  const rowSize = 1 + meta.width * meta.channels;
  const expected = rowSize * meta.height;
  if (inflated.length < expected) {
    throw new Error('PNG pixel data truncated');
  }

  // Unfilter into a buffer with filter byte kept as 0 for easier cropping.
  const out = Buffer.alloc(expected);
  const bpp = meta.channels;
  for (let y = 0; y < meta.height; y++) {
    const inRow = y * rowSize;
    const filter = inflated[inRow];
    const outRow = y * rowSize;
    out[outRow] = 0;
    for (let i = 0; i < meta.width * bpp; i++) {
      const x = inRow + 1 + i;
      const a = i >= bpp ? out[outRow + 1 + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * rowSize + 1 + i] : 0;
      const c =
        y > 0 && i >= bpp ? out[(y - 1) * rowSize + 1 + i - bpp] : 0;
      let val = inflated[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          val = (val + a) & 0xff;
          break;
        case 2:
          val = (val + b) & 0xff;
          break;
        case 3:
          val = (val + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4:
          val = (val + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter ${filter}`);
      }
      out[outRow + 1 + i] = val;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePng(input: {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  channels: number;
  filteredRows: Buffer;
}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(input.width, 0);
  ihdr.writeUInt32BE(input.height, 4);
  ihdr.writeUInt8(input.bitDepth, 8);
  ihdr.writeUInt8(input.colorType, 9);
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const compressed = deflateSync(input.filteredRows);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf: Buffer): number {
  // Use Node crypto for a stable CRC32 via a small table-less algorithm.
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function clampRect(
  rect: PngCropRect,
  width: number,
  height: number,
): PngCropRect {
  const left = Math.max(0, Math.min(Math.floor(rect.left), width - 1));
  const top = Math.max(0, Math.min(Math.floor(rect.top), height - 1));
  const w = Math.max(1, Math.min(Math.floor(rect.width), width - left));
  const h = Math.max(1, Math.min(Math.floor(rect.height), height - top));
  return { left, top, width: w, height: h };
}

/** Test helper — builds a solid-color 8-bit RGBA PNG. */
export function createSolidRgbaPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Buffer {
  const rowSize = 1 + width * 4;
  const filtered = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    filtered[row] = 0;
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 4;
      filtered[o] = rgba[0];
      filtered[o + 1] = rgba[1];
      filtered[o + 2] = rgba[2];
      filtered[o + 3] = rgba[3];
    }
  }
  return encodePng({
    width,
    height,
    colorType: 6,
    bitDepth: 8,
    channels: 4,
    filteredRows: filtered,
  });
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
