import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createServer } from 'node:http';
import { Server } from '@hocuspocus/server';
import { Redis } from '@hocuspocus/extension-redis';
import { buildCollabHooks } from './collab-hooks.js';
import { collabLog } from './collab-log.js';

const port = Number(process.env.COLLAB_PORT ?? 3012);
const debounceMs = Number(process.env.COLLAB_STORE_DEBOUNCE_MS ?? 2000);
const isProduction = process.env.NODE_ENV === 'production';
const redisIdentifier =
  process.env.COLLAB_REDIS_IDENTIFIER ??
  `vektre-collab-${hostname()}-${process.pid}-${randomUUID()}`;

function buildRedisExtension(): Redis | null {
  const host = process.env.REDIS_HOST;
  if (!host) return null;

  return new Redis({
    host,
    port: Number(process.env.REDIS_PORT ?? 6379),
    identifier: redisIdentifier,
    prefix: process.env.COLLAB_REDIS_PREFIX ?? 'vektre',
    options: process.env.REDIS_PASSWORD
      ? { password: process.env.REDIS_PASSWORD }
      : undefined,
  });
}

const redisExtension = buildRedisExtension();

// Without Redis fanout, running more than one collab instance silently
// drops cross-instance updates/awareness — fail fast in production rather
// than shipping a broken multi-instance deployment.
if (isProduction && !redisExtension) {
  throw new Error(
    'REDIS_HOST is required in production for the collaboration server (multi-instance Yjs fanout). ' +
      'Set REDIS_HOST/REDIS_PORT or run with NODE_ENV unset for local single-instance development.',
  );
}

const startedAt = Date.now();

const server = new Server({
  port,
  extensions: redisExtension ? [redisExtension] : [],
  debounce: debounceMs,
  maxDebounce: debounceMs * 3,
  ...buildCollabHooks(),
});

server.listen().catch((err: unknown) => {
  collabLog.error('collab_server_listen_failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

// A separate, tiny HTTP server for health/config reporting rather than
// Hocuspocus's own onRequest hook: that hook's error handling rethrows into
// an un-awaited async request listener, so a health check that tries to
// short-circuit the default "Welcome to Hocuspocus!" response there risks an
// unhandled rejection and crashing the process. Keeping health reporting on
// its own listener/port avoids that entirely.
const healthPort = Number(process.env.COLLAB_HEALTH_PORT ?? port + 1);
const healthServer = createServer((request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }

  const body = JSON.stringify({
    status: 'ok',
    redisEnabled: Boolean(redisExtension),
    redisRequired: isProduction,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    snapshotRetentionLimit: Number(
      process.env.COLLAB_SNAPSHOT_RETENTION ?? 200,
    ),
  });
  response.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
});
healthServer.on('error', (err) => {
  collabLog.error('collab_health_server_error', {
    error: err instanceof Error ? err.message : String(err),
  });
});
healthServer.listen(healthPort);

collabLog.info('collab_server_listening', {
  port,
  redisEnabled: Boolean(redisExtension),
  production: isProduction,
});
console.log(
  `[collab] Yjs server listening on :${port}${redisExtension ? ' (redis enabled)' : ''}`,
);
