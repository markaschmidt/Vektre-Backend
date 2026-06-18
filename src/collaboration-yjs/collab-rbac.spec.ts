import { hasPermission } from '../collaboration/models/collaboration.model.js';
import { resolveProjectAccess } from './collab-rbac.js';

const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: mockFrom })),
}));

describe('collaboration RBAC helpers', () => {
  it('allows owners and editors to write', () => {
    expect(hasPermission('owner', 'editor')).toBe(true);
    expect(hasPermission('editor', 'editor')).toBe(true);
  });

  it('blocks viewers and commenters from editor actions', () => {
    expect(hasPermission('viewer', 'editor')).toBe(false);
    expect(hasPermission('commenter', 'editor')).toBe(false);
  });
});

describe('resolveProjectAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  it('grants write access to project owners', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { project_id: 'proj-1', owner_user_id: 'user-1', status: 'active' },
      error: null,
    });

    const access = await resolveProjectAccess('user-1', 'proj-1');
    expect(access.role).toBe('owner');
    expect(access.canWrite).toBe(true);
  });

  it('grants read-only access to viewers', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { project_id: 'proj-1', owner_user_id: 'owner-1', status: 'active' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { role: 'viewer', status: 'active' },
        error: null,
      });

    const access = await resolveProjectAccess('user-2', 'proj-1');
    expect(access.role).toBe('viewer');
    expect(access.canWrite).toBe(false);
  });

  it('rejects users without active membership', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: { project_id: 'proj-1', owner_user_id: 'owner-1', status: 'active' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      });

    await expect(resolveProjectAccess('user-2', 'proj-1')).rejects.toThrow(
      'Insufficient project permissions',
    );
  });
});
