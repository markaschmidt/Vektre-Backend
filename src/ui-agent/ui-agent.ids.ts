import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type UiAgentIdPrefix =
  | 'uithr'
  | 'uimsg'
  | 'uimem'
  | 'uirev'
  | 'uirun'
  | 'uistep'
  | 'uictx'
  | 'uiart'
  | 'uiexec'
  | 'uirel'
  | 'uiemb'
  | 'uiinv'
  | 'uiqlt';

export function generateUiAgentId(prefix: UiAgentIdPrefix): string {
  return `${prefix}_${randomUUID()}`;
}

export function encodeOrderCursor(order: number): string {
  return Buffer.from(JSON.stringify({ order }), 'utf8').toString('base64url');
}

export function decodeOrderCursor(
  cursor: string | undefined,
): number | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { order?: unknown };
    if (
      typeof parsed.order !== 'number' ||
      !Number.isSafeInteger(parsed.order) ||
      parsed.order < 1
    ) {
      throw new Error('invalid order');
    }
    return parsed.order;
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
