import type {
  OrganizationMemberRow,
  OrganizationProvider,
  OrganizationRole,
  OrganizationRow,
} from '../../integrations/app-data.types.js';

export const ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  'executive',
  'contributor',
  'inspector',
  'spectator',
];

export const ORGANIZATION_PROVIDERS: readonly OrganizationProvider[] = [
  'github',
  'figma',
  'perforce',
  'git_lfs',
];

/** Maximum width/height in pixels for an organization company logo. */
export const ORGANIZATION_LOGO_MAX_PX = 128;

/** Supabase Storage bucket Nest uses for org logos (service-role writes). */
export const ORGANIZATION_LOGOS_BUCKET = 'org-logos';

/** Max logo file size accepted by Nest upload (matches storage bucket limit). */
export const ORGANIZATION_LOGO_MAX_BYTES = 512 * 1024;

export const ORGANIZATION_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type OrganizationLogoMimeType =
  (typeof ORGANIZATION_LOGO_MIME_TYPES)[number];

export interface OrganizationLogoUploadResponse {
  logoUrl: string;
  logoWidth: number;
  logoHeight: number;
  objectPath: string;
  mimeType: OrganizationLogoMimeType;
  sizeBytes: number;
}

export interface OrganizationWithRole extends OrganizationRow {
  role: OrganizationRole;
}

export interface OrganizationDetails extends OrganizationWithRole {
  members: OrganizationMemberRow[];
}
