import { json, urlencoded } from 'express';
import type { Request, RequestHandler } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Applied to most API routes (Express default). */
export const DEFAULT_BODY_SIZE_LIMIT = '100kb';

/** Applied only to asset upload routes that carry base64 payloads. */
export const DEFAULT_LARGE_BODY_SIZE_LIMIT = '100mb';

/**
 * POST routes that accept large base64 bodies.
 * - /projects/:projectId/assets/upload
 * - /projects/:projectId/assets/:assetId/chunks
 * - /integrations/google-drive/export (.vkts and other binary exports)
 */
const LARGE_BODY_UPLOAD_ROUTE =
  /^\/projects\/[^/]+\/assets(?:\/upload|\/[^/]+\/chunks)$/;

const LARGE_BODY_INTEGRATION_EXPORT_ROUTE =
  /^\/integrations\/google-drive\/export$/;

export function isLargeBodyUploadRoute(path: string, method: string): boolean {
  if (method !== 'POST') return false;
  return (
    LARGE_BODY_UPLOAD_ROUTE.test(path) ||
    LARGE_BODY_INTEGRATION_EXPORT_ROUTE.test(path)
  );
}

/**
 * Nest's default platform is Express (`@nestjs/platform-express`). Body parsing is
 * Express middleware — `app.useBodyParser()` is a thin wrapper around `express.json`.
 *
 * Nest does not expose per-route body limits, so we disable the built-in parser and
 * attach conditional parsers here (same middleware Nest would register globally).
 */
export function configureHttpBodyParsers(app: NestExpressApplication): void {
  const defaultLimit = process.env.API_BODY_SIZE_LIMIT ?? DEFAULT_BODY_SIZE_LIMIT;
  const largeLimit =
    process.env.API_LARGE_BODY_SIZE_LIMIT ?? DEFAULT_LARGE_BODY_SIZE_LIMIT;

  const jsonParsers = {
    default: json({ limit: defaultLimit }),
    large: json({ limit: largeLimit }),
  };
  const urlencodedParsers = {
    default: urlencoded({ limit: defaultLimit, extended: true }),
    large: urlencoded({ limit: largeLimit, extended: true }),
  };

  const selectParser = (
    parsers: { default: RequestHandler; large: RequestHandler },
    req: Request,
  ): RequestHandler =>
    isLargeBodyUploadRoute(req.path, req.method) ? parsers.large : parsers.default;

  app.use((req, res, next) => selectParser(jsonParsers, req)(req, res, next));
  app.use((req, res, next) => selectParser(urlencodedParsers, req)(req, res, next));
}
