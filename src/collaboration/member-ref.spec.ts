import { resolveMemberUserId } from './member-ref.js';

describe('resolveMemberUserId', () => {
  const projectId = '7ebe1a40-0087-4727-882a-a26abc813d8a';
  const userId = 'e3ad296c-d94f-484b-8808-949cfd951d46';

  it('returns bare userId unchanged', () => {
    expect(resolveMemberUserId(projectId, userId)).toBe(userId);
  });

  it('extracts userId from composite membershipId', () => {
    expect(resolveMemberUserId(projectId, `${projectId}:${userId}`)).toBe(userId);
  });

  it('extracts userId from membershipId when projectId differs', () => {
    const otherProject = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(resolveMemberUserId(projectId, `${otherProject}:${userId}`)).toBe(userId);
  });
});
