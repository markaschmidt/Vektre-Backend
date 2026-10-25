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

export type UserPlan = 'free' | 'professional' | 'studio' | 'enterprise';

export const USER_PLANS: readonly UserPlan[] = [
  'free',
  'professional',
  'studio',
  'enterprise',
] as const;

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
export type OrganizationRole =
  | 'executive'
  | 'contributor'
  | 'inspector'
  | 'spectator';
export type OrganizationMemberStatus = 'active' | 'removed';
export type OrganizationProvider = 'github' | 'figma' | 'perforce' | 'git_lfs';

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
  organizationId?: string | null;
  name: string;
  description?: string | null;
  workspaceMode: ProjectWorkspaceMode;
  status: ProjectStatus;
  iconAssetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationRow {
  organizationId: string;
  name: string;
  slug: string;
  createdBy: string;
  /** Public URL for the company logo. Null when unset. */
  logoUrl?: string | null;
  /** Pixel width of the logo; required with logoUrl; max 128. */
  logoWidth?: number | null;
  /** Pixel height of the logo; required with logoUrl; max 128. */
  logoHeight?: number | null;
  storageQuotaOverrideBytes?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMemberRow {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  status: OrganizationMemberStatus;
  addedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationProviderCredentialRow {
  organizationId: string;
  provider: OrganizationProvider;
  encryptedPayload: string;
  status: 'connected' | 'invalid' | 'disconnected';
  metadata: Record<string, unknown>;
  updatedBy: string;
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
  /** Cloud project scope. Null when the asset belongs to a local desktop project. */
  projectId: string | null;
  /** Owner-scoped local desktop project id (mutually exclusive with projectId). */
  localProjectId?: string | null;
  /** Explicit owner for local-scoped assets; mirrors uploader for cloud assets. */
  ownerUserId?: string | null;
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

export type RiggingJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RiggingJobRow {
  jobId: string;
  userId: string;
  projectId?: string | null;
  localProjectId?: string | null;
  sourceAssetId: string;
  outputAssetId: string;
  workerJobId?: string | null;
  idempotencyKey?: string | null;
  status: RiggingJobStatus;
  simplify: boolean;
  targetFaceCount: number;
  errorMessage?: string | null;
  resultJson?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Nest durable status for Mesh2Motion jobs (same lifecycle as RiggingJobStatus). */
export type Mesh2MotionJobStatus = RiggingJobStatus;

export interface Mesh2MotionJobRow {
  jobId: string;
  userId: string;
  projectId?: string | null;
  localProjectId?: string | null;
  sourceAssetId: string;
  outputAssetId: string;
  workerJobId?: string | null;
  idempotencyKey?: string | null;
  status: Mesh2MotionJobStatus;
  skeletonType: string;
  animationNames?: string[] | null;
  errorMessage?: string | null;
  resultJson?: Record<string, unknown> | null;
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

export type CollaborationDocumentType =
  | 'storyboard'
  | 'foundry'
  | 'canvas'
  | 'gui_screen';

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
  name?: string | null;
  previewStorageRef?: string | null;
  previewContentType?: string | null;
  previewByteLength?: number | null;
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
  /** Canvas workflow action scoping (nullable for non-canvas activities). */
  workflowId?: string;
  nodeId?: string;
  runId?: string;
  actionKind?: string;
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

/** Durable estimated-cost row for generative requests (project settings analytics). */
export interface GenerationUsageEventRow {
  eventId: string;
  requestId: string;
  projectId: string;
  actorUserId: string;
  provider: string;
  modelId?: string;
  surface: string;
  actionKind?: string;
  requestType: string;
  usage: Record<string, unknown>;
  estimatedCostUsd: number;
  currency: string;
  billable: boolean;
  createdAt: Date;
  documentId?: string;
  threadId?: string;
  runId?: string;
  stage?: string;
  providerRequestId?: string;
  requestedModel?: string;
  actualModel?: string;
  modelPresetId?: string;
  promptVersion?: string;
  schemaVersion?: string;
  contextManifestVersion?: string;
  providerCostUsd?: number;
  priceTableVersion?: string;
  latencyMs?: number;
  retryCount?: number;
  repairAttempts?: number;
  outcome?: string;
  errorCategory?: string;
  imageCount?: number;
}
