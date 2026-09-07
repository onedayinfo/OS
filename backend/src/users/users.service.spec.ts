import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service.js';

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
      expect.stringContaining('http://portal.local/definir-senha?token='),
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
