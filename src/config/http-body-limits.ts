import { json, raw, urlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Applied to most API routes (Express default). */
export const DEFAULT_BODY_SIZE_LIMIT = '100kb';

/** Applied only to asset upload routes that carry base64 payloads. */
export const DEFAULT_LARGE_BODY_SIZE_LIMIT = '100mb';

/**
 * POST routes that accept large base64 bodies.
 * - /projects/:projectId/assets/upload
 * - /projects/:projectId/assets/:assetId/chunks
 * - /organizations/logo/upload
 * - /organizations/:organizationId/logo
 * - /integrations/google-drive/export (.vkts and other binary exports)
 */
const LARGE_BODY_UPLOAD_ROUTE =
  /^\/projects\/[^/]+\/assets(?:\/upload|\/[^/]+\/chunks)$/;

const LARGE_BODY_ORG_LOGO_ROUTE =
  /^\/organizations(?:\/logo\/upload|\/[^/]+\/logo)$/;

const LARGE_BODY_INTEGRATION_EXPORT_ROUTE =
  /^\/integrations\/google-drive\/export$/;

const STRIPE_WEBHOOK_ROUTE = /^\/billing\/webhooks\/stripe$/;

export function isLargeBodyUploadRoute(path: string, method: string): boolean {
  if (method !== 'POST') return false;
  return (
    LARGE_BODY_UPLOAD_ROUTE.test(path) ||
    LARGE_BODY_ORG_LOGO_ROUTE.test(path) ||
    LARGE_BODY_INTEGRATION_EXPORT_ROUTE.test(path)
  );
}

export function isStripeWebhookRoute(path: string, method: string): boolean {
  return method === 'POST' && STRIPE_WEBHOOK_ROUTE.test(path);
}

/**
 * Nest's default platform is Express (`@nestjs/platform-express`). Body parsing is
 * Express middleware — `app.useBodyParser()` is a thin wrapper around `express.json`.
 *
 * Nest does not expose per-route body limits, so we disable the built-in parser and
 * attach conditional parsers here (same middleware Nest would register globally).
 * Stripe webhooks need the raw Buffer for signature verification.
 */
export function configureHttpBodyParsers(app: NestExpressApplication): void {
  const defaultLimit =
    process.env.API_BODY_SIZE_LIMIT ?? DEFAULT_BODY_SIZE_LIMIT;
  const largeLimit =
    process.env.API_LARGE_BODY_SIZE_LIMIT ?? DEFAULT_LARGE_BODY_SIZE_LIMIT;

  const stripeRaw = raw({ type: '*/*', limit: defaultLimit });
  const jsonParsers = {
    default: json({ limit: defaultLimit }),
    large: json({ limit: largeLimit }),
  };
  const urlencodedParsers = {
    default: urlencoded({ limit: defaultLimit, extended: true }),
    large: urlencoded({ limit: largeLimit, extended: true }),
  };

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isStripeWebhookRoute(req.path, req.method)) {
      return stripeRaw(req, res, (err) => {
        if (err) return next(err);
        (req as Request & { rawBody?: Buffer }).rawBody = req.body as Buffer;
        return next();
      });
    }

    const parser = isLargeBodyUploadRoute(req.path, req.method)
      ? jsonParsers.large
      : jsonParsers.default;
    return parser(req, res, next);
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isStripeWebhookRoute(req.path, req.method)) {
      return next();
    }
    const parser = isLargeBodyUploadRoute(req.path, req.method)
      ? urlencodedParsers.large
      : urlencodedParsers.default;
    return parser(req, res, next);
  });
}
