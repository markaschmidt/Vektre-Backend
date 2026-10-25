import { CollaborationDocumentsController } from './collaboration-documents.controller.js';
import type { CollaborationDocumentsService } from './collaboration-documents.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.model.js';

describe('CollaborationDocumentsController', () => {
  let controller: CollaborationDocumentsController;
  const service = {
    getCollaborationConfig: jest.fn(),
    getProjectSession: jest.fn(),
    createDocument: jest.fn(),
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    getDocumentContent: jest.fn(),
    updateDocument: jest.fn(),
    listComments: jest.fn(),
    createComment: jest.fn(),
    createReply: jest.fn(),
    updateComment: jest.fn(),
    resolveComment: jest.fn(),
    deleteComment: jest.fn(),
    listVersions: jest.fn(),
    getVersion: jest.fn(),
    createVersion: jest.fn(),
    createVersionPreviewUpload: jest.fn(),
    completeVersionPreview: jest.fn(),
    restoreVersion: jest.fn(),
    createActivity: jest.fn(),
    listActivityForDocument: jest.fn(),
    listActivityForProject: jest.fn(),
    updateActivity: jest.fn(),
    syncActivityFromRequest: jest.fn(),
    reconcileActivity: jest.fn(),
  };
  const user = { id: 'user-1' } as AuthenticatedUser;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CollaborationDocumentsController(
      service as unknown as CollaborationDocumentsService,
    );
  });

  it('delegates collaboration config lookups to the service', () => {
    void controller.getCollaborationConfig('proj-1', user);
    expect(service.getCollaborationConfig).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
    );
  });

  it('delegates project session lookups to the service', () => {
    void controller.getProjectSession('proj-1', user);
    expect(service.getProjectSession).toHaveBeenCalledWith('proj-1', 'user-1');
  });

  it('delegates document creation with the DTO and caller id', () => {
    const dto = { documentType: 'canvas' as const };
    void controller.createDocument('proj-1', dto, user);
    expect(service.createDocument).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      dto,
    );
  });

  it('delegates document listing with an optional type filter', () => {
    void controller.listDocuments('proj-1', 'storyboard', user);
    expect(service.listDocuments).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      'storyboard',
    );
  });

  it('delegates document content retrieval independent of collaboration state', () => {
    void controller.getDocumentContent('proj-1', 'doc-1', user);
    expect(service.getDocumentContent).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'user-1',
    );
  });

  it('delegates comment creation', () => {
    const dto = { body: 'hello' };
    void controller.createComment('proj-1', 'doc-1', dto, user);
    expect(service.createComment).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'user-1',
      dto,
    );
  });

  it('delegates reply creation', () => {
    const dto = { body: 'reply' };
    void controller.createReply('proj-1', 'doc-1', 'cmt-1', dto, user);
    expect(service.createReply).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'cmt-1',
      'user-1',
      dto,
    );
  });

  it('defaults resolveComment to true when no query param is provided', () => {
    void controller.resolveComment('proj-1', 'doc-1', 'cmt-1', undefined, user);
    expect(service.resolveComment).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'cmt-1',
      'user-1',
      true,
    );
  });

  it('honors resolved=false to reopen a comment', () => {
    void controller.resolveComment('proj-1', 'doc-1', 'cmt-1', 'false', user);
    expect(service.resolveComment).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'cmt-1',
      'user-1',
      false,
    );
  });

  it('parses the limit query param for version listing', () => {
    void controller.listVersions('proj-1', 'doc-1', '10', user);
    expect(service.listVersions).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'user-1',
      10,
    );
  });

  it('leaves limit undefined when not provided', () => {
    void controller.listVersions('proj-1', 'doc-1', undefined, user);
    expect(service.listVersions).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'user-1',
      undefined,
    );
  });

  it('delegates named version creation', () => {
    const dto = { name: 'Pre-layout pass' };
    void controller.createVersion('proj-1', 'doc-1', dto, user);
    expect(service.createVersion).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'user-1',
      dto,
    );
  });

  it('delegates version restore', () => {
    void controller.restoreVersion('proj-1', 'doc-1', 'snap-1', user);
    expect(service.restoreVersion).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'snap-1',
      'user-1',
    );
  });

  it('creates document-scoped activity with the documentId attached', () => {
    const dto = { activityType: 'model_generation' as const };
    void controller.createDocumentActivity('proj-1', 'doc-1', dto, user);
    expect(service.createActivity).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      dto,
      'doc-1',
    );
  });

  it('creates project-scoped activity without a documentId', () => {
    const dto = { activityType: 'project_sync' as const };
    void controller.createProjectActivity('proj-1', dto, user);
    expect(service.createActivity).toHaveBeenCalledWith(
      'proj-1',
      'user-1',
      dto,
    );
  });

  it('delegates activity sync and reconcile calls', () => {
    void controller.syncActivity('proj-1', 'act-1', user);
    expect(service.syncActivityFromRequest).toHaveBeenCalledWith(
      'proj-1',
      'act-1',
      'user-1',
    );

    void controller.reconcileActivity('proj-1', 'act-1', user);
    expect(service.reconcileActivity).toHaveBeenCalledWith(
      'proj-1',
      'act-1',
      'user-1',
    );
  });

  it('delegates comment deletion', async () => {
    await controller.deleteComment('proj-1', 'doc-1', 'cmt-1', user);
    expect(service.deleteComment).toHaveBeenCalledWith(
      'proj-1',
      'doc-1',
      'cmt-1',
      'user-1',
    );
  });
});
