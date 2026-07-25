import { registerAs } from '@nestjs/config';

export interface Mesh2MotionConfig {
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

function resolveAnimatorUrl(): string {
  const explicit =
    process.env['ANIMATOR_URL'] ?? process.env['MESH2MOTION_URL'] ?? '';
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const host = process.env['ANIMATOR_HOST'] ?? '';
  if (!host) {
    return '';
  }
  const port = process.env['ANIMATOR_PORT'] ?? '8010';
  const scheme = process.env['ANIMATOR_SCHEME'] ?? 'http';
  return `${scheme}://${host}:${port}`.replace(/\/$/, '');
}

/**
 * Server-only animator / Mesh2Motion worker configuration (separate CPU VPS).
 * Never expose these values with VITE_ / NEXT_PUBLIC_ prefixes.
 *
 * Preferred: ANIMATOR_URL=http://69.62.65.80:8010
 * Or: ANIMATOR_HOST=69.62.65.80 (defaults port 8010)
 */
export const mesh2MotionConfig = registerAs(
  'mesh2motion',
  (): Mesh2MotionConfig => {
    const url = resolveAnimatorUrl();
    const apiKey = process.env['ANIMATOR_API_KEY'] ?? process.env['MESH2MOTION_API_KEY'] ?? '';
    const enabled = Boolean(url);

    return {
      url,
      apiKey,
      enabled,
      requestTimeoutMs: Number(
        process.env['ANIMATOR_TIMEOUT_MS'] ??
          process.env['MESH2MOTION_TIMEOUT_MS'] ??
          120_000,
      ),
      pollIntervalMs: Number(
        process.env['ANIMATOR_POLL_INTERVAL_MS'] ??
          process.env['MESH2MOTION_POLL_INTERVAL_MS'] ??
          2_000,
      ),
      jobTimeoutMs: Number(
        process.env['ANIMATOR_JOB_TIMEOUT_MS'] ??
          process.env['MESH2MOTION_JOB_TIMEOUT_MS'] ??
          30 * 60_000,
      ),
      signedDownloadTtlSec: Number(
        process.env['ANIMATOR_SIGNED_DOWNLOAD_TTL_SEC'] ??
          process.env['MESH2MOTION_SIGNED_DOWNLOAD_TTL_SEC'] ??
          30 * 60,
      ),
      signedUploadTtlHintSec: Number(
        process.env['ANIMATOR_SIGNED_UPLOAD_TTL_SEC'] ??
          process.env['MESH2MOTION_SIGNED_UPLOAD_TTL_SEC'] ??
          2 * 60 * 60,
      ),
    };
  },
);
