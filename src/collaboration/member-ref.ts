/**
 * Path params may be either a bare userId or a composite membershipId
 * (`${projectId}:${userId}`) as returned in MemberResponse.membershipId.
 */
export function resolveMemberUserId(projectId: string, memberRef: string): string {
  const trimmed = memberRef.trim();
  const prefix = `${projectId}:`;
  if (trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length);
  }
  if (trimmed.includes(':')) {
    return trimmed.slice(trimmed.lastIndexOf(':') + 1);
  }
  return trimmed;
}
