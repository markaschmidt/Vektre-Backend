import { BadRequestException } from '@nestjs/common';
import type { OrganizationLogoMimeType } from './models/organization.model.js';
import { ORGANIZATION_LOGO_MAX_PX } from './models/organization.model.js';

/**
 * Read pixel dimensions from common logo formats without pulling in sharp.
 * Declared width/height from the client must match these values.
 */
export function readOrganizationLogoDimensions(
  bytes: Buffer,
  mimeType: OrganizationLogoMimeType,
): { width: number; height: number } {
  try {
    switch (mimeType) {
      case 'image/png':
        return readPngDimensions(bytes);
      case 'image/jpeg':
        return readJpegDimensions(bytes);
      case 'image/webp':
        return readWebpDimensions(bytes);
      case 'image/gif':
        return readGifDimensions(bytes);
      default:
        throw new BadRequestException(`Unsupported logo mimeType: ${mimeType}`);
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      `Could not read logo dimensions: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function assertLogoDimensionsWithinLimit(
  width: number,
  height: number,
): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > ORGANIZATION_LOGO_MAX_PX ||
    height > ORGANIZATION_LOGO_MAX_PX
  ) {
    throw new BadRequestException(
      `Logo must be between 1x1 and ${ORGANIZATION_LOGO_MAX_PX}x${ORGANIZATION_LOGO_MAX_PX} pixels`,
    );
  }
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes.toString('ascii', 1, 4) !== 'PNG'
  ) {
    throw new Error('Invalid PNG');
  }
  // IHDR length (4) + type (4) starts at byte 8; width/height at 16/20.
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG missing IHDR');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function readGifDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 10 || bytes.toString('ascii', 0, 3) !== 'GIF') {
    throw new Error('Invalid GIF');
  }
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Invalid JPEG');
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) throw new Error('Invalid JPEG segment');
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG SOF not found');
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('Invalid WebP');
  }
  const fourcc = bytes.toString('ascii', 12, 16);
  if (fourcc === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return { width, height };
  }
  if (fourcc === 'VP8 ' && bytes.length >= 30) {
    const width = bytes.readUInt16LE(26) & 0x3fff;
    const height = bytes.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (fourcc === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  throw new Error(`Unsupported WebP chunk ${fourcc}`);
}
