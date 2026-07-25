import { registerAs } from '@nestjs/config';

export interface RigAnythingConfig {
  url: string;
  apiKey: string;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  jobTimeoutMs: number;
  signedDownloadTtlSec: number;
  signedUploadTtlHintSec: number;
  /** When false, module still loads but createJob fails fast. */
  enabled: boolean;
}

/**
 * Server-only RigAnything / RunPod worker configuration.
 * Never expose these values with VITE_ / NEXT_PUBLIC_ prefixes.
 */
export const rigAnythingConfig = registerAs(
  'riganything',
  (): RigAnythingConfig => {
    const url = (process.env['RIGANYTHING_URL'] ?? '').replace(/\/$/, '');
    const apiKey = process.env['RIGANYTHING_API_KEY'] ?? '';
    const enabled = Boolean(url && apiKey);

    return {
      url,
      apiKey,
      enabled,
      requestTimeoutMs: Number(process.env['RIGANYTHING_TIMEOUT_MS'] ?? 30_000),
      pollIntervalMs: Number(process.env['RIGANYTHING_POLL_INTERVAL_MS'] ?? 3_000),
      jobTimeoutMs: Number(
        process.env['RIGANYTHING_JOB_TIMEOUT_MS'] ?? 45 * 60_000,
      ),
      signedDownloadTtlSec: Number(
        process.env['RIGANYTHING_SIGNED_DOWNLOAD_TTL_SEC'] ?? 30 * 60,
      ),
      signedUploadTtlHintSec: Number(
        process.env['RIGANYTHING_SIGNED_UPLOAD_TTL_SEC'] ?? 2 * 60 * 60,
      ),
    };
  },
);
