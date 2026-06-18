/**
 * Distinguishes retryable network/rate-limit failures from permanent
 * validation or authentication failures so BullMQ processors can
 * decide whether to retry a job or mark it as permanently failed.
 */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly provider: string;

  constructor(opts: {
    message: string;
    provider: string;
    retryable: boolean;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'ProviderError';
    this.provider = opts.provider;
    this.retryable = opts.retryable;
    this.statusCode = opts.statusCode;
    if (opts.cause) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }

  static retryable(provider: string, message: string, statusCode?: number): ProviderError {
    return new ProviderError({ message, provider, retryable: true, statusCode });
  }

  static permanent(provider: string, message: string, statusCode?: number): ProviderError {
    return new ProviderError({ message, provider, retryable: false, statusCode });
  }
}

/**
 * Classify an HTTP status code as retryable or permanent.
 * 429 / 5xx = retryable; 4xx (except 429) = permanent.
 */
export function classifyHttpStatus(
  provider: string,
  status: number,
  body: string,
): ProviderError {
  if (status === 429 || status >= 500) {
    return ProviderError.retryable(provider, `HTTP ${status}: ${body}`, status);
  }
  return ProviderError.permanent(provider, `HTTP ${status}: ${body}`, status);
}
