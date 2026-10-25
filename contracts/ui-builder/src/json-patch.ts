import { canonicalJson } from './canonical-json.js';
import type { JsonValue } from './common.js';
import type { JsonPatchOperation, PatchConflict } from './patches.js';

export class JsonPatchError extends Error {
  constructor(
    readonly path: string,
    message: string,
    readonly kind: PatchConflict['kind'] = 'schema_invalid',
  ) {
    super(message);
    this.name = 'JsonPatchError';
  }
}

export interface ApplyJsonPatchOptions {
  /**
   * Per-path resolution when a `test` operation fails.
   * Default is `human_wins` (keep live value, skip the paired mutation).
   */
  resolutions?: Record<string, NonNullable<PatchConflict['resolution']>>;
  manualValues?: Record<string, JsonValue>;
}

export interface ApplyJsonPatchResult {
  document: JsonValue;
  conflicts: PatchConflict[];
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

export function jsonPointerSegments(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) {
    throw new JsonPatchError(path, 'JSON Pointer must start with /');
  }
  return path
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function getAtPointer(document: JsonValue, path: string): JsonValue {
  if (path === '') return document;
  const segments = jsonPointerSegments(path);
  let current: JsonValue = document;
  for (const segment of segments) {
    current = childAt(current, segment, path);
  }
  return current;
}

export function applyJsonPatch(
  document: JsonValue,
  operations: JsonPatchOperation[],
  options: ApplyJsonPatchOptions = {},
): ApplyJsonPatchResult {
  const next = cloneJson(document);
  const conflicts: PatchConflict[] = [];
  const skippedPrefixes: string[] = [];
  const resolutions = options.resolutions ?? {};
  const manualValues = options.manualValues ?? {};

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const path = 'path' in operation ? operation.path : '';
    if (skippedPrefixes.some((prefix) => pathIsEqualOrChild(path, prefix))) {
      continue;
    }

    if (operation.op === 'test') {
      const liveValue = tryGet(next, operation.path);
      if (canonicalEqual(liveValue, operation.value)) continue;
      const resolution = resolutions[operation.path] ?? 'human_wins';
      const proposed = lookAheadProposedValue(operations, index, operation.path);
      conflicts.push({
        path: operation.path,
        kind: liveValue === undefined ? 'target_deleted' : 'test_failed',
        baseValue: operation.value,
        liveValue,
        proposedValue: proposed,
        resolution,
        message:
          liveValue === undefined
            ? `Target ${operation.path} is missing in the live document`
            : `Live value at ${operation.path} does not match the patch precondition`,
      });
      if (resolution === 'human_wins') {
        skippedPrefixes.push(operation.path);
        continue;
      }
      if (resolution === 'manual') {
        const manual = manualValues[operation.path];
        if (manual === undefined) {
          skippedPrefixes.push(operation.path);
          continue;
        }
        applyUnchecked(next, {
          op: 'replace',
          path: operation.path,
          value: manual,
        });
        skippedPrefixes.push(operation.path);
      }
      continue;
    }

    try {
      applyUnchecked(next, operation);
    } catch (error) {
      const kind =
        error instanceof JsonPatchError ? error.kind : 'schema_invalid';
      const liveValue = tryGet(next, path);
      conflicts.push({
        path,
        kind,
        liveValue,
        proposedValue: 'value' in operation ? operation.value : undefined,
        resolution: resolutions[path] ?? 'human_wins',
        message:
          error instanceof Error
            ? error.message
            : `Failed to apply ${operation.op} at ${path}`,
      });
      if ((resolutions[path] ?? 'human_wins') === 'human_wins') {
        skippedPrefixes.push(path);
      }
    }
  }

  return { document: next, conflicts };
}

function lookAheadProposedValue(
  operations: JsonPatchOperation[],
  testIndex: number,
  path: string,
): JsonValue | undefined {
  for (let index = testIndex + 1; index < operations.length; index += 1) {
    const operation = operations[index];
    if (
      (operation.op === 'replace' || operation.op === 'add') &&
      operation.path === path
    ) {
      return operation.value;
    }
  }
  return undefined;
}

function applyUnchecked(
  document: JsonValue,
  operation: JsonPatchOperation,
): void {
  switch (operation.op) {
    case 'add':
      addAt(document, operation.path, operation.value);
      return;
    case 'replace':
      replaceAt(document, operation.path, operation.value);
      return;
    case 'remove':
      removeAt(document, operation.path);
      return;
    case 'move':
      moveCopy(document, operation.from, operation.path, true);
      return;
    case 'copy':
      moveCopy(document, operation.from, operation.path, false);
      return;
    case 'test':
      return;
  }
}

function addAt(document: JsonValue, path: string, value: JsonValue): void {
  if (path === '') {
    throw new JsonPatchError(path, 'Cannot replace the document root');
  }
  const segments = jsonPointerSegments(path);
  const last = segments.pop();
  if (last === undefined) {
    throw new JsonPatchError(path, 'Invalid JSON Pointer');
  }
  const parent = getAtPointer(document, pointerFrom(segments));
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(cloneJson(value));
      return;
    }
    const index = parseArrayIndex(last, path, parent.length, true);
    parent.splice(index, 0, cloneJson(value));
    return;
  }
  if (!isRecord(parent)) {
    throw new JsonPatchError(path, 'Add target parent is not an object or array');
  }
  parent[last] = cloneJson(value);
}

function replaceAt(document: JsonValue, path: string, value: JsonValue): void {
  if (path === '') {
    throw new JsonPatchError(path, 'Cannot replace the document root');
  }
  const segments = jsonPointerSegments(path);
  const last = segments.pop();
  if (last === undefined) {
    throw new JsonPatchError(path, 'Invalid JSON Pointer');
  }
  const parent = getAtPointer(document, pointerFrom(segments));
  if (Array.isArray(parent)) {
    const index = parseArrayIndex(last, path, parent.length, false);
    parent[index] = cloneJson(value);
    return;
  }
  if (!isRecord(parent) || !(last in parent)) {
    throw new JsonPatchError(
      path,
      `Replace target ${path} does not exist`,
      'target_deleted',
    );
  }
  parent[last] = cloneJson(value);
}

function removeAt(document: JsonValue, path: string): void {
  if (path === '') {
    throw new JsonPatchError(path, 'Cannot remove the document root');
  }
  const segments = jsonPointerSegments(path);
  const last = segments.pop();
  if (last === undefined) {
    throw new JsonPatchError(path, 'Invalid JSON Pointer');
  }
  const parent = getAtPointer(document, pointerFrom(segments));
  if (Array.isArray(parent)) {
    const index = parseArrayIndex(last, path, parent.length, false);
    parent.splice(index, 1);
    return;
  }
  if (!isRecord(parent) || !(last in parent)) {
    throw new JsonPatchError(
      path,
      `Remove target ${path} does not exist`,
      'target_deleted',
    );
  }
  delete parent[last];
}

function moveCopy(
  document: JsonValue,
  from: string,
  path: string,
  moving: boolean,
): void {
  const value = cloneJson(getAtPointer(document, from));
  if (moving) removeAt(document, from);
  addAt(document, path, value);
}

function childAt(
  current: JsonValue,
  segment: string,
  path: string,
): JsonValue {
  if (Array.isArray(current)) {
    const index = parseArrayIndex(segment, path, current.length, false);
    return current[index] as JsonValue;
  }
  if (!isRecord(current) || !(segment in current)) {
    throw new JsonPatchError(
      path,
      `Path ${path} does not exist`,
      'target_deleted',
    );
  }
  return current[segment] as JsonValue;
}

function tryGet(document: JsonValue, path: string): JsonValue | undefined {
  try {
    return getAtPointer(document, path);
  } catch {
    return undefined;
  }
}

function parseArrayIndex(
  segment: string,
  path: string,
  length: number,
  allowEnd: boolean,
): number {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
    throw new JsonPatchError(path, `Invalid array index "${segment}"`);
  }
  const index = Number(segment);
  if (index < 0 || index > length || (!allowEnd && index === length)) {
    throw new JsonPatchError(path, `Array index ${index} is out of range`);
  }
  return index;
}

function pointerFrom(segments: string[]): string {
  if (segments.length === 0) return '';
  return `/${segments
    .map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/')}`;
}

function pathIsEqualOrChild(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function canonicalEqual(left: JsonValue | undefined, right: JsonValue): boolean {
  if (left === undefined) return false;
  return canonicalJson(left) === canonicalJson(right);
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
