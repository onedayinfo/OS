import { NotFoundException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    knowledgeArticle: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'a1', title: 'X', body: 'Y' }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
    },
    ...overrides,
  };
}

const actor = { id: 'u1', type: 'INTERNAL', role: 'AGENT', clientId: null };

describe('KnowledgeService.findAll', () => {
  it('sem filtro nenhum → where vazio', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.findAll({});
    expect(prisma.knowledgeArticle.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('com q → OR em title/body case-insensitive', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.findAll({ q: 'rede' });
    expect(prisma.knowledgeArticle.findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { title: { contains: 'rede', mode: 'insensitive' } },
        { body: { contains: 'rede', mode: 'insensitive' } },
      ],
    });
  });

  it('com categoryId e assetTypeId → ambos no where', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.findAll({ categoryId: 'c1', assetTypeId: 't1' });
    expect(prisma.knowledgeArticle.findMany.mock.calls[0][0].where).toEqual({
      categoryId: 'c1',
      assetTypeId: 't1',
    });
  });
});

describe('KnowledgeService.create', () => {
  it('grava createdById a partir do actor', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.create({ title: 'T', body: 'B' }, actor);
    expect(prisma.knowledgeArticle.create).toHaveBeenCalledWith({
      data: { title: 'T', body: 'B', categoryId: null, assetTypeId: null, createdById: 'u1' },
    });
  });
});

describe('KnowledgeService.findOne', () => {
  it('artigo inexistente → NotFoundException', async () => {
    const prisma = makePrisma({ knowledgeArticle: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new KnowledgeService(prisma as any);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('KnowledgeService.update', () => {
  it('artigo inexistente → NotFoundException', async () => {
    const prisma = makePrisma({
      knowledgeArticle: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const service = new KnowledgeService(prisma as any);
    await expect(service.update('nope', { title: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('atualiza só os campos enviados', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.update('a1', { active: false });
    expect(prisma.knowledgeArticle.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { active: false },
    });
  });

  it('categoryId vazio ("") limpa o vínculo', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.update('a1', { categoryId: '' });
    expect(prisma.knowledgeArticle.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { categoryId: null },
    });
  });
});
