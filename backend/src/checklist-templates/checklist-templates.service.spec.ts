import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChecklistTemplatesService } from './checklist-templates.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    checklistTemplate: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'ct1', ...data, items: data.items?.create ?? [] }),
      ),
      update: vi.fn().mockResolvedValue({ id: 'ct1' }),
    },
    checklistTemplateItem: {
      update: vi.fn(),
      create: vi.fn(),
    },
    ...overrides,
  };
}

describe('ChecklistTemplatesService', () => {
  it('onModuleInit: cria o template padrão só se ainda não existir', async () => {
    const prisma = makePrisma();
    const service = new ChecklistTemplatesService(prisma as any);
    await service.onModuleInit();
    expect(prisma.checklistTemplate.findFirst).toHaveBeenCalledWith({
      where: { categoryId: null },
    });
    expect(prisma.checklistTemplate.create).toHaveBeenCalledTimes(1);
    const arg = (prisma.checklistTemplate.create as any).mock.calls[0][0];
    expect(arg.data.categoryId).toBeNull();
    expect(arg.data.items.create.length).toBeGreaterThan(0);
  });

  it('onModuleInit: não recria se já existe', async () => {
    const prisma = makePrisma({
      checklistTemplate: {
        findFirst: vi.fn().mockResolvedValue({ id: 'ct-padrao' }),
        create: vi.fn(),
      },
    });
    const service = new ChecklistTemplatesService(prisma as any);
    await service.onModuleInit();
    expect(prisma.checklistTemplate.create).not.toHaveBeenCalled();
  });

  it('create: rejeita categoria que já tem template', async () => {
    const prisma = makePrisma({
      checklistTemplate: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ id: 'existente' }),
        create: vi.fn(),
      },
    });
    const service = new ChecklistTemplatesService(prisma as any);
    await expect(
      service.create({ categoryId: 'cat1', name: 'X', items: [{ label: 'a' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update: 404 se não existir', async () => {
    const service = new ChecklistTemplatesService(makePrisma() as any);
    await expect(service.update('nope', { name: 'Y' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolveForCategory: cai no padrão quando a categoria não tem template ativo', async () => {
    const prisma = makePrisma({
      checklistTemplate: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null) // específico da categoria
          .mockResolvedValueOnce({ id: 'padrao' }), // fallback categoryId:null
      },
    });
    const service = new ChecklistTemplatesService(prisma as any);
    const resolved = await service.resolveForCategory('cat1');
    expect(resolved).toEqual({ id: 'padrao' });
  });
});
