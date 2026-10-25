import type {
  DesignMemoryKind,
  DesignMemoryRecord,
  DesignMemoryScope,
  DesignMemoryStatus,
} from './memory.js';

export interface DesignMemoryFilter {
  kind?: DesignMemoryKind;
  status?: DesignMemoryStatus | DesignMemoryStatus[];
  scope?: DesignMemoryScope;
  scopeId?: string;
  documentId?: string;
  visibility?: 'shared' | 'private' | 'all';
  query?: string;
}

export interface MemoryReviewModel {
  memoryId: string;
  kind: DesignMemoryKind;
  scope: DesignMemoryScope;
  scopeId?: string;
  text: string;
  status: DesignMemoryStatus;
  visibility: 'shared' | 'private';
  provenance: DesignMemoryRecord['provenance'];
  effectiveRevision?: string;
  canAccept: boolean;
  canReject: boolean;
  canSupersede: boolean;
  canPublish: boolean;
  publishSharesTranscript: false;
}

export const MEMORY_PUBLISH_SHARES_TRANSCRIPT = false;

export function filterDesignMemory(
  records: DesignMemoryRecord[],
  filter: DesignMemoryFilter = {},
): DesignMemoryRecord[] {
  const statuses = filter.status
    ? Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    : undefined;
  const query = filter.query?.trim().toLowerCase();
  return records.filter((record) => {
    if (filter.kind && record.kind !== filter.kind) return false;
    if (statuses && !statuses.includes(record.status)) return false;
    if (filter.scope && record.scope !== filter.scope) return false;
    if (filter.scopeId && record.scopeId !== filter.scopeId) return false;
    if (filter.documentId && record.documentId !== filter.documentId) {
      return false;
    }
    if (
      filter.visibility &&
      filter.visibility !== 'all' &&
      record.visibility !== filter.visibility
    ) {
      return false;
    }
    if (query && !record.text.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function memoryReviewModel(
  record: DesignMemoryRecord,
  actorUserId: string,
): MemoryReviewModel {
  const owner = record.ownerUserId === actorUserId;
  const proposed = record.status === 'proposed';
  return {
    memoryId: record.memoryId,
    kind: record.kind,
    scope: record.scope,
    scopeId: record.scopeId,
    text: record.text,
    status: record.status,
    visibility: record.visibility,
    provenance: record.provenance,
    effectiveRevision: record.effectiveRevision,
    canAccept: proposed,
    canReject: proposed,
    canSupersede: record.status === 'accepted',
    canPublish: owner && record.visibility === 'private',
    publishSharesTranscript: MEMORY_PUBLISH_SHARES_TRANSCRIPT,
  };
}

export function acceptedGuidance(
  records: DesignMemoryRecord[],
): DesignMemoryRecord[] {
  return filterDesignMemory(records, { status: 'accepted' }).sort((left, right) =>
    (left.effectiveRevision ?? left.updatedAt).localeCompare(
      right.effectiveRevision ?? right.updatedAt,
    ),
  );
}

export function rejectedDirections(
  records: DesignMemoryRecord[],
): DesignMemoryRecord[] {
  return filterDesignMemory(records, {
    status: ['rejected', 'superseded'],
  });
}

export function memoryActionPath(
  memoryId: string,
  action: 'accept' | 'reject' | 'publish' | 'supersede',
): string {
  return `memories/${memoryId}/${action}`;
}
