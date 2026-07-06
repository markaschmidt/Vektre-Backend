/**
 * Domain types for Vektre app data persisted in Supabase Postgres.
 */

export type RequestStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RequestStatusRow {
  requestId: string;
  userId: string;
  type: string;
  status: RequestStatus;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  outputRef?: string;
  /** Type-specific structured result (e.g. Replicate 3D URLs). */
  resultJson?: Record<string, unknown>;
}

export type UserType = 'personal' | 'indie' | 'enterprise';

export type UserUseCase = 'game_development' | 'animation' | 'cinema_film';

export type UserPlan =
  | 'indie_free'
  | 'indie_pro'
  | 'corp_starter'
  | 'corp_team'
  | 'corp_enterprise';

/** Stored in user_profile.preferences_json. */
export interface UserOnboardingPreferences {
  onboardingCompleted?: boolean;
  firstName?: string;
  lastName?: string;
  role?: string;
  /** Legacy field — not collected during onboarding anymore. */
  jobTitle?: string;
  userType?: UserType;
  useCase?: UserUseCase;
  company?: string;
  selectedPlan?: UserPlan;
  [key: string]: unknown;
}

export interface UserOnDemand {
  monthlyCap: number | null;
}

export interface UserProfileRow {
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  plan?: UserPlan | null;
  preferences: UserOnboardingPreferences;
  organizationId?: string | null;
  storageId?: string | null;
  onDemand: UserOnDemand;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectWorkspaceMode = 'solo' | 'collaborative';
export type ProjectStatus = 'active' | 'archived' | 'deleted';
export type ProjectMemberRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type ProjectMemberStatus = 'active' | 'removed';

/** Why a user cannot access a project (for client-facing errors). */
export type ProjectAccessDenialReason = 'not_found' | 'removed' | 'deleted';

export type ProjectAccessResult =
  | { ok: true; project: ProjectRow }
  | { ok: false; reason: ProjectAccessDenialReason };
export type ProjectAssetStatus =
  | 'generating'
  | 'ready'
  | 'failed'
  | 'active'
  | 'deleted';
export type ShareLinkRole = 'viewer' | 'commenter' | 'editor';

export interface ProjectRow {
  projectId: string;
  ownerUserId: string;
  name: string;
  description?: string | null;
  workspaceMode: ProjectWorkspaceMode;
  status: ProjectStatus;
  iconAssetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMemberRow {
  membershipId: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  status: ProjectMemberStatus;
  addedByUserId: string;
  displayName?: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectAssetRow {
  assetId: string;
  projectId: string;
  uploadedByUserId: string;
  assetType: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageRef: string;
  bucket?: string;
  objectPath?: string;
  publicUrl?: string;
  checksum?: string;
  status: ProjectAssetStatus;
  sourceProvider?: string;
  requestId?: string;
  promptHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShareLinkRow {
  linkId: string;
  projectId: string;
  tokenHash: string;
  roleToGrant: ShareLinkRole;
  createdByUserId: string;
  expiresAt: Date;
  maxUses?: number;
  useCount: number;
  revokedAt?: Date;
  consumedAt?: Date;
  createdAt: Date;
}

export type InviteType = 'email' | 'code';
export type InviteStatus = 'pending' | 'accepted' | 'revoked';

export interface ProjectInviteRow {
  inviteId: string;
  projectId: string;
  invitedByUserId: string;
  inviteType: InviteType;
  roleToGrant: ProjectMemberRole;
  /** Set for type='email' invites */
  inviteeEmail?: string;
  /** Resolved at accept time when the invitee has a Vektre account */
  inviteeUserId?: string;
  /** SHA-256 hash of the plaintext code (type='code' only) */
  inviteCodeHash?: string;
  status: InviteStatus;
  /** NULL = no expiry (typical for email invites) */
  expiresAt?: Date;
  acceptedAt?: Date;
  revokedAt?: Date;
  acceptedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Collaboration documents (Yjs registry) ─────────────────────────────────

export type CollaborationDocumentType = 'storyboard' | 'canvas' | 'gui_screen';

export interface CollaborationDocumentRow {
  documentKey: string;
  documentId: string;
  projectId: string;
  documentType: CollaborationDocumentType;
  title: string;
  storageRef?: string | null;
  version: number;
  createdByUserId?: string;
  updatedByUserId?: string;
  archivedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollaborationSnapshotRow {
  snapshotId: string;
  documentKey: string;
  documentId: string;
  stateVector?: string;
  storageRef: string;
  byteLength?: number;
  createdByUserId?: string;
  createdAt: Date;
}

// ─── Project comments ────────────────────────────────────────────────────────

export type ProjectCommentStatus = 'open' | 'resolved' | 'deleted';

export interface ProjectCommentRow {
  commentId: string;
  projectId: string;
  documentId?: string;
  assetId?: string;
  authorUserId: string;
  parentCommentId?: string;
  body: string;
  status: ProjectCommentStatus;
  anchor?: Record<string, unknown>;
  resolvedByUserId?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Collaboration activity (durable cross-surface jobs) ───────────────────

export type CollaborationActivityType =
  | 'model_generation'
  | 'image_generation'
  | 'asset_import'
  | 'project_sync'
  | 'ai_task'
  | 'comment_created'
  | 'comment_replied'
  | 'comment_resolved';

export type CollaborationActivityStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CollaborationActivityRow {
  activityId: string;
  projectId: string;
  documentId?: string;
  documentType?: CollaborationDocumentType;
  requestId?: string;
  actorUserId: string;
  activityType: CollaborationActivityType;
  status: CollaborationActivityStatus;
  target?: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorMessage?: string;
  reconciledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderCredentialRow {
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  updatedAt: Date;
}
