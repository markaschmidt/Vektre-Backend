import { Logger } from '@nestjs/common';
import { classifyHttpStatus, ProviderError } from './provider-error.model.js';

const logger = new Logger('OutboundHttp');

export interface OutboundRequestOptions {
  /** Provider name used in logs and error classification */
  provider: string;
  /** Request URL */
  url: string;
  /** HTTP method, defaults to GET */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request headers – bearer tokens are redacted in logs */
  headers?: Record<string, string>;
  /** JSON-serialisable request body */
  body?: unknown;
  /** Timeout in milliseconds, defaults to 30 000 */
  timeoutMs?: number;
  /** requestId for structured logging */
  requestId?: string;
  /** userId for structured logging */
  userId?: string;
}

export interface OutboundResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

/**
 * Typed JSON fetch wrapper with:
 * - AbortController timeout
 * - Automatic ProviderError classification (retryable vs permanent)
 * - Redacted bearer token logging
 */
export async function outboundJson<T = unknown>(
  opts: OutboundRequestOptions,
): Promise<OutboundResponse<T>> {
  const {
    provider,
    url,
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 30_000,
    requestId,
    userId,
  } = opts;

  const redactedHeaders = redactHeaders(headers);
  logger.debug(
    JSON.stringify({
      event: 'outbound_request',
      provider,
      method,
      url,
      headers: redactedHeaders,
      requestId,
      userId,
    }),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      throw ProviderError.retryable(
        provider,
        `Request timed out after ${timeoutMs}ms`,
      );
    }
    throw ProviderError.retryable(provider, `Network error: ${String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();

  logger.debug(
    JSON.stringify({
      event: 'outbound_response',
      provider,
      url,
      status: response.status,
      requestId,
      userId,
    }),
  );

  if (!response.ok) {
    throw classifyHttpStatus(provider, response.status, text.slice(0, 400));
  }

  let data: T;
  try {
    data = text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw ProviderError.permanent(
      provider,
      `Invalid JSON response: ${text.slice(0, 200)}`,
    );
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return { status: response.status, headers: responseHeaders, data };
}

export interface OutboundMultipartOptions
  extends Omit<OutboundRequestOptions, 'body'> {
  /** multipart/form-data fields (strings or Blobs/Files/Buffers). */
  form: Record<string, string | Blob | Buffer | Array<string | Blob | Buffer>>;
}

/**
 * Typed multipart fetch wrapper (e.g. OpenAI /v1/images/edits).
 * Does not force Content-Type so fetch can set the multipart boundary.
 */
export async function outboundMultipart<T = unknown>(
  opts: OutboundMultipartOptions,
): Promise<OutboundResponse<T>> {
  const {
    provider,
    url,
    method = 'POST',
    headers = {},
    form,
    timeoutMs = 30_000,
    requestId,
    userId,
  } = opts;

  const formData = new FormData();
  for (const [key, value] of Object.entries(form)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (typeof entry === 'string') {
        formData.append(key, entry);
      } else if (Buffer.isBuffer(entry)) {
        formData.append(
          key,
          new Blob([new Uint8Array(entry)]),
          `${key}.bin`,
        );
      } else {
        formData.append(key, entry);
      }
    }
  }

  const redactedHeaders = redactHeaders(headers);
  logger.debug(
    JSON.stringify({
      event: 'outbound_multipart_request',
      provider,
      method,
      url,
      headers: redactedHeaders,
      formKeys: Object.keys(form),
      requestId,
      userId,
    }),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Strip Content-Type so undici sets multipart boundary automatically.
  const { 'Content-Type': _ignored, 'content-type': _ignored2, ...rest } =
    headers;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: rest,
      body: formData,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      throw ProviderError.retryable(
        provider,
        `Request timed out after ${timeoutMs}ms`,
      );
    }
    throw ProviderError.retryable(provider, `Network error: ${String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();

  logger.debug(
    JSON.stringify({
      event: 'outbound_multipart_response',
      provider,
      url,
      status: response.status,
      requestId,
      userId,
    }),
  );

  if (!response.ok) {
    throw classifyHttpStatus(provider, response.status, text.slice(0, 400));
  }

  let data: T;
  try {
    data = text.length > 0 ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw ProviderError.permanent(
      provider,
      `Invalid JSON response: ${text.slice(0, 200)}`,
    );
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return { status: response.status, headers: responseHeaders, data };
}

/**
 * Download binary content as a Buffer (e.g. model assets, images).
 */
export async function outboundBinary(
  opts: Omit<OutboundRequestOptions, 'body'>,
): Promise<Buffer> {
  const { provider, url, headers = {}, timeoutMs = 60_000, requestId, userId } = opts;

  logger.debug(
    JSON.stringify({
      event: 'outbound_binary_request',
      provider,
      url,
      requestId,
      userId,
    }),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      throw ProviderError.retryable(
        provider,
        `Binary download timed out after ${timeoutMs}ms`,
      );
    }
    throw ProviderError.retryable(provider, `Network error: ${String(err)}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw classifyHttpStatus(provider, response.status, text.slice(0, 400));
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Redact Authorization and similar sensitive headers for safe logging.
 */
function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'authorization' || lower === 'x-api-key') {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}
