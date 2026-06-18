import { verifyCollabToken } from './collab-auth.js';

const mockGetUser = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

describe('collab-auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  it('rejects missing tokens', async () => {
    await expect(verifyCollabToken('')).rejects.toThrow('Missing collaboration token');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid JWT' },
    });

    await expect(verifyCollabToken('bad-token')).rejects.toThrow('Invalid JWT');
  });

  it('returns the authenticated user for valid tokens', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'alice@example.com',
          user_metadata: { full_name: 'Alice' },
        },
      },
      error: null,
    });

    await expect(verifyCollabToken('good-token')).resolves.toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
    });
  });
});
