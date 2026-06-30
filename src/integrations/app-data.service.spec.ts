import { AppDataService } from './app-data.service.js';
import type { SupabaseService } from './supabase.js';

type QueryResult = { data: unknown; error: { message: string } | null };

function createChain(result: QueryResult) {
  const chain: Record<string, jest.Mock> = {};
  const terminal = jest.fn().mockResolvedValue(result);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.upsert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.neq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockReturnValue(chain);
  chain.is = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = terminal;
  chain.single = terminal;
  return chain;
}

describe('AppDataService', () => {
  let service: AppDataService;
  let fromMock: jest.Mock;

  beforeEach(() => {
    fromMock = jest.fn();
    const supabase = {
      getAdminClient: () => ({ from: fromMock }),
      getStorageBucket: () => 'project-assets',
    } as unknown as SupabaseService;
    service = new AppDataService(supabase);
  });

  it('upserts user profiles into Supabase Postgres', async () => {
    const readChain = createChain({ data: null, error: null });
    const writeChain = createChain({ data: null, error: null });
    writeChain.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    fromMock.mockReturnValueOnce(readChain).mockReturnValueOnce(writeChain);

    await service.upsertUserProfile({
      userId: 'user-1',
      displayName: 'Alice',
      preferences: { theme: 'dark' },
      onDemand: { monthlyCap: null },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(fromMock).toHaveBeenCalledWith('user_profile');
    expect(writeChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        display_name: 'Alice',
        created_at: '2026-01-01T00:00:00.000Z',
        preferences_json: { theme: 'dark' },
        on_demand_json: { monthlyCap: null },
      }),
    );
  });

  it('falls back to legacy user_profile upsert when extended columns are missing', async () => {
    const readChain = createChain({ data: null, error: null });
    const extendedFailChain = createChain({ data: null, error: null });
    extendedFailChain.upsert = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "Could not find the 'on_demand_json' column of 'user_profile' in the schema cache" },
    });
    const legacyChain = createChain({ data: null, error: null });
    legacyChain.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(extendedFailChain)
      .mockReturnValueOnce(legacyChain);

    await service.upsertUserProfile({
      userId: 'user-1',
      displayName: 'Alice',
      plan: 'indie_pro',
      preferences: { onboardingCompleted: true },
      onDemand: { monthlyCap: null },
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(legacyChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        preferences_json: { onboardingCompleted: true, selectedPlan: 'indie_pro' },
      }),
    );
    expect(legacyChain.upsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ on_demand_json: expect.anything() }),
    );
  });

  it('creates projects and owner membership rows', async () => {
    const projectChain = createChain({ data: null, error: null });
    const memberChain = createChain({ data: null, error: null });
    fromMock.mockImplementation((table: string) =>
      table === 'project' ? projectChain : memberChain,
    );

    const project = await service.createProject({
      projectId: 'proj-1',
      ownerUserId: 'user-1',
      name: ' Demo ',
      workspaceMode: 'solo',
    });

    expect(project.name).toBe('Demo');
    expect(projectChain.insert).toHaveBeenCalled();
    expect(memberChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        membership_id: 'proj-1:user-1',
        role: 'owner',
      }),
    );
  });

  it('consumes share links and upserts membership', async () => {
    const linkRow = {
      link_id: 'link-1',
      project_id: 'proj-1',
      token_hash: 'hash-1',
      role_to_grant: 'editor',
      created_by_user_id: 'owner-1',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      max_uses: 5,
      use_count: 0,
      revoked_at: null,
      consumed_at: null,
      created_at: new Date().toISOString(),
    };

    const getLinkChain = createChain({ data: linkRow, error: null });
    const updateLinkChain = createChain({ data: { ...linkRow, use_count: 1 }, error: null });
    const memberChain = createChain({
      data: {
        membership_id: 'proj-1:user-2',
        project_id: 'proj-1',
        user_id: 'user-2',
        role: 'editor',
        status: 'active',
        added_by_user_id: 'owner-1',
        display_name: 'Bob',
        color: '#ff0000',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'share_link') {
        return updateLinkChain.maybeSingle.mockImplementationOnce(async () => ({
          data: linkRow,
          error: null,
        })) || getLinkChain;
      }
      if (table === 'project_member') return memberChain;
      return createChain({ data: null, error: null });
    });

    // Simpler mock: first share_link call is select, second is update
    const shareLinkChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValueOnce({ data: linkRow, error: null }),
      update: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({ data: { ...linkRow, use_count: 1 }, error: null }),
    };
    const membershipLookup = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      upsert: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          membership_id: 'proj-1:user-2',
          project_id: 'proj-1',
          user_id: 'user-2',
          role: 'editor',
          status: 'active',
          added_by_user_id: 'owner-1',
          display_name: 'Bob',
          color: '#ff0000',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        error: null,
      }),
    };

    fromMock.mockImplementation((table: string) => {
      if (table === 'share_link') return shareLinkChain;
      if (table === 'project_member') return membershipLookup;
      return createChain({ data: null, error: null });
    });

    const result = await service.consumeShareLink('hash-1', 'user-2', {
      displayName: 'Bob',
      color: '#ff0000',
    });

    expect(result?.member.userId).toBe('user-2');
    expect(result?.link.useCount).toBe(1);
    expect(membershipLookup.upsert).toHaveBeenCalled();
  });

  it('returns deleted when a former member accesses a deleted project', async () => {
    const projectChain = createChain({
      data: {
        project_id: 'proj-1',
        owner_user_id: 'owner-1',
        name: 'Demo',
        workspace_mode: 'collaborative',
        status: 'deleted',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    const memberChain = createChain({
      data: {
        membership_id: 'proj-1:user-2',
        project_id: 'proj-1',
        user_id: 'user-2',
        role: 'editor',
        status: 'removed',
        added_by_user_id: 'owner-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    fromMock.mockImplementation((table: string) =>
      table === 'project' ? projectChain : memberChain,
    );

    const result = await service.resolveProjectAccessForUser('user-2', 'proj-1');
    expect(result).toEqual({ ok: false, reason: 'deleted' });
  });

  it('returns removed when membership was revoked on an active project', async () => {
    const projectChain = createChain({
      data: {
        project_id: 'proj-1',
        owner_user_id: 'owner-1',
        name: 'Demo',
        workspace_mode: 'collaborative',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    const memberChain = createChain({
      data: {
        membership_id: 'proj-1:user-2',
        project_id: 'proj-1',
        user_id: 'user-2',
        role: 'viewer',
        status: 'removed',
        added_by_user_id: 'owner-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      error: null,
    });
    fromMock.mockImplementation((table: string) =>
      table === 'project' ? projectChain : memberChain,
    );

    const result = await service.resolveProjectAccessForUser('user-2', 'proj-1');
    expect(result).toEqual({ ok: false, reason: 'removed' });
  });
});
