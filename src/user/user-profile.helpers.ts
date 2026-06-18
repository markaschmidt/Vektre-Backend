import type {
  UserOnboardingPreferences,
  UserPlan,
  UserProfileRow,
} from '../integrations/app-data.types.js';

const DEFAULT_ON_DEMAND = { monthlyCap: null } as const;

export function buildDisplayName(
  explicit: string | undefined,
  firstName: string | undefined,
  lastName: string | undefined,
  fallback?: string | null,
): string | undefined {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  const fromNames = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fromNames) return fromNames;
  return fallback?.trim() || undefined;
}

export function resolvePlan(
  plan: UserPlan | undefined,
  preferences: UserOnboardingPreferences | undefined,
  existingPlan?: UserPlan | null,
): UserPlan | null | undefined {
  if (plan !== undefined) return plan;
  if (preferences?.selectedPlan !== undefined) return preferences.selectedPlan;
  return existingPlan;
}

export function mergeProfilePatch(
  userId: string,
  existing: UserProfileRow | null,
  patch: {
    displayName?: string;
    avatarUrl?: string;
    plan?: UserPlan;
    preferences?: UserOnboardingPreferences;
  },
): UserProfileRow {
  const mergedPreferences: UserOnboardingPreferences = patch.preferences
    ? { ...(existing?.preferences ?? {}), ...patch.preferences }
    : (existing?.preferences ?? {});

  const now = new Date();

  return {
    userId,
    displayName: patch.displayName ?? existing?.displayName ?? null,
    avatarUrl: patch.avatarUrl ?? existing?.avatarUrl ?? null,
    plan: resolvePlan(patch.plan, patch.preferences, existing?.plan) ?? null,
    preferences: mergedPreferences,
    organizationId: existing?.organizationId ?? null,
    storageId: existing?.storageId ?? null,
    onDemand: existing?.onDemand ?? DEFAULT_ON_DEMAND,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
