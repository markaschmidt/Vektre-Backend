import type { ProjectMemberRole, ShareLinkRole } from '../../integrations/app-data.types.js';

export { ProjectMemberRole, ShareLinkRole };

export interface ShareLinkResponse {
  linkId: string;
  projectId: string;
  roleToGrant: ShareLinkRole;
  createdByUserId: string;
  expiresAt: string;
  maxUses?: number;
  useCount: number;
  isExpired: boolean;
  isRevoked: boolean;
  createdAt: string;
}

export interface MemberResponse {
  membershipId: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
  color?: string;
  addedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptShareLinkResponse {
  member: MemberResponse;
  projectId: string;
  role: ShareLinkRole;
}

export const ROLE_HIERARCHY: Record<ProjectMemberRole, number> = {
  owner: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
};

export function hasPermission(
  actual: ProjectMemberRole,
  required: ProjectMemberRole,
): boolean {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}
