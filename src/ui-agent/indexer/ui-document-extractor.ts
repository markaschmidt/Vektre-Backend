import {
  VektreUIDocumentV2Schema,
  canonicalSha256,
  decodeYjsDocumentJson,
  layoutFingerprints as buildLayoutFingerprints,
  validateVektreUIDocument,
  type ContractValidationIssue,
  type JsonValue,
  type VektreUIDocumentV2,
} from '@markaschmidt/ui-builder-contracts';
import * as Y from 'yjs';
import type {
  UiDocumentExtraction,
  UiRetrievalDocumentInput,
} from './ui-context-index.model.js';

export class UiSnapshotValidationError extends Error {
  constructor(readonly issues: ContractValidationIssue[]) {
    super('Persisted UI document is invalid');
    this.name = 'UiSnapshotValidationError';
  }
}

export function extractUiDocumentFromYjs(input: {
  bytes: Uint8Array;
  projectId: string;
  documentId: string;
  baselineDigest?: JsonValue;
}): UiDocumentExtraction {
  const yDocument = new Y.Doc();
  try {
    Y.applyUpdate(yDocument, input.bytes);
  } catch (error) {
    throw new UiSnapshotValidationError([
      {
        code: 'invalid_yjs_update',
        path: '/',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to decode Yjs update',
        relatedIds: [],
      },
    ]);
  }

  const raw = decodeYjsJson(yDocument);
  const parsed = VektreUIDocumentV2Schema.safeParse(raw);
  if (!parsed.success) {
    throw new UiSnapshotValidationError(
      parsed.error.issues.map((issue) => ({
        code: 'schema_validation_failed',
        path: `/${issue.path.map(String).join('/')}`,
        message: issue.message,
        relatedIds: [],
      })),
    );
  }

  const semanticIssues = validateVektreUIDocument(parsed.data);
  if (semanticIssues.length > 0) {
    throw new UiSnapshotValidationError(semanticIssues);
  }

  return buildExtraction(
    parsed.data,
    input.projectId,
    input.documentId,
    input.baselineDigest,
  );
}

export function decodeYjsJson(document: Y.Doc): unknown {
  return decodeYjsDocumentJson(document);
}

function buildExtraction(
  document: VektreUIDocumentV2,
  projectId: string,
  documentId: string,
  baselineDigest?: JsonValue,
): UiDocumentExtraction {
  const documentHash = canonicalSha256(document);
  const nodeHashes = {
    groups: hashRecord(document.groups),
    components: hashRecord(document.components),
    blockInstances: hashRecord(document.blockInstances),
  };
  const structuralDigest: JsonValue = {
    schemaVersion: 1,
    documentHash,
    counts: {
      screens: Object.keys(document.screens).length,
      flows: Object.keys(document.flows).length,
      groups: Object.keys(document.groups).length,
      components: Object.keys(document.components).length,
      blockDefinitions: Object.keys(document.blockDefinitions).length,
      blockInstances: Object.keys(document.blockInstances).length,
    },
    screenHashes: hashRecord(document.screens),
    flowHashes: hashRecord(document.flows),
    groupHashes: nodeHashes.groups,
    componentHashes: nodeHashes.components,
    blockDefinitionHashes: hashRecord(document.blockDefinitions),
    blockInstanceHashes: nodeHashes.blockInstances,
    humanDelta: calculateHumanDelta(nodeHashes, baselineDigest),
  };
  const layoutFingerprints = buildLayoutFingerprints(document);
  const retrievalDocuments = buildRetrievalDocuments(
    document,
    projectId,
    documentId,
    documentHash,
  );
  return {
    document,
    documentHash,
    structuralDigest,
    layoutFingerprints,
    retrievalDocuments,
    assetIds: [
      ...new Set(Object.values(document.assets).map((asset) => asset.assetId)),
    ].sort(),
  };
}

function hashRecord(
  values: Record<string, unknown>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => [id, canonicalSha256(value)]),
  );
}

function calculateHumanDelta(
  current: {
    groups: Record<string, JsonValue>;
    components: Record<string, JsonValue>;
    blockInstances: Record<string, JsonValue>;
  },
  baselineDigest?: JsonValue,
): JsonValue {
  const baseline = isRecord(baselineDigest) ? baselineDigest : {};
  const baselineCollections = {
    groups: jsonHashRecord(baseline.groupHashes),
    components: jsonHashRecord(baseline.componentHashes),
    blockInstances: jsonHashRecord(baseline.blockInstanceHashes),
  };
  const added: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];

  for (const key of Object.keys(current) as Array<keyof typeof current>) {
    const currentHashes = current[key];
    const priorHashes = baselineCollections[key];
    for (const [id, hash] of Object.entries(currentHashes)) {
      if (!(id in priorHashes)) added.push(id);
      else if (priorHashes[id] !== hash) changed.push(id);
    }
    for (const id of Object.keys(priorHashes)) {
      if (!(id in currentHashes)) deleted.push(id);
    }
  }

  return {
    added: [...new Set(added)].sort(),
    changed: [...new Set(changed)].sort(),
    deleted: [...new Set(deleted)].sort(),
  };
}

function jsonHashRecord(value: JsonValue | undefined): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function buildRetrievalDocuments(
  document: VektreUIDocumentV2,
  projectId: string,
  documentId: string,
  documentHash: string,
): UiRetrievalDocumentInput[] {
  const shared = {
    projectId,
    documentId,
    ownerUserId: 'system',
    visibility: 'shared' as const,
    stale: false,
  };
  const result: UiRetrievalDocumentInput[] = [
    {
      ...shared,
      retrievalId: retrievalId(projectId, 'document', documentId),
      sourceKind: 'document',
      sourceId: documentId,
      sourceHash: documentHash,
      title: document.metadata.title,
      contentText: searchableText({
        metadata: document.metadata,
        designTokens: document.designTokens,
      }),
      metadata: {
        documentKind: document.documentKind,
        screenIds: Object.keys(document.screens).sort(),
      },
    },
  ];

  const append = <T extends object>(
    sourceKind: UiRetrievalDocumentInput['sourceKind'],
    values: Record<string, T>,
  ) => {
    for (const [sourceId, value] of Object.entries(values)) {
      const sourceHash = canonicalSha256(value);
      result.push({
        ...shared,
        retrievalId: retrievalId(projectId, sourceKind, sourceId),
        sourceKind,
        sourceId,
        sourceHash,
        title: entityTitle(value),
        contentText: searchableText(value),
        metadata: {
          entityType:
            sourceKind === 'block' && 'definitionId' in value
              ? 'block_instance'
              : sourceKind,
        },
      });
    }
  };
  append('screen', document.screens);
  append('group', document.groups);
  append('component', document.components);
  append('block', document.blockDefinitions);
  append('block', document.blockInstances);
  return result.sort(
    (left, right) =>
      left.sourceKind.localeCompare(right.sourceKind) ||
      left.sourceId.localeCompare(right.sourceId),
  );
}

function entityTitle(value: unknown): string {
  if (!isRecord(value)) return '';
  for (const key of ['name', 'title', 'label', 'id']) {
    if (typeof value[key] === 'string') return value[key];
  }
  return '';
}

function searchableText(value: unknown): string {
  const strings: string[] = [];
  collectStrings(value, strings, 0);
  return [...new Set(strings.map((entry) => entry.trim()).filter(Boolean))]
    .join(' ')
    .slice(0, 100_000);
}

function collectStrings(value: unknown, output: string[], depth: number): void {
  if (depth > 12 || output.length >= 2_000) return;
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectStrings(child, output, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value).sort()) {
    collectStrings(value[key], output, depth + 1);
  }
}

function retrievalId(
  projectId: string,
  sourceKind: string,
  sourceId: string,
): string {
  return `uiretr_${canonicalSha256({
    projectId,
    sourceKind,
    sourceId,
  }).slice(0, 40)}`;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
