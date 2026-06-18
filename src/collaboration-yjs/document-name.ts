export type CollaborationDocumentType = 'storyboard' | 'canvas' | 'gui_screen';

export interface ParsedDocumentName {
  projectId: string;
  documentId: string;
  documentType: CollaborationDocumentType;
  documentKey: string;
}

const DOCUMENT_NAME_RE = /^project:([^:]+):doc:([^:]+)$/;
const TYPED_DOCUMENT_NAME_RE = /^project:([^:]+):doc:(storyboard|canvas|gui_screen):([^:]+)$/;

export function buildDocumentName(
  projectId: string,
  documentId: string,
  documentType: CollaborationDocumentType = 'storyboard',
): string {
  return `project:${projectId}:doc:${documentType}:${documentId}`;
}

export function parseDocumentName(name: string): ParsedDocumentName | null {
  const typedMatch = TYPED_DOCUMENT_NAME_RE.exec(name);
  if (typedMatch) {
    const [, projectId, documentType, documentId] = typedMatch;
    return {
      projectId,
      documentId,
      documentType: documentType as CollaborationDocumentType,
      documentKey: buildDocumentName(projectId, documentId, documentType as CollaborationDocumentType),
    };
  }

  const match = DOCUMENT_NAME_RE.exec(name);
  if (!match) return null;
  const [, projectId, documentId] = match;
  return {
    projectId,
    documentId,
    documentType: 'storyboard',
    documentKey: buildDocumentName(projectId, documentId, 'storyboard'),
  };
}

export function assertValidDocumentName(name: string): ParsedDocumentName {
  const parsed = parseDocumentName(name);
  if (!parsed) {
    throw new Error(
      `Invalid collaboration document name "${name}". Expected project:{projectId}:doc:{documentType}:{documentId}`,
    );
  }
  return parsed;
}
