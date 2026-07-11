import type { ProjectMemberRole } from '../../integrations/app-data.types.js';
import type { CollaborationDocumentType } from '../../collaboration-yjs/document-name.js';

/**
 * Areas a user can be looking at within an open cloud project. Only
 * `storyboard` / `foundry` / `canvas` / `gui_screen` have a backing Yjs
 * document room — the rest are project-session-only presence pointers.
 */
export type ProjectActiveSurface =
  | 'dashboard'
  | 'storyboard'
  | 'foundry'
  | 'canvas'
  | 'gui_screen'
  | 'repository'
  | 'settings';

export const PROJECT_ACTIVE_SURFACES: readonly ProjectActiveSurface[] = [
  'dashboard',
  'storyboard',
  'foundry',
  'canvas',
  'gui_screen',
  'repository',
  'settings',
];

/**
 * Documented, not runtime-enforced (awareness travels over Yjs, not REST).
 * The API hands this shape to the frontend so every client implements the
 * same project-level presence contract in `project:{projectId}:session`.
 */
export interface ProjectSessionAwarenessContract {
  description: string;
  fields: {
    userId: string;
    displayName: string;
    avatarUrl: string;
    role: string;
    color: string;
    activeSurface: string;
    activeDocumentId: string;
    activity: string;
  };
}

export const PROJECT_SESSION_AWARENESS_CONTRACT: ProjectSessionAwarenessContract = {
  description:
    'Ephemeral global presence broadcast by every connected client in project:{projectId}:session. ' +
    'Keep this small — no document content, no blobs.',
  fields: {
    userId: 'string — Supabase user id (also available server-side via onAuthenticate)',
    displayName: 'string',
    avatarUrl: 'string | undefined',
    role: 'ProjectMemberRole — owner | editor | commenter | viewer',
    color: 'string — stable per-member cursor/highlight color',
    activeSurface:
      'ProjectActiveSurface — dashboard | storyboard | foundry | canvas | gui_screen | repository | settings',
    activeDocumentId: 'string | undefined — set when activeSurface has an open document',
    activity: '{ activityId, requestId, activityType, status } | undefined — cross-surface activity in progress',
  },
};

export interface SurfaceAwarenessContract {
  description: string;
  fields: Record<string, string>;
}

/**
 * Per-surface Yjs awareness contract, joined at
 * `project:{projectId}:doc:{documentType}:{documentId}`.
 */
export function buildSurfaceAwarenessContract(
  documentType: CollaborationDocumentType,
): SurfaceAwarenessContract {
  const common: Record<string, string> = {
    userId: 'string',
    displayName: 'string',
    color: 'string',
    cursor: 'surface-specific cursor/selection anchor (see commentAnchorSchema for shape hints)',
    localActivityId: 'string | undefined — collaboration_activity id currently generating in this room',
  };

  switch (documentType) {
    case 'storyboard':
      return {
        description: 'Storyboard editor awareness: text cursor, selection, and active block.',
        fields: { ...common, selectionRange: '{ blockId, from, to } | undefined', activeBlockId: 'string | undefined' },
      };
    case 'foundry':
      return {
        description: 'Foundry viewer awareness: shared selected model/item in the 3D scene.',
        fields: {
          ...common,
          selectedItemId: 'string | undefined — collaboratively shared foundry item selection',
        },
      };
    case 'canvas':
      return {
        description: 'Canvas workflow awareness: selected blocks, viewport pan/zoom, active generation block.',
        fields: {
          ...common,
          selectedBlockIds: 'string[]',
          activeBlockId: 'string | undefined',
          viewport: '{ x, y, zoom } | undefined',
        },
      };
    case 'gui_screen':
      return {
        description: 'GUI maker awareness: selected components and inspector focus.',
        fields: {
          ...common,
          selectedComponentIds: 'string[]',
          inspectorFocus: '{ componentId, propPath } | undefined',
        },
      };
    default:
      return { description: 'Generic surface awareness.', fields: common };
  }
}

export interface RoleAwarePresenceUser {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  role: ProjectMemberRole;
  color?: string;
}
