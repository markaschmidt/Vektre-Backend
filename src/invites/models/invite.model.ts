import type { ProjectMemberRole } from '../../integrations/app-data.types.js';
import type { InviteType, InviteStatus } from '../../integrations/app-data.types.js';

export { InviteType, InviteStatus, ProjectMemberRole };

export interface InviteResponse {
  inviteId: string;
  projectId: string;
  invitedByUserId: string;
  inviteType: InviteType;
  roleToGrant: ProjectMemberRole;
  /** Present for email invites */
  inviteeEmail?: string;
  /** Present when the invitee has a Vektre account */
  inviteeUserId?: string;
  status: InviteStatus;
  isExpired: boolean;
  expiresAt?: string;
  acceptedAt?: string;
  revokedAt?: string;
  acceptedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmailInviteResponse extends InviteResponse {
  inviteType: 'email';
}

export interface CreateCodeInviteResponse extends InviteResponse {
  inviteType: 'code';
  /**
   * Plaintext join code — returned once on creation and never stored.
   * Share this with collaborators so they can call POST /invites/join.
   */
  code: string;
}

export interface JoinByCodeResponse {
  projectId: string;
  role: ProjectMemberRole;
  membershipId: string;
}

export interface AcceptEmailInviteResponse {
  projectId: string;
  role: ProjectMemberRole;
  membershipId: string;
}

export interface InvitePreview {
  inviteId: string;
  projectId: string;
  projectName: string;
  inviteType: InviteType;
  roleToGrant: ProjectMemberRole;
  isExpired: boolean;
  expiresAt?: string;
}
