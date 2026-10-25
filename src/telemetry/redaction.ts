import { createHash } from 'node:crypto';

export const ERROR_CATEGORIES = [
  'rate_limited',
  'timeout',
  'worker_unavailable',
  'worker_result_invalid',
  'validation_failed',
  'cancelled',
  'auth_failed',
  'unknown',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

const SECRET_KEY =
  /(authorization|api[-_]?key|secret|password|token|cookie|set-cookie|bearer|private[-_]?key)/i;
const CONTENT_KEY =
  /(prompt|message|messages|body|comment|content|document|output|completion|image|bytes|caption|notes|text_value|signed)/i;
const URL_KEY = /(url|href|uri|location)/i;

const JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const SIGNED_URL = /[?&](token|signature|sig|X-Amz-Signature)=/i;
const DATA_IMAGE = /^data:image\//i;
const SUPABASE_SIGN = /\/storage\/v1\/object\/sign\//i;

export type RedactionKind = 'secret' | 'content' | 'url';

export interface RedactionPlaceholder {
  redacted: true;
  kind: RedactionKind;
  hash?: string;
  count?: number;
}

export function redactTelemetryValue(
  value: unknown,
  keyHint = '',
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value, keyHint);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (CONTENT_KEY.test(keyHint) || SECRET_KEY.test(keyHint)) {
      return placeholder('content', value, arrayCount(value));
    }
    return value.map((item) => redactTelemetryValue(item, keyHint));
  }
  if (typeof value === 'object') {
    if (CONTENT_KEY.test(keyHint) || SECRET_KEY.test(keyHint)) {
      return placeholder('content', value);
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = redactTelemetryValue(child, key);
    }
    return out;
  }
  return placeholder('content', String(value));
}

export function redactAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return redactTelemetryValue(attributes) as Record<string, unknown>;
}

export function sanitizeErrorCategory(
  error: unknown,
  fallback: ErrorCategory = 'unknown',
): ErrorCategory {
  const status =
    typeof error === 'object' && error && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_failed';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('rate') && lower.includes('limit')) return 'rate_limited';
  if (lower.includes('cancelled') || lower.includes('canceled')) {
    return 'cancelled';
  }
  if (lower.includes('validat')) return 'validation_failed';
  if (
    typeof error === 'object' &&
    error &&
    'retryable' in error &&
    (error as { retryable?: boolean }).retryable
  ) {
    return 'worker_unavailable';
  }
  if (ERROR_CATEGORIES.includes(fallback)) return fallback;
  return 'unknown';
}

export function looksLikeSensitiveText(value: string): boolean {
  return (
    JWT.test(value) ||
    SIGNED_URL.test(value) ||
    DATA_IMAGE.test(value) ||
    SUPABASE_SIGN.test(value)
  );
}

function redactString(value: string, keyHint: string): unknown {
  if (SECRET_KEY.test(keyHint) || JWT.test(value)) {
    return placeholder('secret', value);
  }
  if (
    URL_KEY.test(keyHint) ||
    SIGNED_URL.test(value) ||
    DATA_IMAGE.test(value) ||
    SUPABASE_SIGN.test(value)
  ) {
    return placeholder('url', value);
  }
  if (CONTENT_KEY.test(keyHint)) {
    return placeholder('content', value, value.length);
  }
  return value;
}

function placeholder(
  kind: RedactionKind,
  value: unknown,
  count?: number,
): RedactionPlaceholder {
  const serialized =
    typeof value === 'string' ? value : stableSerialize(value);
  return {
    redacted: true,
    kind,
    hash: createHash('sha256').update(serialized).digest('hex'),
    ...(count != null ? { count } : {}),
  };
}

function arrayCount(value: unknown[]): number {
  return value.reduce<number>(
    (sum, item) => sum + (typeof item === 'string' ? item.length : 1),
    0,
  );
}

function stableSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
