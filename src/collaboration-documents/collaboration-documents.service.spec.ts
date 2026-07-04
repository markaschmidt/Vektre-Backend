import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CollaborationDocumentsService } from './collaboration-documents.service.js';
import type { AppDataService } from '../integrations/app-data.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { SupabaseService } from '../integrations/supabase.js';
import type {
  CollaborationActivityRow,
  CollaborationDocumentRow,
  CollaborationSnapshotRow,
  ProjectCommentRow,
} from '../integrations/app-data.types.js';

function makeDocumentRow(
  overrides: Partial<CollaborationDocumentRow> = {},
): CollaborationDocumentRow {
  return {
    documentKey: 'project:proj-1:doc:storyboard:doc-1',
    documentId: 'doc-1',
    projectId: 'proj-1',
    documentType: 'storyboard',
    title: 'Untitled',
    storageRef: null,
    version: 0,
    createdByUserId: 'user-1',
    updatedByUserId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeCommentRow(
  overrides: Partial<ProjectCommentRow> = {},
): ProjectCommentRow {
  return {
    commentId: 'cmt-1',
    projectId: 'proj-1',
    documentId: 'doc-1',
    authorUserId: 'user-1',
    body: 'hello',
    status: 'open',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeActivityRow(
  overrides: Partial<CollaborationActivityRow> = {},
): CollaborationActivityRow {
  return {
    activityId: 'act-1',
    projectId: 'proj-1',
    actorUserId: 'user-1',
    activityType: 'model_generation',
    status: 'pending',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('CollaborationDocumentsService', () => {
  let service: CollaborationDocumentsService;

  const appData = {
    resolveProjectAccessForUser: jest.fn(),
    getProjectMembership: jest.fn(),
    createCollaborationDocument: jest.fn(),
    listCollaborationDocuments: jest.fn(),
    getCollaborationDocumentById: jest.fn(),
    updateCollaborationDocument: jest.fn(),
    listCollaborationSnapshots: jest.fn(),
    getCollaborationSnapshotById: jest.fn(),
    createProjectComment: jest.fn(),
    getProjectComment: jest.fn(),
    listProjectComments: jest.fn(),
    updateProjectComment: jest.fn(),
    resolveProjectComment: jest.fn(),
    deleteProjectComment: jest.fn(),
    createCollaborationActivity: jest.fn(),
    getCollaborationActivity: jest.fn(),
    updateCollaborationActivity: jest.fn(),
    listActiveCollaborationActivity: jest.fn().mockResolvedValue([]),
    listUnreconciledCollaborationActivity: jest.fn().mockResolvedValue([]),
    getRequestStatus: jest.fn(),
    getProjectAssetByRequestId: jest.fn(),
  };

  const notifications = {
    notifyCommentMention: jest.fn().mockResolvedValue(undefined),
    notifyCommentReply: jest.fn().mockResolvedValue(undefined),
  };

  const supabase = {
    downloadObject: jest.fn(),
    uploadObject: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    appData.listActiveCollaborationActivity.mockResolvedValue([]);
    appData.listUnreconciledCollaborationActivity.mockResolvedValue([]);
    appData.listCollaborationDocuments.mockResolvedValue([]);
    // Owner access by default; individual tests override for role-gating checks.
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: { projectId: 'proj-1', ownerUserId: 'user-1', name: 'Demo' },
    });
    appData.getProjectMembership.mockResolvedValue(null);

    service = new CollaborationDocumentsService(
      appData as unknown as AppDataService,
      notifications as unknown as NotificationsService,
      supabase as unknown as SupabaseService,
    );
  });

  function asMember(role: string) {
    appData.resolveProjectAccessForUser.mockResolvedValue({
      ok: true,
      project: { projectId: 'proj-1', ownerUserId: 'owner-x', name: 'Demo' },
    });
    appData.getProjectMembership.mockResolvedValue({ role, status: 'active' });
  }

  describe('getCollaborationConfig', () => {
    it('returns writer permissions for the project owner', async () => {
      const config = await service.getCollaborationConfig('proj-1', 'user-1');
      expect(config.role).toBe('owner');
      expect(config.canWrite).toBe(true);
      expect(config.canComment).toBe(true);
      expect(config.surfaces.length).toBeGreaterThan(0);
      expect(config.provider).toEqual({
        sharedWebsocket: true,
        multiplexing: true,
        sessionAwareness: true,
        projectSessionRoomName: 'project:proj-1:session',
      });
      expect(config.roomNaming.projectSession).toBe('project:proj-1:session');
    });

    it('returns read-only permissions for viewers', async () => {
      asMember('viewer');
      const config = await service.getCollaborationConfig('proj-1', 'user-2');
      expect(config.role).toBe('viewer');
      expect(config.canWrite).toBe(false);
      expect(config.canComment).toBe(false);
    });
  });

  describe('createDocument', () => {
    it('creates a document when the caller has editor access', async () => {
      appData.createCollaborationDocument.mockResolvedValue(makeDocumentRow());

      const result = await service.createDocument('proj-1', 'user-1', {
        documentType: 'storyboard',
        title: 'My doc',
      });

      expect(appData.createCollaborationDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          documentType: 'storyboard',
        }),
      );
      expect(result.connection.documentType).toBe('storyboard');
      expect(result.connection.documentName).toContain('proj-1');
    });

    it('rejects viewers from creating documents', async () => {
      asMember('viewer');
      await expect(
        service.createDocument('proj-1', 'user-2', { documentType: 'canvas' }),
      ).rejects.toThrow(ForbiddenException);
      expect(appData.createCollaborationDocument).not.toHaveBeenCalled();
    });

    it('reuses the existing non-archived document of the same type instead of creating a duplicate', async () => {
      const existing = makeDocumentRow({ documentId: 'doc-existing' });
      appData.listCollaborationDocuments.mockResolvedValue([existing]);

      const result = await service.createDocument('proj-1', 'user-1', {
        documentType: 'storyboard',
        title: 'Storyboard document',
      });

      expect(appData.createCollaborationDocument).not.toHaveBeenCalled();
      expect(result.documentId).toBe('doc-existing');
      expect(appData.listCollaborationDocuments).toHaveBeenCalledWith(
        'proj-1',
        {
          documentType: 'storyboard',
        },
      );
    });

    it('falls back to the winning row when two concurrent opens race past the existence check', async () => {
      // Both concurrent callers see no existing document...
      appData.listCollaborationDocuments.mockResolvedValueOnce([]);
      // ...but the insert loses a race against the DB's unique index.
      appData.createCollaborationDocument.mockRejectedValue(
        new Error(
          'createCollaborationDocument: duplicate key value violates unique constraint "idx_collaboration_document_project_type_singleton"',
        ),
      );
      const winner = makeDocumentRow({ documentId: 'doc-winner' });
      appData.listCollaborationDocuments.mockResolvedValueOnce([winner]);

      const result = await service.createDocument('proj-1', 'user-1', {
        documentType: 'storyboard',
      });

      expect(result.documentId).toBe('doc-winner');
    });

    it('re-throws non-duplicate-key errors from document creation', async () => {
      appData.createCollaborationDocument.mockRejectedValue(
        new Error('storage exploded'),
      );

      await expect(
        service.createDocument('proj-1', 'user-1', {
          documentType: 'storyboard',
        }),
      ).rejects.toThrow('storage exploded');
    });
  });

  describe('listDocuments', () => {
    it('rejects an invalid documentType filter', async () => {
      await expect(
        service.listDocuments('proj-1', 'user-1', 'bogus'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists documents for a valid type', async () => {
      appData.listCollaborationDocuments.mockResolvedValue([makeDocumentRow()]);
      const rows = await service.listDocuments(
        'proj-1',
        'user-1',
        'storyboard',
      );
      expect(rows).toHaveLength(1);
      expect(appData.listCollaborationDocuments).toHaveBeenCalledWith(
        'proj-1',
        {
          documentType: 'storyboard',
        },
      );
    });
  });

  describe('getDocument / updateDocument', () => {
    it('throws NotFoundException when the document does not exist', async () => {
      appData.getCollaborationDocumentById.mockResolvedValue(null);
      await expect(
        service.getDocument('proj-1', 'missing', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates a document title for editors', async () => {
      appData.getCollaborationDocumentById.mockResolvedValue(makeDocumentRow());
      appData.updateCollaborationDocument.mockResolvedValue(
        makeDocumentRow({ title: 'Renamed' }),
      );

      const result = await service.updateDocument('proj-1', 'doc-1', 'user-1', {
        title: 'Renamed',
      });
      expect(result.title).toBe('Renamed');
    });

    it('rejects commenters from updating documents', async () => {
      asMember('commenter');
      appData.getCollaborationDocumentById.mockResolvedValue(makeDocumentRow());
      await expect(
        service.updateDocument('proj-1', 'doc-1', 'user-2', { title: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getDocumentContent', () => {
    it('reads latest bytes straight from storage, independent of the collab server', async () => {
      appData.getCollaborationDocumentById.mockResolvedValue(
        makeDocumentRow({ version: 5 }),
      );
      supabase.downloadObject.mockResolvedValue(
        Buffer.from('yjs-update-bytes'),
      );

      const result = await service.getDocumentContent(
        'proj-1',
        'doc-1',
        'user-1',
      );

      expect(supabase.downloadObject).toHaveBeenCalledWith(
        'projects/proj-1/docs/storyboard/doc-1/latest.yjs',
        'collaboration-snapshots',
      );
      expect(result.hasContent).toBe(true);
      expect(result.version).toBe(5);
      expect(result.dataBase64).toBe(
        Buffer.from('yjs-update-bytes').toString('base64'),
      );
    });

    it('returns empty content instead of throwing when no live session has saved bytes yet', async () => {
      appData.getCollaborationDocumentById.mockResolvedValue(makeDocumentRow());
      supabase.downloadObject.mockRejectedValue(new Error('Object not found'));

      const result = await service.getDocumentContent(
        'proj-1',
        'doc-1',
        'user-1',
      );

      expect(result.hasContent).toBe(false);
      expect(result.byteLength).toBe(0);
      expect(result.dataBase64).toBe('');
    });

    it('re-throws storage errors unrelated to a missing object', async () => {
      appData.getCollaborationDocumentById.mockResolvedValue(makeDocumentRow());
      supabase.downloadObject.mockRejectedValue(
        new Error('bucket unreachable'),
      );

      await expect(
        service.getDocumentContent('proj-1', 'doc-1', 'user-1'),
      ).rejects.toThrow('bucket unreachable');
    });

    it('allows viewers to read content but rejects non-members', async () => {
      asMember('viewer');
      appData.getCollaborationDocumentById.mockResolvedValue(makeDocumentRow());
      supabase.downloadObject.mockResolvedValue(Buffer.from('bytes'));

      await expect(
        service.getDocumentContent('proj-1', 'doc-1', 'user-2'),
      ).resolves.toMatchObject({ hasContent: true });

      appData.resolveProjectAccessForUser.mockResolvedValue({
        ok: false,
        reason: 'not_found',
      });
      await expect(
        service.getDocumentContent('proj-1', 'doc-1', 'user-3'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('comments', () => {
    beforeEach(() => {
      appData.getCollaborationDocumentById.mockResolvedValue(makeDocumentRow());
    });

    it('creates a comment and notifies mentioned users', async () => {
      appData.createProjectComment.mockResolvedValue(makeCommentRow());

      const result = await service.createComment('proj-1', 'doc-1', 'user-1', {
        body: 'hi @bob',
        mentionedUserIds: ['user-2', 'user-1'],
      });

      expect(result.commentId).toBe('cmt-1');
      // Author is filtered out of the mention list even if self-mentioned.
      expect(notifications.notifyCommentMention).toHaveBeenCalledTimes(1);
      expect(notifications.notifyCommentMention).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: 'user-2',
          authorUserId: 'user-1',
        }),
      );
    });

    it('rejects viewers from creating comments', async () => {
      asMember('viewer');
      await expect(
        service.createComment('proj-1', 'doc-1', 'user-2', { body: 'hi' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('notifies the parent comment author on reply, but not on self-reply', async () => {
      asMember('commenter');
      appData.getProjectComment.mockResolvedValue(
        makeCommentRow({ authorUserId: 'user-1' }),
      );
      appData.createProjectComment.mockResolvedValue(
        makeCommentRow({
          commentId: 'cmt-2',
          parentCommentId: 'cmt-1',
          authorUserId: 'user-2',
        }),
      );

      await service.createReply('proj-1', 'doc-1', 'cmt-1', 'user-2', {
        body: 'reply',
      });
      expect(notifications.notifyCommentReply).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientUserId: 'user-1',
          authorUserId: 'user-2',
        }),
      );

      notifications.notifyCommentReply.mockClear();
      appData.createProjectComment.mockResolvedValue(
        makeCommentRow({
          commentId: 'cmt-3',
          parentCommentId: 'cmt-1',
          authorUserId: 'user-1',
        }),
      );
      await service.createReply('proj-1', 'doc-1', 'cmt-1', 'user-1', {
        body: 'self reply',
      });
      expect(notifications.notifyCommentReply).not.toHaveBeenCalled();
    });

    it('allows the comment author to edit their own comment', async () => {
      asMember('commenter');
      appData.getProjectComment.mockResolvedValue(
        makeCommentRow({ authorUserId: 'user-2' }),
      );
      appData.updateProjectComment.mockResolvedValue(
        makeCommentRow({ authorUserId: 'user-2', body: 'edited' }),
      );

      const result = await service.updateComment(
        'proj-1',
        'doc-1',
        'cmt-1',
        'user-2',
        {
          body: 'edited',
        },
      );
      expect(result.body).toBe('edited');
    });

    it("blocks a non-author commenter from editing someone else's comment", async () => {
      asMember('commenter');
      appData.getProjectComment.mockResolvedValue(
        makeCommentRow({ authorUserId: 'user-1' }),
      );

      await expect(
        service.updateComment('proj-1', 'doc-1', 'cmt-1', 'user-2', {
          body: 'edited',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an editor to modify comments they did not author', async () => {
      asMember('editor');
      appData.getProjectComment.mockResolvedValue(
        makeCommentRow({ authorUserId: 'user-1' }),
      );
      appData.resolveProjectComment.mockResolvedValue(
        makeCommentRow({ status: 'resolved', resolvedByUserId: 'user-2' }),
      );

      const result = await service.resolveComment(
        'proj-1',
        'doc-1',
        'cmt-1',
        'user-2',
        true,
      );
      expect(result.status).toBe('resolved');
    });

    it('deletes a comment when called by the author', async () => {
      appData.getProjectComment.mockResolvedValue(
        makeCommentRow({ authorUserId: 'user-1' }),
      );
      await service.deleteComment('proj-1', 'doc-1', 'cmt-1', 'user-1');
      expect(appData.deleteProjectComment).toHaveBeenCalledWith('cmt-1');
    });

    it('throws NotFoundException for a comment from a different document/project', async () => {
      appData.getProjectComment.mockResolvedValue(
        makeCommentRow({ projectId: 'other-project' }),
      );
      await expect(
        service.updateComment('proj-1', 'doc-1', 'cmt-1', 'user-1', {
          body: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('version history', () => {
    beforeEach(() => {
      appData.getCollaborationDocumentById.mockResolvedValue(
        makeDocumentRow({ version: 2 }),
      );
    });

    it('lists snapshot versions for a document', async () => {
      const snapshot: CollaborationSnapshotRow = {
        snapshotId: 'snap-1',
        documentKey: 'project:proj-1:doc:storyboard:doc-1',
        documentId: 'doc-1',
        storageRef:
          'supabase://bucket/projects/proj-1/docs/storyboard/doc-1/snapshots/snap-1.yjs',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      appData.listCollaborationSnapshots.mockResolvedValue([snapshot]);

      const result = await service.listVersions('proj-1', 'doc-1', 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0].snapshotId).toBe('snap-1');
    });

    it('rejects fetching a version that belongs to a different document', async () => {
      appData.getCollaborationSnapshotById.mockResolvedValue({
        snapshotId: 'snap-1',
        documentKey: 'project:proj-1:doc:storyboard:other-doc',
        documentId: 'other-doc',
        storageRef: 'supabase://bucket/x',
        createdAt: new Date(),
      });

      await expect(
        service.getVersion('proj-1', 'doc-1', 'snap-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('restores a prior snapshot by re-uploading its bytes as latest and bumping version', async () => {
      appData.getCollaborationSnapshotById.mockResolvedValue({
        snapshotId: 'snap-1',
        documentKey: 'project:proj-1:doc:storyboard:doc-1',
        documentId: 'doc-1',
        storageRef:
          'supabase://bucket/projects/proj-1/docs/storyboard/doc-1/snapshots/snap-1.yjs',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      supabase.downloadObject.mockResolvedValue(Buffer.from('yjs-bytes'));
      appData.updateCollaborationDocument.mockResolvedValue(
        makeDocumentRow({ version: 3, updatedByUserId: 'user-1' }),
      );

      const result = await service.restoreVersion(
        'proj-1',
        'doc-1',
        'snap-1',
        'user-1',
      );

      expect(supabase.downloadObject).toHaveBeenCalledWith(
        'projects/proj-1/docs/storyboard/doc-1/snapshots/snap-1.yjs',
        'collaboration-snapshots',
      );
      expect(supabase.uploadObject).toHaveBeenCalledWith(
        'projects/proj-1/docs/storyboard/doc-1/latest.yjs',
        expect.anything(),
        'application/octet-stream',
        'collaboration-snapshots',
      );
      expect(appData.updateCollaborationDocument).toHaveBeenCalledWith(
        'project:proj-1:doc:storyboard:doc-1',
        expect.objectContaining({ version: 3, updatedByUserId: 'user-1' }),
      );
      expect(result.requiresReconnect).toBe(true);
      expect(result.restoredFromSnapshotId).toBe('snap-1');
    });

    it('rejects viewers from restoring a version', async () => {
      asMember('viewer');
      await expect(
        service.restoreVersion('proj-1', 'doc-1', 'snap-1', 'user-2'),
      ).rejects.toThrow(ForbiddenException);
      expect(supabase.downloadObject).not.toHaveBeenCalled();
    });
  });

  describe('collaboration activity', () => {
    it('creates a durable activity linked to a document', async () => {
      appData.getCollaborationDocumentById.mockResolvedValue(makeDocumentRow());
      appData.createCollaborationActivity.mockResolvedValue(makeActivityRow());

      const result = await service.createActivity(
        'proj-1',
        'user-1',
        { activityType: 'model_generation', requestId: 'req-1' },
        'doc-1',
      );

      expect(result.activityId).toBe('act-1');
      expect(appData.createCollaborationActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          documentType: 'storyboard',
          requestId: 'req-1',
        }),
      );
    });

    it('merges active and unreconciled activity without duplicates', async () => {
      const shared = makeActivityRow({
        activityId: 'act-1',
        status: 'completed',
      });
      appData.listActiveCollaborationActivity.mockResolvedValue([shared]);
      appData.listUnreconciledCollaborationActivity.mockResolvedValue([shared]);

      const result = await service.listActivityForProject('proj-1', 'user-1');
      expect(result).toHaveLength(1);
    });

    it('rejects reconciling an activity that has not completed', async () => {
      appData.getCollaborationActivity.mockResolvedValue(
        makeActivityRow({ status: 'running' }),
      );
      await expect(
        service.reconcileActivity('proj-1', 'act-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('reconciles a completed activity', async () => {
      appData.getCollaborationActivity.mockResolvedValue(
        makeActivityRow({ status: 'completed' }),
      );
      appData.updateCollaborationActivity.mockResolvedValue(
        makeActivityRow({ status: 'completed', reconciledAt: new Date() }),
      );

      const result = await service.reconcileActivity(
        'proj-1',
        'act-1',
        'user-1',
      );
      expect(result.reconciled).toBe(true);
    });

    it('syncs a completed generation activity with its resulting asset', async () => {
      appData.getCollaborationActivity.mockResolvedValue(
        makeActivityRow({ requestId: 'req-1', status: 'running' }),
      );
      appData.getRequestStatus.mockResolvedValue({
        status: 'completed',
        outputRef: 'ref-1',
        resultJson: { note: 'ok' },
      });
      appData.getProjectAssetByRequestId.mockResolvedValue({
        assetId: 'asset-1',
        status: 'ready',
      });
      appData.updateCollaborationActivity.mockResolvedValue(
        makeActivityRow({
          status: 'completed',
          result: { assetId: 'asset-1' },
        }),
      );

      const result = await service.syncActivityFromRequest(
        'proj-1',
        'act-1',
        'user-1',
      );
      const [, syncPatch] = appData.updateCollaborationActivity.mock
        .calls[0] as [
        string,
        { status: string; result: Record<string, unknown> },
      ];
      expect(syncPatch.status).toBe('completed');
      expect(syncPatch.result).toMatchObject({
        assetId: 'asset-1',
        outputRef: 'ref-1',
      });
      expect(result.status).toBe('completed');
    });

    it('marks activity failed when the linked request failed', async () => {
      appData.getCollaborationActivity.mockResolvedValue(
        makeActivityRow({ requestId: 'req-1', status: 'running' }),
      );
      appData.getRequestStatus.mockResolvedValue({
        status: 'failed',
        errorMessage: 'boom',
      });
      appData.updateCollaborationActivity.mockResolvedValue(
        makeActivityRow({ status: 'failed', errorMessage: 'boom' }),
      );

      const result = await service.syncActivityFromRequest(
        'proj-1',
        'act-1',
        'user-1',
      );
      expect(appData.updateCollaborationActivity).toHaveBeenCalledWith(
        'act-1',
        {
          status: 'failed',
          errorMessage: 'boom',
        },
      );
      expect(result.status).toBe('failed');
    });
  });
});
