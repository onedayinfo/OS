import { UsersService } from './users.service.js';

function makeService() {
  const prisma = {
    user: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'u1', active: false, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }),
      ),
      findUnique: vi.fn().mockResolvedValue({ id: 'u1' }),
      update: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'u1', name: 'A', email: 'a@x.com', type: 'CLIENT', role: 'CONTACT', clientId: 'c1', active: true, phone: null, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }),
      ),
    },
  };
  const mail = { sendInvite: vi.fn().mockResolvedValue(undefined) };
  return { service: new UsersService(prisma as any, mail as any), prisma };
}

describe('telefone do contato', () => {
  it('createContact grava o telefone normalizado e o devolve', async () => {
    const { service, prisma } = makeService();
    const r = await service.createContact('c1', { name: 'N', email: 'n@x.com', role: 'CONTACT', phone: '+55 (19) 99999-1234' } as any);
    expect(prisma.user.create.mock.calls[0][0].data.phone).toBe('5519999991234');
    expect(r.phone).toBe('5519999991234');
  });

  it('update: string vazia limpa o telefone; ausente não mexe', async () => {
    const { service, prisma } = makeService();
    await service.update('u1', { phone: '' } as any);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ phone: null });
    await service.update('u1', { name: 'B' } as any);
    expect(prisma.user.update.mock.calls[1][0].data).toEqual({ name: 'B' });
  });
});
