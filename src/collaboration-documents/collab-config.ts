/**
 * Shared config helpers for the collaboration documents REST layer. Kept
 * separate from collaboration-yjs/ so the Nest API never needs to import
 * server-process-only code, while still agreeing on the same defaults.
 */

export function resolveCollabWsUrl(): string {
  const explicit = process.env.COLLAB_PUBLIC_URL;
  if (explicit) return explicit;

  const port =
    process.env.COLLAB_HOST_PORT ?? process.env.COLLAB_PORT ?? '3012';
  return `ws://localhost:${port}`;
}

export function isRedisConfiguredForCollab(): boolean {
  return Boolean(process.env.REDIS_HOST);
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}
