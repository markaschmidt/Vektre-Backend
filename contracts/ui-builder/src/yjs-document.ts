import * as Y from 'yjs';
import { canonicalSha256 } from './canonical-json.js';
import {
  SCHEMA_VERSION,
  type DocumentKind,
  type JsonValue,
} from './common.js';
import {
  VektreUIDocumentV2Schema,
  type VektreUIDocumentV2,
} from './document.js';
import { APPROVED_PATCH_ROOTS } from './patches.js';
import type { ContractValidationIssue } from './validation.js';

/** Canonical Y.Map that holds the Vektre UI document. */
export const YJS_DOCUMENT_ROOT = 'root';

/**
 * Sibling of `root` — not part of the document hash. Guards exactly-once apply
 * by `activityId` / `runId` without rewriting provenance on every inspect.
 */
export const YJS_APPLIED_ACTIVITIES = 'appliedActivities';

export const YJS_DOCUMENT_MAP_CANDIDATES = [
  YJS_DOCUMENT_ROOT,
  'gui_screen',
  'gui',
  'document',
] as const;

export const DOCUMENT_RECORD_ROOTS = [
  'platformProfiles',
  'spatialProfiles',
  'screens',
  'surfaces',
  'flows',
  'groups',
  'components',
  'blockDefinitions',
  'blockInstances',
  'styles',
  'assets',
  'bindings',
  'states',
  'interactions',
  'visibilityRules',
  'animations',
  'constraints',
] as const;

export type DocumentRecordRoot = (typeof DOCUMENT_RECORD_ROOTS)[number];

export const DOCUMENT_OBJECT_ROOTS = [
  'metadata',
  'designTokens',
  'provenance',
] as const;

const FORBIDDEN_KEY =
  /^(signedUrl|signed_url|workerUrl|worker_url|providerId|provider_id|imageBase64|dataUrl|data_url)$/i;
const FORBIDDEN_STRING =
  /data:image\/|base64,|X-Amz-Signature|HUD_WORKER|VEKTRE_AI_|\/v1\/ui-builder/i;

export interface AppliedActivityRecord {
  activityId: string;
  runId: string;
  documentHash: string;
  appliedAt: string;
}

export function emptyVektreUiDocument(input: {
  documentId: string;
  title: string;
  documentKind?: DocumentKind;
}): VektreUIDocumentV2 {
  return VektreUIDocumentV2Schema.parse({
    schemaVersion: SCHEMA_VERSION,
    documentKind: input.documentKind ?? 'hud',
    metadata: {
      documentId: input.documentId,
      title: input.title,
    },
    platformProfiles: {
      desktop: {
        id: 'desktop',
        platform: 'desktop',
        viewport: { width: 1920, height: 1080 },
        inputModes: ['mouse', 'keyboard'],
      },
    },
    spatialProfiles: {
      screen: { id: 'screen', mode: 'screen', units: 'pixels' },
    },
    screens: {},
    surfaces: {},
    flows: {},
    groups: {},
    components: {},
    blockDefinitions: {},
    blockInstances: {},
    designTokens: {
      colors: {},
      typography: {},
      spacing: {},
      radii: {},
      shadows: {},
      motion: {},
    },
    styles: {},
    assets: {},
    bindings: {},
    states: {},
    interactions: {},
    visibilityRules: {},
    animations: {},
    constraints: {},
  });
}

export function isEmptyVektreUiDocument(document: VektreUIDocumentV2): boolean {
  return (
    Object.keys(document.screens).length === 0 &&
    Object.keys(document.groups).length === 0 &&
    Object.keys(document.components).length === 0 &&
    Object.keys(document.blockDefinitions).length === 0 &&
    Object.keys(document.blockInstances).length === 0
  );
}

export function decodeYjsDocumentJson(document: {
  getMap(name: string): { size: number; toJSON(): unknown };
  toJSON(): unknown;
}): unknown {
  for (const key of YJS_DOCUMENT_MAP_CANDIDATES) {
    const candidate = document.getMap(key);
    if (candidate.size > 0) return candidate.toJSON();
  }
  return unwrapDocumentRoot(document.toJSON());
}

export function readVektreUiDocument(document: Y.Doc): VektreUIDocumentV2 {
  return VektreUIDocumentV2Schema.parse(decodeYjsDocumentJson(document));
}

/**
 * Bind a Vektre UI document onto nested Y.Maps keyed by stable semantic IDs.
 * Mutates existing collection maps in place — never replaces `root` or a
 * record root with a new Y.Map — so concurrent clients editing different ids
 * do not clobber each other.
 */
export function writeVektreUiDocument(
  yDocument: Y.Doc,
  document: VektreUIDocumentV2,
): void {
  const issues = forbiddenYjsContentIssues(document);
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join('; '));
  }
  const parsed = VektreUIDocumentV2Schema.parse(document);
  yDocument.transact(() => {
    const root = yDocument.getMap(YJS_DOCUMENT_ROOT);
    root.set('schemaVersion', parsed.schemaVersion);
    root.set('documentKind', parsed.documentKind);
    writeObjectIntoMap(getOrCreateMap(root, 'metadata'), parsed.metadata);
    writeObjectIntoMap(
      getOrCreateMap(root, 'designTokens'),
      parsed.designTokens,
    );
    if (parsed.provenance) {
      writeObjectIntoMap(getOrCreateMap(root, 'provenance'), parsed.provenance);
    } else if (root.has('provenance')) {
      root.delete('provenance');
    }
    for (const collection of DOCUMENT_RECORD_ROOTS) {
      writeRecordMap(
        getOrCreateMap(root, collection),
        parsed[collection] as Record<string, JsonValue>,
      );
    }
  }, 'vektre-ui-document');
}

export function setRecordEntry(
  yDocument: Y.Doc,
  collection: DocumentRecordRoot,
  id: string,
  value: JsonValue | null,
): void {
  yDocument.transact(() => {
    const root = yDocument.getMap(YJS_DOCUMENT_ROOT);
    const map = getOrCreateMap(root, collection);
    if (value === null) {
      map.delete(id);
      return;
    }
    setYValue(map, id, value);
  }, 'vektre-ui-record');
}

export function markActivityApplied(
  yDocument: Y.Doc,
  record: AppliedActivityRecord,
): void {
  yDocument.transact(() => {
    const log = yDocument.getMap(YJS_APPLIED_ACTIVITIES);
    writeObjectIntoMap(getOrCreateMap(log, record.activityId), {
      activityId: record.activityId,
      runId: record.runId,
      documentHash: record.documentHash,
      appliedAt: record.appliedAt,
    });
  }, 'vektre-ui-apply-log');
}

export function getAppliedActivity(
  yDocument: Y.Doc,
  activityId: string,
): AppliedActivityRecord | undefined {
  const log = yDocument.getMap(YJS_APPLIED_ACTIVITIES);
  const entry = log.get(activityId);
  if (!(entry instanceof Y.Map) && !isRecord(entry)) return undefined;
  const json = entry instanceof Y.Map ? entry.toJSON() : entry;
  if (!isRecord(json)) return undefined;
  if (
    typeof json.activityId !== 'string' ||
    typeof json.runId !== 'string' ||
    typeof json.documentHash !== 'string' ||
    typeof json.appliedAt !== 'string'
  ) {
    return undefined;
  }
  return {
    activityId: json.activityId,
    runId: json.runId,
    documentHash: json.documentHash,
    appliedAt: json.appliedAt,
  };
}

export function isActivityApplied(
  yDocument: Y.Doc,
  activityId: string,
  runId?: string,
): boolean {
  const record = getAppliedActivity(yDocument, activityId);
  if (!record) return false;
  return runId === undefined || record.runId === runId;
}

export function layoutFingerprints(
  document: VektreUIDocumentV2,
): Record<string, JsonValue> {
  const fingerprints: Record<string, JsonValue> = {};
  const collections: Array<
    ['group' | 'component' | 'block_instance', Record<string, { id: string }>]
  > = [
    ['group', document.groups],
    ['component', document.components],
    ['block_instance', document.blockInstances],
  ];
  for (const [kind, values] of collections) {
    for (const [id, node] of Object.entries(values)) {
      const typed = node as {
        id: string;
        parentId?: string;
        screenId: string;
        surfaceId: string;
        layout: JsonValue;
        transform?: JsonValue;
        zIndex: number;
      };
      const fingerprint = {
        kind,
        id,
        parentId: typed.parentId ?? null,
        screenId: typed.screenId,
        surfaceId: typed.surfaceId,
        layout: typed.layout,
        transform: typed.transform ?? null,
        zIndex: typed.zIndex,
      };
      fingerprints[id] = {
        ...fingerprint,
        hash: canonicalSha256(fingerprint),
      };
    }
  }
  return fingerprints;
}

export function forbiddenYjsContentIssues(
  value: unknown,
  path = '',
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  walkForbidden(value, path || '/', issues);
  return issues;
}

export function assertApprovedPatchRoot(root: string): void {
  if (
    !(APPROVED_PATCH_ROOTS as readonly string[]).includes(root) &&
    root !== 'schemaVersion' &&
    root !== 'documentKind'
  ) {
    throw new Error(`Path is outside approved document roots: ${root}`);
  }
}

function walkForbidden(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[],
): void {
  if (typeof value === 'string') {
    if (FORBIDDEN_STRING.test(value)) {
      issues.push({
        code: 'forbidden_yjs_content',
        path,
        message:
          'Yjs documents may store assetId references only — never signed URLs, worker URLs, provider IDs, or image base64',
        relatedIds: [],
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walkForbidden(entry, `${path}/${index}`, issues),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '/' ? `/${key}` : `${path}/${key}`;
    if (FORBIDDEN_KEY.test(key)) {
      issues.push({
        code: 'forbidden_yjs_key',
        path: childPath,
        message: `Forbidden Yjs key "${key}" — store assetId only`,
        relatedIds: [],
      });
    }
    walkForbidden(child, childPath, issues);
  }
}

function unwrapDocumentRoot(value: unknown): unknown {
  if (!isRecord(value)) return value;
  for (const key of YJS_DOCUMENT_MAP_CANDIDATES) {
    const candidate = value[key];
    if (
      isRecord(candidate) &&
      (candidate.schemaVersion === 2 || candidate.documentKind !== undefined)
    ) {
      return candidate;
    }
  }
  return value;
}

function writeRecordMap(
  target: Y.Map<unknown>,
  values: Record<string, JsonValue>,
): void {
  const incoming = new Set(Object.keys(values));
  for (const key of [...target.keys()]) {
    if (!incoming.has(key)) target.delete(key);
  }
  for (const [id, value] of Object.entries(values)) {
    setYValue(target, id, value);
  }
}

function writeObjectIntoMap(
  target: Y.Map<unknown>,
  value: Record<string, JsonValue>,
): void {
  const incoming = new Set(Object.keys(value));
  for (const key of [...target.keys()]) {
    if (!incoming.has(key)) target.delete(key);
  }
  for (const [key, child] of Object.entries(value)) {
    setYValue(target, key, child);
  }
}

function getOrCreateMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const existing = parent.get(key);
  if (existing instanceof Y.Map) return existing;
  const created = new Y.Map<unknown>();
  parent.set(key, created);
  return created;
}

function setYValue(
  parent: Y.Map<unknown>,
  key: string,
  value: JsonValue,
): void {
  if (Array.isArray(value)) {
    let array = parent.get(key);
    if (!(array instanceof Y.Array)) {
      array = new Y.Array<unknown>();
      parent.set(key, array);
    }
    const typed = array as Y.Array<unknown>;
    if (typed.length > 0) typed.delete(0, typed.length);
    for (const entry of value) appendYArrayValue(typed, entry);
    return;
  }
  if (isRecord(value)) {
    writeObjectIntoMap(getOrCreateMap(parent, key), value);
    return;
  }
  parent.set(key, value);
}

function appendYArrayValue(parent: Y.Array<unknown>, value: JsonValue): void {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    parent.push([array]);
    for (const entry of value) appendYArrayValue(array, entry);
    return;
  }
  if (isRecord(value)) {
    const map = new Y.Map<unknown>();
    parent.push([map]);
    writeObjectIntoMap(map, value);
    return;
  }
  parent.push([value]);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
