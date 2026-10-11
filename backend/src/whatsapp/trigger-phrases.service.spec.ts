import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TriggerPhrasesService } from './trigger-phrases.service.js';

function make(over: Record<string, any> = {}) {
  const prisma = {
    category: { findUnique: vi.fn().mockResolvedValue({ id: 'cat1' }) },
    triggerPhrase: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: 'p1', clientId: 'c1', phraseNorm: 'x' }),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data })),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p1', ...data })),
      delete: vi.fn(),
      ...over,
    },
  };
  return { service: new TriggerPhrasesService(prisma as any), prisma };
}

describe('TriggerPhrasesService', () => {
  it('create normaliza a frase e aplica prioridade padrão', async () => {
    const { service, prisma } = make();
    await service.create({ clientId: 'c1', phrase: ' Sem Conexão ', priority: 'HIGH', title: 'Sem internet' });
    expect(prisma.triggerPhrase.create.mock.calls[0][0].data).toMatchObject({
      clientId: 'c1', phrase: 'Sem Conexão', phraseNorm: 'sem conexao', priority: 'HIGH', title: 'Sem internet',
    });
  });

  it('frase duplicada no mesmo escopo (inclusive global) → 400', async () => {
    const { service } = make({ findFirst: vi.fn().mockResolvedValue({ id: 'outra' }) });
    await expect(service.create({ phrase: 'Sistema caiu' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('categoria inexistente → 400', async () => {
    const { service, prisma } = make();
    prisma.category.findUnique.mockResolvedValue(null);
    await expect(service.create({ phrase: 'x1', categoryId: 'nao' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('frase vazia depois de normalizar → 400', async () => {
    const { service } = make();
    await expect(service.create({ phrase: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list(null) lista o padrão global', async () => {
    const { service, prisma } = make();
    await service.list(null);
    expect(prisma.triggerPhrase.findMany.mock.calls[0][0].where).toEqual({ clientId: null });
  });

  it('remove de id inexistente → 404 sem chamar delete', async () => {
    const { service, prisma } = make({ findUnique: vi.fn().mockResolvedValue(null) });
    await expect(service.remove('nao')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.triggerPhrase.delete).not.toHaveBeenCalled();
  });

  it('applyDefaults copia só as que o cliente ainda não tem', async () => {
    const globals = [
      { phrase: 'Sistema caiu', phraseNorm: 'sistema caiu', categoryId: 'cat1', priority: 'URGENT', title: null },
      { phrase: 'Sem conexão', phraseNorm: 'sem conexao', categoryId: null, priority: 'HIGH', title: 'Sem internet' },
    ];
    const findMany = vi.fn()
      .mockResolvedValueOnce(globals) // padrão global
      .mockResolvedValueOnce([{ phraseNorm: 'sem conexao' }]); // já no cliente
    const { service, prisma } = make({ findMany, createMany: vi.fn().mockResolvedValue({ count: 1 }) });
    const r = await service.applyDefaults('c1');
    expect(r).toEqual({ created: 1 });
    expect(prisma.triggerPhrase.createMany.mock.calls[0][0].data).toEqual([
      { clientId: 'c1', phrase: 'Sistema caiu', phraseNorm: 'sistema caiu', categoryId: 'cat1', priority: 'URGENT', title: null },
    ]);
  });
});
