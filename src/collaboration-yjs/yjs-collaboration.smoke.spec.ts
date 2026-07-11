import { Hocuspocus, type onAuthenticatePayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import { buildCollabHooks } from './collab-hooks.js';
import { buildDocumentName, buildSessionRoomName } from './document-name.js';

/**
 * End-to-end smoke test for the Yjs collaboration wiring. Rather than
 * spinning up a real WebSocket server + client pair (which would require a
 * `ws`/y-websocket client dependency purely for tests), this uses
 * Hocuspocus's own in-process `DirectConnection` API against a real
 * `Hocuspocus` instance configured with our actual onLoadDocument /
 * onStoreDocument hooks (`buildCollabHooks`, the same config the standalone
 * server in yjs-server.ts uses). Two direct connections opened for the same
 * documentName share the same in-memory Y.Doc room exactly like two
 * WebSocket clients would, so this genuinely exercises "does an edit from
 * one collaborator become visible to another collaborator on the same
 * document, and does it get durably persisted" — the core Google-Docs-style
 * guarantee — without reimplementing the Yjs wire protocol in a test.
 *
 * Cursor/selection *awareness* broadcasting itself is not re-tested here: it
 * is provided by Hocuspocus's own (unmodified, independently maintained)
 * awareness protocol rather than custom code in this module, and
 * `DirectConnection` does not go through the WebSocket awareness channel.
 * `onAuthenticate`'s RBAC gating is unit-tested directly below since
 * `openDirectConnection` intentionally bypasses it (it's a trusted,
 * server-side API, not a client entry point).
 */

const fakeStorage = new Map<string, Uint8Array>();

jest.mock('./collab-persistence.js', () => ({
  getCollabBucket: () => 'test-bucket',
  snapshotVersionObjectPath: () => 'unused',
  loadDocumentSnapshot(parsed: { documentKey: string }, document: Y.Doc) {
    const bytes = fakeStorage.get(parsed.documentKey);
    if (bytes) Y.applyUpdate(document, bytes);
    return Promise.resolve();
  },
  storeDocumentSnapshot(parsed: { documentKey: string }, document: Y.Doc) {
    fakeStorage.set(parsed.documentKey, Y.encodeStateAsUpdate(document));
    return Promise.resolve();
  },
}));

jest.mock('./collab-auth.js', () => ({
  verifyCollabToken: jest.fn(),
}));

jest.mock('./collab-rbac.js', () => ({
  resolveProjectAccess: jest.fn(),
}));

import { verifyCollabToken } from './collab-auth.js';
import { resolveProjectAccess } from './collab-rbac.js';
import { clearCollabAuthCache } from './collab-auth-cache.js';

describe('Yjs collaboration smoke test (multi-surface)', () => {
  beforeEach(() => {
    fakeStorage.clear();
    clearCollabAuthCache();
    jest.clearAllMocks();
  });

  it.each(['storyboard', 'foundry', 'canvas', 'gui_screen'] as const)(
    'propagates a live edit from one collaborator to another in the same %s document room',
    async (documentType) => {
      const instance = new Hocuspocus({ ...buildCollabHooks() });
      const documentName = buildDocumentName('proj-1', 'doc-1', documentType);

      const connectionA = await instance.openDirectConnection(documentName, {
        user: { id: 'user-a' },
      });
      const connectionB = await instance.openDirectConnection(documentName, {
        user: { id: 'user-b' },
      });

      await connectionA.transact((document) => {
        document.getText('content').insert(0, 'Hello from A');
      });

      // Same room (same in-memory Y.Doc) — B sees A's edit without any
      // explicit sync step, exactly like two live WebSocket clients would.
      expect(connectionB.document?.getText('content').toJSON()).toBe(
        'Hello from A',
      );

      await connectionB.transact((document) => {
        document.getMap('meta').set('lastEditor', 'user-b');
      });
      expect(connectionA.document?.getMap('meta').get('lastEditor')).toBe(
        'user-b',
      );

      await connectionA.disconnect();
      await connectionB.disconnect();

      // onStoreDocument (via storeDocumentSnapshot) persisted the merged state.
      expect(fakeStorage.has(`project:proj-1:doc:${documentType}:doc-1`)).toBe(
        true,
      );
    },
  );

  it('reloads previously persisted content into a brand new server instance (durability across restarts)', async () => {
    const documentName = buildDocumentName('proj-1', 'doc-2', 'storyboard');

    const firstInstance = new Hocuspocus({ ...buildCollabHooks() });
    const firstConnection = await firstInstance.openDirectConnection(
      documentName,
      {
        user: { id: 'user-a' },
      },
    );
    await firstConnection.transact((document) => {
      document.getText('content').insert(0, 'Persisted content');
    });
    await firstConnection.disconnect();

    // Simulates the collab server restarting / a second instance picking up
    // the room: a fresh Hocuspocus instance has no in-memory document, so
    // this only passes if onLoadDocument actually restores from storage.
    const secondInstance = new Hocuspocus({ ...buildCollabHooks() });
    const secondConnection = await secondInstance.openDirectConnection(
      documentName,
      {
        user: { id: 'user-b' },
      },
    );
    expect(secondConnection.document?.getText('content').toJSON()).toBe(
      'Persisted content',
    );
    await secondConnection.disconnect();
  });

  it('keeps each document type in its own isolated room', async () => {
    const instance = new Hocuspocus({ ...buildCollabHooks() });
    const storyboardName = buildDocumentName('proj-1', 'doc-3', 'storyboard');
    const canvasName = buildDocumentName('proj-1', 'doc-3', 'canvas');

    const storyboardConn = await instance.openDirectConnection(storyboardName, {
      user: { id: 'user-a' },
    });
    await storyboardConn.transact((document) => {
      document.getText('content').insert(0, 'Storyboard text');
    });

    const canvasConn = await instance.openDirectConnection(canvasName, {
      user: { id: 'user-a' },
    });
    expect(canvasConn.document?.getText('content').toJSON()).toBe('');

    await storyboardConn.disconnect();
    await canvasConn.disconnect();
  });

  it('accepts a project session room alongside a document room on the same server instance', async () => {
    const instance = new Hocuspocus({ ...buildCollabHooks() });
    const sessionName = buildSessionRoomName('proj-1');
    const documentName = buildDocumentName('proj-1', 'doc-4', 'storyboard');

    const sessionConn = await instance.openDirectConnection(sessionName, {
      user: { id: 'user-a' },
    });
    const documentConn = await instance.openDirectConnection(documentName, {
      user: { id: 'user-a' },
    });

    await documentConn.transact((document) => {
      document.getText('content').insert(0, 'Scoped doc edit');
    });

    expect(documentConn.document?.getText('content').toJSON()).toBe(
      'Scoped doc edit',
    );
    // Session room is awareness-only — no durable snapshot key for session rooms.
    expect(fakeStorage.has(sessionName)).toBe(false);
    expect(fakeStorage.has(documentName)).toBe(false);

    await sessionConn.disconnect();
    await documentConn.disconnect();
  });
});

describe('collab-hooks onAuthenticate (RBAC gating)', () => {
  const requestHeaders = new Headers();
  const requestParameters = new URLSearchParams();

  function buildPayload(
    token: string,
    documentName: string,
  ): onAuthenticatePayload {
    return {
      token,
      documentName,
      connectionConfig: { readOnly: false },
      requestHeaders,
      requestParameters,
    } as unknown as onAuthenticatePayload;
  }

  beforeEach(() => {
    clearCollabAuthCache();
    jest.clearAllMocks();
  });

  it('grants write access and returns user context for an editor', async () => {
    (verifyCollabToken as jest.Mock).mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
    });
    (resolveProjectAccess as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      projectId: 'proj-1',
      role: 'editor',
      canWrite: true,
    });

    const payload = buildPayload(
      'token-abc',
      'project:proj-1:doc:storyboard:doc-1',
    );
    const result = await buildCollabHooks().onAuthenticate(payload);

    expect(payload.connectionConfig.readOnly).toBe(false);
    expect(result).toEqual({
      user: { id: 'user-1', name: 'a@b.com', role: 'editor' },
    });
  });

  it('marks the connection read-only for viewers', async () => {
    (verifyCollabToken as jest.Mock).mockResolvedValue({ id: 'user-2' });
    (resolveProjectAccess as jest.Mock).mockResolvedValue({
      userId: 'user-2',
      projectId: 'proj-1',
      role: 'viewer',
      canWrite: false,
    });

    const payload = buildPayload(
      'token-abc',
      'project:proj-1:doc:storyboard:doc-1',
    );
    await buildCollabHooks().onAuthenticate(payload);

    expect(payload.connectionConfig.readOnly).toBe(true);
  });

  it('rejects connections to malformed document names before verifying the token', async () => {
    const payload = buildPayload('token-abc', 'not-a-valid-name');
    await expect(buildCollabHooks().onAuthenticate(payload)).rejects.toThrow();
    expect(verifyCollabToken).not.toHaveBeenCalled();
  });

  it('propagates auth failures', async () => {
    (verifyCollabToken as jest.Mock).mockRejectedValue(
      new Error('Invalid or expired collaboration token'),
    );

    const payload = buildPayload(
      'bad-token',
      'project:proj-1:doc:storyboard:doc-1',
    );
    await expect(buildCollabHooks().onAuthenticate(payload)).rejects.toThrow(
      'Invalid or expired collaboration token',
    );
  });

  it('authenticates project session rooms with the same RBAC checks', async () => {
    (verifyCollabToken as jest.Mock).mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
    });
    (resolveProjectAccess as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      projectId: 'proj-1',
      role: 'editor',
      canWrite: true,
    });

    const payload = buildPayload('token-abc', 'project:proj-1:session');
    const result = await buildCollabHooks().onAuthenticate(payload);

    expect(payload.connectionConfig.readOnly).toBe(false);
    expect(result.user).toEqual({
      id: 'user-1',
      name: 'a@b.com',
      role: 'editor',
    });
    expect(resolveProjectAccess).toHaveBeenCalledWith(
      'user-1',
      'proj-1',
      'viewer',
    );
  });

  it('skips persistence hooks for session rooms', async () => {
    const hooks = buildCollabHooks();
    const document = new Y.Doc();

    await expect(
      hooks.onLoadDocument({
        document,
        documentName: 'project:proj-1:session',
      } as Parameters<typeof hooks.onLoadDocument>[0]),
    ).resolves.toBeUndefined();

    await expect(
      hooks.onStoreDocument({
        document,
        documentName: 'project:proj-1:session',
        lastContext: { user: { id: 'user-1' } },
      } as Parameters<typeof hooks.onStoreDocument>[0]),
    ).resolves.toBeUndefined();
  });
});
