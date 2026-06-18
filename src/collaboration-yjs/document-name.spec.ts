import {
  assertValidDocumentName,
  buildDocumentName,
  parseDocumentName,
} from './document-name.js';

describe('document-name', () => {
  it('builds and parses typed collaboration document names', () => {
    const name = buildDocumentName('proj-1', 'doc-1', 'canvas');
    expect(name).toBe('project:proj-1:doc:canvas:doc-1');
    expect(parseDocumentName(name)).toEqual({
      projectId: 'proj-1',
      documentId: 'doc-1',
      documentType: 'canvas',
      documentKey: 'project:proj-1:doc:canvas:doc-1',
    });
  });

  it('keeps legacy document names readable as storyboard documents', () => {
    expect(parseDocumentName('project:proj-1:doc:doc-1')).toEqual({
      projectId: 'proj-1',
      documentId: 'doc-1',
      documentType: 'storyboard',
      documentKey: 'project:proj-1:doc:storyboard:doc-1',
    });
  });

  it('rejects invalid document names', () => {
    expect(() => assertValidDocumentName('invalid')).toThrow(/Invalid collaboration document name/);
  });
});
