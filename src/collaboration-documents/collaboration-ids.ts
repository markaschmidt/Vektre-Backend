import { randomUUID } from 'node:crypto';

/** Shared prefix helpers for collaboration durable ids. */
export function generateDocId(): string {
  return `doc_${randomUUID()}`;
}

export function generateCommentId(): string {
  return `cmt_${randomUUID()}`;
}

export function generateActivityId(): string {
  return `act_${randomUUID()}`;
}

export function generateSnapshotId(): string {
  return `snap_${randomUUID()}`;
}
