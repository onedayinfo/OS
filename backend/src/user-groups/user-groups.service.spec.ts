import { ConflictException } from '@nestjs/common';
import { UserGroupsService } from './user-groups.service.js';

function setup(user: any = null) {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    userGroup: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
      findMany: vi.fn(),
    },
  };
  return { prisma, service: new UserGroupsService(prisma as any) };
}

describe('UserGroupsService', () => {
  it('isFullAdmin: só ADMIN sem grupo', async () => {
    expect(await setup({ role: 'ADMIN', groupId: null }).service.isFullAdmin('u')).toBe(true);
    expect(await setup({ role: 'ADMIN', groupId: 'g1' }).service.isFullAdmin('u')).toBe(false);
    expect(await setup({ role: 'AGENT', groupId: null }).service.isFullAdmin('u')).toBe(false);
  });

  it('screensFor: null sem grupo ou CLIENT; telas do grupo caso contrário', async () => {
    expect(await setup({ type: 'INTERNAL', group: null }).service.screensFor('u')).toBeNull();
    expect(
      await setup({ type: 'CLIENT', group: { screens: ['crm'] } }).service.screensFor('u'),
    ).toBeNull();
    expect(
      await setup({ type: 'INTERNAL', group: { screens: ['crm'] } }).service.screensFor('u'),
    ).toEqual(['crm']);
  });

  it('findAll devolve memberCount', async () => {
    const { prisma, service } = setup();
    prisma.userGroup.findMany.mockResolvedValue([
      { id: 'g1', name: 'A', screens: ['crm'], _count: { members: 2 } },
    ]);
    expect(await service.findAll()).toEqual([
      { id: 'g1', name: 'A', screens: ['crm'], memberCount: 2 },
    ]);
  });

  it('create com nome duplicado (P2002) vira ConflictException', async () => {
    const { prisma, service } = setup();
    prisma.userGroup.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create({ name: 'A', screens: [] })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('remove apaga o grupo (SetNull fica com o banco)', async () => {
    const { prisma, service } = setup();
    await service.remove('g1');
    expect(prisma.userGroup.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
  });
});
