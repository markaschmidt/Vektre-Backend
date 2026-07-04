import {
  clearCollabAuthCache,
  getCachedCollabUser,
  getCachedProjectAccess,
  setCachedCollabUser,
  setCachedProjectAccess,
} from './collab-auth-cache.js';

describe('collab-auth-cache', () => {
  beforeEach(() => {
    clearCollabAuthCache();
  });

  it('stores and retrieves cached users by token', () => {
    setCachedCollabUser('token-a', { id: 'user-1', email: 'a@b.com' });
    expect(getCachedCollabUser('token-a')).toEqual({
      id: 'user-1',
      email: 'a@b.com',
    });
    expect(getCachedCollabUser('token-b')).toBeUndefined();
  });

  it('stores and retrieves cached project access by user and project', () => {
    setCachedProjectAccess({
      userId: 'user-1',
      projectId: 'proj-1',
      role: 'editor',
      canWrite: true,
    });
    expect(getCachedProjectAccess('user-1', 'proj-1')).toEqual({
      userId: 'user-1',
      projectId: 'proj-1',
      role: 'editor',
      canWrite: true,
    });
    expect(getCachedProjectAccess('user-2', 'proj-1')).toBeUndefined();
  });
});
