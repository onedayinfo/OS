import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { hashPassword } from './password.util.js';

const jwtStub = { signAsync: vi.fn().mockResolvedValue('access.jwt') } as any;

describe('AuthService.validateLogin', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPassword('correta');
  });

  let lastUpdate: ReturnType<typeof vi.fn>;
  const build = (user: unknown) => {
    lastUpdate = vi.fn().mockResolvedValue({});
    return new AuthService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(user), update: lastUpdate },
      } as any,
      jwtStub,
    );
  };

  it('retorna usuário com senha correta e grava lastLoginAt', async () => {
    const s = build({ id: 'u1', active: true, passwordHash: hash });
    await expect(s.validateLogin('a@a.com', 'correta')).resolves.toMatchObject({ id: 'u1' });
    expect(lastUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date) },
    });
  });

  it('login não quebra se o update de lastLoginAt falhar', async () => {
    const s = build({ id: 'u1', active: true, passwordHash: hash });
    lastUpdate.mockRejectedValue(new Error('db down'));
    await expect(s.validateLogin('a@a.com', 'correta')).resolves.toMatchObject({ id: 'u1' });
  });

  it('rejeita senha errada', async () => {
    const s = build({ id: 'u1', active: true, passwordHash: hash });
    await expect(s.validateLogin('a@a.com', 'errada')).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita usuário inativo', async () => {
    const s = build({ id: 'u1', active: false, passwordHash: hash });
    await expect(s.validateLogin('a@a.com', 'correta')).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita usuário sem hash', async () => {
    const s = build({ id: 'u1', active: true, passwordHash: null });
    await expect(s.validateLogin('a@a.com', 'correta')).rejects.toThrow(UnauthorizedException);
  });

  it('rejeita usuário inexistente', async () => {
    const s = build(null);
    await expect(s.validateLogin('a@a.com', 'correta')).rejects.toThrow(UnauthorizedException);
  });
});

describe('AuthService.issueTokens', () => {
  it('emite access JWT e grava refresh como sha256', async () => {
    const create = vi.fn();
    const prisma = { refreshToken: { create } } as any;
    const s = new AuthService(prisma, jwtStub);
    const out = await s.issueTokens({ id: 'u1', type: 'INTERNAL', role: 'ADMIN', clientId: null });
    expect(out.accessToken).toBe('access.jwt');
    expect(out.refreshToken).toMatch(/^[a-f0-9]{96}$/); // randomBytes(48).hex
    const data = create.mock.calls[0][0].data;
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(data.tokenHash).not.toBe(out.refreshToken);
    expect(data.userId).toBe('u1');
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('assina o access token com claims e TTL travados', async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    jwtStub.signAsync.mockClear();
    const prisma = { refreshToken: { create: vi.fn() } } as any;
    const s = new AuthService(prisma, jwtStub);
    await s.issueTokens({ id: 'u9', type: 'INTERNAL', role: 'MANAGER', clientId: 'c42' });
    expect(jwtStub.signAsync).toHaveBeenCalledWith(
      { sub: 'u9', type: 'INTERNAL', role: 'MANAGER', clientId: 'c42' },
      expect.objectContaining({ secret: 'test-access-secret', expiresIn: '15m' }),
    );
  });
});

describe('AuthService.rotateRefresh', () => {
  const validRow = {
    id: 'rt1',
    userId: 'u1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 1_000_000),
  };

  it('revoga o antigo e emite par novo', async () => {
    const update = vi.fn();
    const create = vi.fn();
    const updateMany = vi.fn();
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', active: true }) },
      refreshToken: {
        findFirst: vi.fn().mockResolvedValue({ ...validRow }),
        update,
        create,
        updateMany,
      },
    } as any;
    const s = new AuthService(prisma, jwtStub);
    const out = await s.rotateRefresh('raw-token');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'rt1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(create).toHaveBeenCalled();
    // Fluxo normal: revoga só o token apresentado, NÃO faz nuke de família.
    expect(updateMany).not.toHaveBeenCalled();
    expect(out.accessToken).toBe('access.jwt');
    expect(out.refreshToken).toMatch(/^[a-f0-9]{96}$/);
  });

  it('refresh já revogado → replay: revoga a família do usuário e lança', async () => {
    const updateMany = vi.fn();
    const prisma = {
      refreshToken: {
        findFirst: vi.fn().mockResolvedValue({ ...validRow, revokedAt: new Date() }),
        updateMany,
      },
    } as any;
    const s = new AuthService(prisma, jwtStub);
    await expect(s.rotateRefresh('raw-token')).rejects.toThrow(UnauthorizedException);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejeita refresh expirado não-revogado sem nuke de família', async () => {
    const updateMany = vi.fn();
    const prisma = {
      refreshToken: {
        findFirst: vi.fn().mockResolvedValue({ ...validRow, expiresAt: new Date(Date.now() - 1) }),
        updateMany,
      },
    } as any;
    const s = new AuthService(prisma, jwtStub);
    await expect(s.rotateRefresh('raw-token')).rejects.toThrow(UnauthorizedException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('token não encontrado → lança sem nuke', async () => {
    const updateMany = vi.fn();
    const prisma = {
      refreshToken: { findFirst: vi.fn().mockResolvedValue(null), updateMany },
    } as any;
    const s = new AuthService(prisma, jwtStub);
    await expect(s.rotateRefresh('raw-token')).rejects.toThrow(UnauthorizedException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout', () => {
  it('marca revokedAt via updateMany', async () => {
    const updateMany = vi.fn();
    const s = new AuthService({ refreshToken: { updateMany } } as any, jwtStub);
    await s.logout('raw-token');
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where.revokedAt).toBeNull();
    expect(arg.data.revokedAt).toBeInstanceOf(Date);
  });
});
