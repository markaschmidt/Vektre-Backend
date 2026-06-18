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
