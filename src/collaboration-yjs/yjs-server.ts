import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Server } from '@hocuspocus/server';
import { Redis } from '@hocuspocus/extension-redis';
import { assertValidDocumentName } from './document-name.js';
import { verifyCollabToken } from './collab-auth.js';
import { resolveProjectAccess } from './collab-rbac.js';
import { loadDocumentSnapshot, storeDocumentSnapshot } from './collab-persistence.js';

const port = Number(process.env.COLLAB_PORT ?? 3012);
const debounceMs = Number(process.env.COLLAB_STORE_DEBOUNCE_MS ?? 2000);
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

const server = new Server({
  port,
  extensions: redisExtension ? [redisExtension] : [],
  debounce: debounceMs,
  maxDebounce: debounceMs * 3,

  async onAuthenticate({ token, documentName, connectionConfig, requestHeaders, requestParameters }) {
    const parsed = assertValidDocumentName(documentName);
    const authHeader = requestHeaders.get('authorization') ?? requestHeaders.get('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const queryToken =
      requestParameters.get('token') ?? requestParameters.get('access_token') ?? undefined;
    const authToken = String(token || bearerToken || queryToken || '');
    const user = await verifyCollabToken(authToken);
    const access = await resolveProjectAccess(user.id, parsed.projectId, 'viewer');

    connectionConfig.readOnly = !access.canWrite;

    return {
      user: {
        id: user.id,
        name: user.displayName ?? user.email ?? user.id,
        role: access.role,
      },
    };
  },

  async onLoadDocument({ document, documentName }) {
    const parsed = assertValidDocumentName(documentName);
    await loadDocumentSnapshot(parsed, document);
  },

  async onStoreDocument({ document, documentName, lastContext }) {
    const parsed = assertValidDocumentName(documentName);
    const userId = String((lastContext as { user?: { id?: string } })?.user?.id ?? 'system');
    await storeDocumentSnapshot(parsed, document, userId);
  },
});

server.listen();

console.log(
  `[collab] Yjs server listening on :${port}${redisExtension ? ' (redis enabled)' : ''}`,
);
