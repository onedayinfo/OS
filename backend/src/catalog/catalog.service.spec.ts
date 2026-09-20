import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    catalogItem: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ci1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'ci1', name: 'Instalação', type: 'SERVICE', unit: 'hora', price: 150, active: true }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ci1', ...data })),
    },
    ...overrides,
  };
}

describe('CatalogService', () => {
  it('cria um item de catálogo', async () => {
    const prisma = makePrisma();
    const service = new CatalogService(prisma as any);
    const item = await service.create({ name: 'Instalação', type: 'SERVICE', unit: 'hora', price: 150 });
    expect(prisma.catalogItem.create).toHaveBeenCalledWith({
      data: { name: 'Instalação', type: 'SERVICE', unit: 'hora', price: 150 },
    });
    expect(item.id).toBe('ci1');
  });

  it('lança NotFoundException ao atualizar item inexistente', async () => {
    const prisma = makePrisma({ catalogItem: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() } });
    const service = new CatalogService(prisma as any);
    await expect(service.update('nope', { active: false })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('atualiza campos parciais', async () => {
    const prisma = makePrisma();
    const service = new CatalogService(prisma as any);
    await service.update('ci1', { price: 200 });
    expect(prisma.catalogItem.update).toHaveBeenCalledWith({
      where: { id: 'ci1' },
      data: { price: 200 },
    });
  });
});
