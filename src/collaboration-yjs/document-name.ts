export type CollaborationDocumentType = 'storyboard' | 'canvas' | 'gui_screen';

export type CollabRoomKind = 'session' | 'document';

/** Parsed project-level presence room: `project:{projectId}:session` */
export interface ParsedSessionRoom {
  kind: 'session';
  projectId: string;
  roomKey: string;
}

/** Parsed collaborative document room with durable Yjs content. */
export interface ParsedDocumentRoom {
  kind: 'document';
  projectId: string;
  documentId: string;
  documentType: CollaborationDocumentType;
  documentKey: string;
}

export type ParsedCollabRoom = ParsedSessionRoom | ParsedDocumentRoom;

/** @deprecated Use ParsedDocumentRoom — kept for persistence-layer call sites. */
export type ParsedDocumentName = ParsedDocumentRoom;

const SESSION_ROOM_RE = /^project:([^:]+):session$/;
const DOCUMENT_NAME_RE = /^project:([^:]+):doc:([^:]+)$/;
const TYPED_DOCUMENT_NAME_RE =
  /^project:([^:]+):doc:(storyboard|canvas|gui_screen):([^:]+)$/;

export function buildSessionRoomName(projectId: string): string {
  return `project:${projectId}:session`;
}

export function buildDocumentName(
  projectId: string,
  documentId: string,
  documentType: CollaborationDocumentType = 'storyboard',
): string {
  return `project:${projectId}:doc:${documentType}:${documentId}`;
}

export function parseCollabRoomName(name: string): ParsedCollabRoom | null {
  const sessionMatch = SESSION_ROOM_RE.exec(name);
  if (sessionMatch) {
    const [, projectId] = sessionMatch;
    return {
      kind: 'session',
      projectId,
      roomKey: buildSessionRoomName(projectId),
    };
  }

  const typedMatch = TYPED_DOCUMENT_NAME_RE.exec(name);
  if (typedMatch) {
    const [, projectId, documentType, documentId] = typedMatch;
    return {
      kind: 'document',
      projectId,
      documentId,
      documentType: documentType as CollaborationDocumentType,
      documentKey: buildDocumentName(
        projectId,
        documentId,
        documentType as CollaborationDocumentType,
      ),
    };
  }

  const match = DOCUMENT_NAME_RE.exec(name);
  if (!match) return null;
  const [, projectId, documentId] = match;
  return {
    kind: 'document',
    projectId,
    documentId,
    documentType: 'storyboard',
    documentKey: buildDocumentName(projectId, documentId, 'storyboard'),
  };
}

export function assertValidCollabRoomName(name: string): ParsedCollabRoom {
  const parsed = parseCollabRoomName(name);
  if (!parsed) {
    throw new Error(
      `Invalid collaboration room name "${name}". Expected project:{projectId}:session or project:{projectId}:doc:{documentType}:{documentId}`,
    );
  }
  return parsed;
}

export function parseDocumentName(name: string): ParsedDocumentRoom | null {
  const parsed = parseCollabRoomName(name);
  return parsed?.kind === 'document' ? parsed : null;
}

export function assertValidDocumentName(name: string): ParsedDocumentRoom {
  const parsed = parseCollabRoomName(name);
  if (!parsed || parsed.kind !== 'document') {
    throw new Error(
      `Invalid collaboration document name "${name}". Expected project:{projectId}:doc:{documentType}:{documentId}`,
    );
  }
  return parsed;
}

export function isSessionRoom(
  room: ParsedCollabRoom,
): room is ParsedSessionRoom {
  return room.kind === 'session';
}

export function isDocumentRoom(
  room: ParsedCollabRoom,
): room is ParsedDocumentRoom {
  return room.kind === 'document';
}
