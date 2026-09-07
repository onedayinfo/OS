import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { AuthController } from '../auth/auth.controller.js';

describe('respostas de User não vazam passwordHash nem inviteToken', () => {
  it('createContact devolve allowlist sem passwordHash/inviteToken', async () => {
    const prisma = {
      user: {
        create: vi.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: 'u1',
            active: false,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          }),
        ),
      },
    };
    const mail = { sendInvite: vi.fn().mockResolvedValue(undefined) };
    const service = new UsersService(prisma as any, mail as any);

    const result = await service.createContact('cli1', {
      name: 'Contato',
      email: 'c@acme.com',
      role: 'CONTACT',
    } as any);

    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('inviteToken');
    expect(result).not.toHaveProperty('inviteSentAt');
    expect(result).toMatchObject({ email: 'c@acme.com', type: 'CLIENT' });
  });

  it('findAll devolve lista sem passwordHash/inviteToken', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u1',
            name: 'A',
            email: 'a@x.com',
            type: 'INTERNAL',
            role: 'AGENT',
            clientId: null,
            active: true,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            passwordHash: 'HASH',
            inviteToken: 'TOKEN',
            inviteSentAt: new Date(),
          },
        ]),
      },
    };
    const service = new UsersService(prisma as any, { sendInvite: vi.fn() } as any);

    const [row] = await service.findAll({});
    expect(row).not.toHaveProperty('passwordHash');
    expect(row).not.toHaveProperty('inviteToken');
    expect(row).not.toHaveProperty('inviteSentAt');
  });

  it('POST /auth/set-password devolve { ok: true } sem passwordHash', async () => {
    const users = {
      setPassword: vi.fn().mockResolvedValue({ id: 'u1', passwordHash: 'HASH' }),
    };
    const controller = new AuthController({} as any, users as any);

    const result = await controller.setPassword({ token: 't', password: 'senha1234' } as any);
    expect(result).toEqual({ ok: true });
    expect(result).not.toHaveProperty('passwordHash');
  });
});

describe('UsersService.update não permite escalonamento de papel', () => {
  const build = () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1' }),
        update: vi.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: 'u1',
            name: 'A',
            email: 'a@x.com',
            type: 'INTERNAL',
            role: 'AGENT',
            clientId: null,
            active: true,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          }),
        ),
      },
    };
    return { prisma, service: new UsersService(prisma as any, { sendInvite: vi.fn() } as any) };
  };

  it('ignora role no body (whitelist do DTO): update é chamado sem role', async () => {
    const { prisma, service } = build();
    await service.update('u1', { role: 'ADMIN' } as any);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('role');
  });

  it('active: false funciona', async () => {
    const { prisma, service } = build();
    await service.update('u1', { active: false } as any);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ active: false });
  });
});

describe('UsersService.createContact', () => {
  it('gera inviteToken hex e chama mail.sendInvite com link de definir-senha', async () => {
    const prisma = {
      user: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'u1', ...data })),
      },
    };
    const mail = { sendInvite: vi.fn().mockResolvedValue(undefined) };
    process.env.PORTAL_URL = 'http://portal.local';
    const service = new UsersService(prisma as any, mail as any);

    await service.createContact('cli1', {
      name: 'Contato',
      email: 'c@acme.com',
      role: 'CONTACT',
    } as any);

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.inviteToken).toMatch(/^[a-f0-9]{64}$/);
    expect(data.type).toBe('CLIENT');
    expect(data.clientId).toBe('cli1');
    expect(data.passwordHash).toBeNull();
    expect(data.inviteSentAt).toBeInstanceOf(Date);
    expect(mail.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'c@acme.com' }),
      expect.stringContaining('http://portal.local/portal/definir-senha?token='),
    );
  });
});

describe('UsersService.forgotPassword', () => {
  const build = (user: unknown) => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'u1', ...data })),
      },
    };
    const mail = { sendInvite: vi.fn().mockResolvedValue(undefined) };
    return { prisma, mail, service: new UsersService(prisma as any, mail as any) };
  };

  it('e-mail inexistente: 204 sem gerar token nem enviar', async () => {
    const { prisma, mail, service } = build(null);
    await expect(service.forgotPassword('nao@existe.com')).resolves.toBeUndefined();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(mail.sendInvite).not.toHaveBeenCalled();
  });

  it('CLIENT existente: novo token + link no PORTAL_URL', async () => {
    process.env.PORTAL_URL = 'http://portal.local';
    const { prisma, mail, service } = build({ id: 'u1', email: 'c@acme.com', type: 'CLIENT' });
    await service.forgotPassword('c@acme.com');
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.inviteToken).toMatch(/^[a-f0-9]{64}$/);
    expect(data.inviteSentAt).toBeInstanceOf(Date);
    expect(mail.sendInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'c@acme.com' }),
      expect.stringContaining('http://portal.local/portal/definir-senha?token='),
    );
  });

  it('INTERNAL existente: link no APP_URL', async () => {
    process.env.APP_URL = 'http://app.local';
    const { mail, service } = build({ id: 'u1', email: 'a@x.com', type: 'INTERNAL' });
    await service.forgotPassword('a@x.com');
    expect(mail.sendInvite).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('http://app.local/app/definir-senha?token='),
    );
  });
});

describe('UsersService.setPassword', () => {
  const build = (user: unknown) => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(user),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    return { prisma, service: new UsersService(prisma as any, { sendInvite: vi.fn() } as any) };
  };

  it('rejeita token com inviteSentAt > 7 dias', async () => {
    const { service } = build({
      id: 'u1',
      inviteToken: 't',
      inviteSentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    await expect(service.setPassword('t', 'senha1234')).rejects.toThrow(BadRequestException);
  });

  it('rejeita token inexistente', async () => {
    const { service } = build(null);
    await expect(service.setPassword('x', 'senha1234')).rejects.toThrow(BadRequestException);
  });

  it('aceita token dentro de 7 dias: grava hash, ativa e limpa o token', async () => {
    const { prisma, service } = build({
      id: 'u1',
      inviteToken: 't',
      inviteSentAt: new Date(Date.now() - 1000),
    });
    await service.setPassword('t', 'senha1234');
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.inviteToken).toBeNull();
    expect(data.inviteSentAt).toBeNull();
    expect(data.active).toBe(true);
    expect(data.passwordHash).toEqual(expect.any(String));
  });
});
