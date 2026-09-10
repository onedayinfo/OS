import { ConflictException } from '@nestjs/common';
import { LocationsService } from './locations.service.js';

const makePrisma = () => ({
  client: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', active: true }) },
  location: {
    create: vi.fn().mockResolvedValue({ id: 'l1' }),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn().mockResolvedValue({ id: 'l1', clientId: 'c1' }),
    update: vi.fn().mockResolvedValue({ id: 'l1' }),
  },
});

describe('LocationsService', () => {
  it('create rejeita cliente inexistente', async () => {
    const prisma = makePrisma();
    prisma.client.findUnique.mockResolvedValue(null);
    const s = new LocationsService(prisma as any);
    await expect(s.create({ clientId: 'x', name: 'Matriz' } as any)).rejects.toThrow(
      'Cliente inválido ou inativo.',
    );
  });

  it('create traduz P2002 em ConflictException', async () => {
    const prisma = makePrisma();
    prisma.location.create.mockRejectedValue({ code: 'P2002' });
    const s = new LocationsService(prisma as any);
    await expect(s.create({ clientId: 'c1', name: 'Matriz' } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('findAll filtra por clientId e q, com envelope paginado', async () => {
    const prisma = makePrisma();
    prisma.location.findMany.mockResolvedValue([{ id: 'l1' }]);
    prisma.location.count.mockResolvedValue(1);
    const s = new LocationsService(prisma as any);
    const out = await s.findAll('c1', { page: 1, pageSize: 20, q: 'loja' } as any);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'c1', name: { contains: 'loja', mode: 'insensitive' } },
        skip: 0,
        take: 20,
      }),
    );
    expect(out).toEqual({ data: [{ id: 'l1' }], total: 1, page: 1, pageSize: 20 });
  });
});
