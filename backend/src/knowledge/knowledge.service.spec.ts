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

describe('KnowledgeService.suggestFor', () => {
  function makeTicketPrisma(ticket: any, articles: any[] = []) {
    return makePrisma({
      ticket: { findUnique: vi.fn().mockResolvedValue(ticket) },
      knowledgeArticle: {
        ...makePrisma().knowledgeArticle,
        findMany: vi.fn().mockResolvedValue(articles),
      },
    });
  }

  it('chamado inexistente → NotFoundException', async () => {
    const prisma = makeTicketPrisma(null);
    const service = new KnowledgeService(prisma as any);
    await expect(service.suggestFor('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chamado sem categoria e sem ativos → devolve [] sem consultar o banco de artigos', async () => {
    const prisma = makeTicketPrisma({ categoryId: null, assets: [] });
    const service = new KnowledgeService(prisma as any);
    const result = await service.suggestFor('t1');
    expect(result).toEqual([]);
    expect(prisma.knowledgeArticle.findMany).not.toHaveBeenCalled();
  });

  it('bate por categoria', async () => {
    const prisma = makeTicketPrisma({ categoryId: 'c1', assets: [] }, [{ id: 'a1' }]);
    const service = new KnowledgeService(prisma as any);
    const result = await service.suggestFor('t1');
    expect(prisma.knowledgeArticle.findMany).toHaveBeenCalledWith({
      where: { active: true, OR: [{ categoryId: 'c1' }] },
      orderBy: { title: 'asc' },
    });
    expect(result).toEqual([{ id: 'a1' }]);
  });

  it('bate por tipo de ativo (dedup de tipos repetidos entre ativos)', async () => {
    const prisma = makeTicketPrisma(
      { categoryId: null, assets: [{ typeId: 't1' }, { typeId: 't1' }, { typeId: 't2' }] },
      [{ id: 'a1' }],
    );
    const service = new KnowledgeService(prisma as any);
    await service.suggestFor('t1');
    expect(prisma.knowledgeArticle.findMany).toHaveBeenCalledWith({
      where: { active: true, OR: [{ assetTypeId: { in: ['t1', 't2'] } }] },
      orderBy: { title: 'asc' },
    });
  });

  it('bate pelos dois (categoria e tipo de ativo) → OR com as duas condições', async () => {
    const prisma = makeTicketPrisma({ categoryId: 'c1', assets: [{ typeId: 't1' }] });
    const service = new KnowledgeService(prisma as any);
    await service.suggestFor('t1');
    expect(prisma.knowledgeArticle.findMany).toHaveBeenCalledWith({
      where: { active: true, OR: [{ categoryId: 'c1' }, { assetTypeId: { in: ['t1'] } }] },
      orderBy: { title: 'asc' },
    });
  });
});
