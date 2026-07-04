import type {
  onAuthenticatePayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import {
  assertValidCollabRoomName,
  isDocumentRoom,
  isSessionRoom,
  type ParsedCollabRoom,
} from './document-name.js';
import { verifyCollabToken } from './collab-auth.js';
import {
  getCachedCollabUser,
  getCachedProjectAccess,
  setCachedCollabUser,
  setCachedProjectAccess,
} from './collab-auth-cache.js';
import { resolveProjectAccess } from './collab-rbac.js';
import {
  loadDocumentSnapshot,
  storeDocumentSnapshot,
} from './collab-persistence.js';
import { collabLog } from './collab-log.js';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function roomLogKey(room: ParsedCollabRoom): string {
  return room.kind === 'session' ? room.roomKey : room.documentKey;
}

async function authenticateCollabRoom(
  authToken: string,
  room: ParsedCollabRoom,
  connectionConfig: { readOnly: boolean },
): Promise<{ user: Record<string, unknown> }> {
  let user = getCachedCollabUser(authToken);
  if (!user) {
    user = await verifyCollabToken(authToken);
    setCachedCollabUser(authToken, user);
  }

  let access = getCachedProjectAccess(user.id, room.projectId);
  if (!access) {
    access = await resolveProjectAccess(user.id, room.projectId, 'viewer');
    setCachedProjectAccess(access);
  }

  connectionConfig.readOnly = !access.canWrite;

  collabLog.info('collab_auth_success', {
    roomKind: room.kind,
    roomKey: roomLogKey(room),
    userId: user.id,
    role: access.role,
  });

  return {
    user: {
      id: user.id,
      name: user.displayName ?? user.email ?? user.id,
      role: access.role,
    },
  };
}

export interface CollabHooks {
  onAuthenticate: (
    data: onAuthenticatePayload,
  ) => Promise<{ user: Record<string, unknown> }>;
  onLoadDocument: (data: onLoadDocumentPayload) => Promise<void>;
  onStoreDocument: (data: onStoreDocumentPayload) => Promise<void>;
  onDisconnect: (data: onDisconnectPayload) => Promise<void>;
}

/**
 * Builds the document lifecycle + auth hooks shared by the real Hocuspocus
 * `Server` (yjs-server.ts, binds a real port) and by in-process tests that
 * exercise the same wiring via `new Hocuspocus({ ...buildCollabHooks() })`
 * and `openDirectConnection`, without binding any network socket.
 */
export function buildCollabHooks(): CollabHooks {
  return {
    async onAuthenticate({
      token,
      documentName,
      connectionConfig,
      requestHeaders,
      requestParameters,
    }) {
      let room: ParsedCollabRoom;
      try {
        room = assertValidCollabRoomName(documentName);
      } catch (err) {
        collabLog.warn('collab_auth_invalid_room_name', {
          documentName,
          error: message(err),
        });
        throw err;
      }

      const authHeader =
        requestHeaders.get('authorization') ??
        requestHeaders.get('Authorization');
      const bearerToken = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;
      const queryToken =
        requestParameters.get('token') ??
        requestParameters.get('access_token') ??
        undefined;

      if (!bearerToken && queryToken) {
        // Query-string tokens can leak into proxy/access logs — prefer the
        // Authorization header. Not fatal, just flagged for follow-up.
        collabLog.warn('collab_auth_query_token_fallback', {
          roomKey: roomLogKey(room),
        });
      }

      const authToken = String(token || bearerToken || queryToken || '');

      try {
        return await authenticateCollabRoom(authToken, room, connectionConfig);
      } catch (err) {
        collabLog.warn('collab_auth_failed', {
          roomKey: roomLogKey(room),
          error: message(err),
        });
        throw err;
      }
    },

    async onLoadDocument({ document, documentName }) {
      const room = assertValidCollabRoomName(documentName);
      if (isSessionRoom(room)) {
        // Session rooms carry awareness only — no durable Yjs snapshot to load.
        collabLog.info('collab_session_loaded', { roomKey: room.roomKey });
        return;
      }

      try {
        await loadDocumentSnapshot(room, document);
        collabLog.info('collab_document_loaded', {
          documentKey: room.documentKey,
        });
      } catch (err) {
        collabLog.error('collab_document_load_failed', {
          documentKey: room.documentKey,
          error: message(err),
        });
        throw err;
      }
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const room = assertValidCollabRoomName(documentName);
      if (isSessionRoom(room)) {
        // Awareness-only rooms must never create collaboration_document rows
        // or write to Supabase Storage.
        return;
      }

      const userId = String(
        (lastContext as { user?: { id?: string } })?.user?.id ?? 'system',
      );
      try {
        await storeDocumentSnapshot(room, document, userId);
        collabLog.info('collab_document_stored', {
          documentKey: room.documentKey,
          userId,
        });
      } catch (err) {
        collabLog.error('collab_document_store_failed', {
          documentKey: room.documentKey,
          userId,
          error: message(err),
        });
        throw err;
      }
    },

    onDisconnect({ documentName }) {
      const room = assertValidCollabRoomName(documentName);
      if (isSessionRoom(room)) {
        collabLog.info('collab_session_disconnect', { roomKey: room.roomKey });
      } else if (isDocumentRoom(room)) {
        collabLog.info('collab_disconnect', {
          documentKey: room.documentKey,
        });
      }
      return Promise.resolve();
    },
  };
}
