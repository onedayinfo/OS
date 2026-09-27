import { BadRequestException } from '@nestjs/common';
import { OpportunitiesService } from './opportunities.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    opportunity: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'o1', stage: 'NEW', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'o1', stage: 'NEW', clientId: null, quoteId: null }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'o1', ...data })),
      delete: vi.fn(),
    },
    client: { create: vi.fn() },
    ...overrides,
  };
}

describe('OpportunitiesService.create', () => {
  it('rejeita sem clientId e sem leadName', async () => {
    const service = new OpportunitiesService(makePrisma() as any);
    await expect(
      service.create({ title: 'X', ownerId: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita com clientId', async () => {
    const service = new OpportunitiesService(makePrisma() as any);
    const created = await service.create({ title: 'X', ownerId: 'u1', clientId: 'c1' });
    expect(created).toMatchObject({ clientId: 'c1', stage: 'NEW' });
  });

  it('aceita com leadName, sem clientId', async () => {
    const service = new OpportunitiesService(makePrisma() as any);
    const created = await service.create({ title: 'X', ownerId: 'u1', leadName: 'João' });
    expect(created).toMatchObject({ leadName: 'João' });
  });

  it('ignora campos de lead quando clientId também vem preenchido', async () => {
    const service = new OpportunitiesService(makePrisma() as any);
    const created = await service.create({
      title: 'X',
      ownerId: 'u1',
      clientId: 'c1',
      leadName: 'João',
    });
    expect(created.leadName).toBeUndefined();
  });
});

describe('OpportunitiesService.remove', () => {
  it('bloqueia exclusão de oportunidade WON', async () => {
    const prisma = makePrisma({
      opportunity: {
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', stage: 'WON' }),
        delete: vi.fn(),
      },
    });
    const service = new OpportunitiesService(prisma as any);
    await expect(service.remove('o1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite excluir oportunidade NEW', async () => {
    const prisma = makePrisma({
      opportunity: {
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', stage: 'NEW' }),
        delete: vi.fn().mockResolvedValue({}),
      },
    });
    const service = new OpportunitiesService(prisma as any);
    await expect(service.remove('o1')).resolves.toBeUndefined();
  });
});
