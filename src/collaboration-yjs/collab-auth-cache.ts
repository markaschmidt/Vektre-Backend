import { LRUCache } from 'lru-cache';
import type { CollabAuthenticatedUser } from './collab-auth.js';
import type { ProjectAccess } from './collab-rbac.js';

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;

function resolveCacheTtlMs(): number {
  const raw = process.env.COLLAB_AUTH_CACHE_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}

const cacheTtlMs = resolveCacheTtlMs();

const tokenUserCache = new LRUCache<string, CollabAuthenticatedUser>({
  max: DEFAULT_MAX_ENTRIES,
  ttl: cacheTtlMs,
});

const projectAccessCache = new LRUCache<string, ProjectAccess>({
  max: DEFAULT_MAX_ENTRIES,
  ttl: cacheTtlMs,
});

export function getCachedCollabUser(
  token: string,
): CollabAuthenticatedUser | undefined {
  return tokenUserCache.get(token);
}

export function setCachedCollabUser(
  token: string,
  user: CollabAuthenticatedUser,
): void {
  tokenUserCache.set(token, user);
}

export function getCachedProjectAccess(
  userId: string,
  projectId: string,
): ProjectAccess | undefined {
  return projectAccessCache.get(`${userId}:${projectId}`);
}

export function setCachedProjectAccess(access: ProjectAccess): void {
  projectAccessCache.set(`${access.userId}:${access.projectId}`, access);
}

/** Exposed for tests that need deterministic cache behavior. */
export function clearCollabAuthCache(): void {
  tokenUserCache.clear();
  projectAccessCache.clear();
}

export function getCollabAuthCacheTtlMs(): number {
  return cacheTtlMs;
}
