import { createHash } from 'node:crypto';
import { JsonValueSchema, type JsonValue } from './common.js';

/**
 * RFC 8785 JSON Canonicalization Scheme. Inputs must be representable as JSON;
 * NaN, Infinity, undefined, bigint, functions, and cyclic objects are rejected.
 */
export function canonicalJson(value: unknown): string {
  const jsonValue = JsonValueSchema.parse(value);
  return serializeCanonicalValue(jsonValue);
}

function serializeCanonicalValue(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError('Value cannot be represented as canonical JSON');
    }
    return serialized;
  }

  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalValue).join(',')}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const child = value[key];
      return `${JSON.stringify(key)}:${serializeCanonicalValue(child)}`;
    });
  return `{${entries.join(',')}}`;
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}
