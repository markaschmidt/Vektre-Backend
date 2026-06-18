import type {
  UserOnboardingPreferences,
  UserPlan,
  UserUseCase,
  UserType,
} from '../../integrations/app-data.types.js';

export interface UserOnDemand {
  monthlyCap: number | null;
}

/** API response shape (snake_case) returned by GET/PATCH /users/me/profile */
export interface UserProfileApiResponse {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
  plan: UserPlan | null;
  preferences: UserProfilePreferencesApi;
  organization_id: string | null;
  storage_id: string | null;
  on_demand: UserOnDemand;
  created_at: string;
  updated_at: string;
}

export interface UserProfilePreferencesApi {
  firstName?: string;
  lastName?: string;
  role?: string;
  jobTitle?: string;
  userType?: UserType;
  useCase?: UserUseCase;
  company?: string;
  selectedPlan?: UserPlan;
  [key: string]: unknown;
}

export function toUserProfileApiResponse(
  row: {
    userId: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    plan?: UserPlan | null;
    preferences: UserOnboardingPreferences;
    organizationId?: string | null;
    storageId?: string | null;
    onDemand?: UserOnDemand;
    createdAt: Date;
    updatedAt: Date;
  },
): UserProfileApiResponse {
  const { onboardingCompleted: _ignored, ...publicPreferences } = row.preferences;

  return {
    id: row.userId,
    display_name: row.displayName ?? null,
    avatar_url: row.avatarUrl ?? null,
    onboarding_completed: row.preferences.onboardingCompleted === true,
    plan: row.plan ?? row.preferences.selectedPlan ?? null,
    preferences: publicPreferences,
    organization_id: row.organizationId ?? null,
    storage_id: row.storageId ?? null,
    on_demand: row.onDemand ?? { monthlyCap: null },
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
