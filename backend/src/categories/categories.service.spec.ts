import { NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    category: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cat1', ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: 'cat1', name: 'Rede' }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cat1', ...data })),
    },
    categorySlaPolicy: { deleteMany: vi.fn(), createMany: vi.fn() },
    ...overrides,
  };
}

describe('CategoriesService.create', () => {
  it('sem slaOverrides → cria sem create aninhado', async () => {
    const prisma = makePrisma();
    const service = new CategoriesService(prisma as any);
    await service.create({ name: 'Rede' });
    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Rede', slaOverrides: undefined },
      include: { slaOverrides: true },
    });
  });

  it('com slaOverrides → cria com create aninhado', async () => {
    const prisma = makePrisma();
    const service = new CategoriesService(prisma as any);
    await service.create({ name: 'Rede', slaOverrides: [{ priority: 'URGENT', hours: 2 }] });
    expect(prisma.category.create).toHaveBeenCalledWith({
      data: { name: 'Rede', slaOverrides: { create: [{ priority: 'URGENT', hours: 2 }] } },
      include: { slaOverrides: true },
    });
  });
});

describe('CategoriesService.update', () => {
  it('categoria inexistente → NotFoundException', async () => {
    const prisma = makePrisma({ category: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new CategoriesService(prisma as any);
    await expect(service.update('nope', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('slaOverrides definido → substitui (deleteMany + createMany)', async () => {
    const prisma = makePrisma();
    const service = new CategoriesService(prisma as any);
    await service.update('cat1', { slaOverrides: [{ priority: 'HIGH', hours: 4 }] });
    expect(prisma.categorySlaPolicy.deleteMany).toHaveBeenCalledWith({ where: { categoryId: 'cat1' } });
    expect(prisma.categorySlaPolicy.createMany).toHaveBeenCalledWith({
      data: [{ categoryId: 'cat1', priority: 'HIGH', hours: 4 }],
    });
  });

  it('slaOverrides: [] → limpa sem recriar', async () => {
    const prisma = makePrisma();
    const service = new CategoriesService(prisma as any);
    await service.update('cat1', { slaOverrides: [] });
    expect(prisma.categorySlaPolicy.deleteMany).toHaveBeenCalledWith({ where: { categoryId: 'cat1' } });
    expect(prisma.categorySlaPolicy.createMany).not.toHaveBeenCalled();
  });

  it('slaOverrides ausente → não mexe nos overrides existentes', async () => {
    const prisma = makePrisma();
    const service = new CategoriesService(prisma as any);
    await service.update('cat1', { name: 'Rede 2' });
    expect(prisma.categorySlaPolicy.deleteMany).not.toHaveBeenCalled();
  });
});
