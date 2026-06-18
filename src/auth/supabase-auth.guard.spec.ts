import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseService } from '../integrations/supabase.js';

const mockSupabase = {
  verifyToken: jest.fn(),
};

const makeContext = (authHeader?: string, isPublic = false) => ({
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({
    getRequest: () => ({
      headers: authHeader ? { authorization: authHeader } : {},
    }),
  }),
});

const makeReflector = (isPublic: boolean) => ({
  getAllAndOverride: jest.fn().mockReturnValue(isPublic),
});

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseAuthGuard,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: Reflector, useValue: makeReflector(false) },
      ],
    }).compile();
    guard = module.get(SupabaseAuthGuard);
    jest.clearAllMocks();
  });

  it('allows public routes without a token', async () => {
    const reflector = makeReflector(true) as unknown as Reflector;
    const publicGuard = new SupabaseAuthGuard(
      reflector,
      mockSupabase as unknown as SupabaseService,
    );
    const ctx = makeContext(undefined, true) as any;
    ctx.getHandler = () => ({});
    ctx.getClass = () => ({});
    await expect(publicGuard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects requests without an Authorization header', async () => {
    const ctx = makeContext() as any;
    ctx.getHandler = () => ({});
    ctx.getClass = () => ({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a non-Bearer scheme', async () => {
    const ctx = makeContext('Basic sometoken') as any;
    ctx.getHandler = () => ({});
    ctx.getClass = () => ({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('attaches the verified user to the request', async () => {
    const fakeUser = { id: 'user-1', email: 'a@b.com', role: undefined, claims: {} };
    mockSupabase.verifyToken.mockResolvedValue(fakeUser);

    const req: Record<string, unknown> = { headers: { authorization: 'Bearer tok' } };
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual(fakeUser);
  });

  it('throws UnauthorizedException when verifyToken rejects', async () => {
    mockSupabase.verifyToken.mockRejectedValue(
      new UnauthorizedException('bad token'),
    );
    const ctx = makeContext('Bearer badtok') as any;
    ctx.getHandler = () => ({});
    ctx.getClass = () => ({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
