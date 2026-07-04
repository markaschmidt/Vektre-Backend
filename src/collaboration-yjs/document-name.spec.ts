import {
  assertValidCollabRoomName,
  assertValidDocumentName,
  buildDocumentName,
  buildSessionRoomName,
  parseCollabRoomName,
  parseDocumentName,
} from './document-name.js';

describe('document-name', () => {
  it('builds and parses typed collaboration document names', () => {
    const name = buildDocumentName('proj-1', 'doc-1', 'canvas');
    expect(name).toBe('project:proj-1:doc:canvas:doc-1');
    expect(parseDocumentName(name)).toEqual({
      kind: 'document',
      projectId: 'proj-1',
      documentId: 'doc-1',
      documentType: 'canvas',
      documentKey: 'project:proj-1:doc:canvas:doc-1',
    });
  });

  it('builds and parses project session room names', () => {
    const name = buildSessionRoomName('proj-1');
    expect(name).toBe('project:proj-1:session');
    expect(parseCollabRoomName(name)).toEqual({
      kind: 'session',
      projectId: 'proj-1',
      roomKey: 'project:proj-1:session',
    });
    expect(assertValidCollabRoomName(name).kind).toBe('session');
  });

  it('keeps legacy document names readable as storyboard documents', () => {
    expect(parseDocumentName('project:proj-1:doc:doc-1')).toEqual({
      kind: 'document',
      projectId: 'proj-1',
      documentId: 'doc-1',
      documentType: 'storyboard',
      documentKey: 'project:proj-1:doc:storyboard:doc-1',
    });
  });

  it('rejects invalid document names', () => {
    expect(() => assertValidDocumentName('invalid')).toThrow(
      /Invalid collaboration document name/,
    );
  });

  it('rejects invalid room names in assertValidCollabRoomName', () => {
    expect(() => assertValidCollabRoomName('invalid')).toThrow(
      /Invalid collaboration room name/,
    );
  });
});
