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

describe('OpportunitiesService.changeStage', () => {
  it('LOST sem lostReason é rejeitado', async () => {
    const service = new OpportunitiesService(makePrisma() as any);
    await expect(
      service.changeStage('o1', { stage: 'LOST' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('LOST com lostReason grava lostAt', async () => {
    const prisma = makePrisma();
    const service = new OpportunitiesService(prisma as any);
    const updated = await service.changeStage('o1', { stage: 'LOST', lostReason: 'Preço' });
    expect(updated).toMatchObject({ stage: 'LOST', lostReason: 'Preço' });
    expect(updated.lostAt).toBeInstanceOf(Date);
  });

  it('WON sem clientId cria Client e vincula', async () => {
    const client = { id: 'novo-cliente' };
    const prisma = makePrisma();
    (prisma as any).client.create = vi.fn().mockResolvedValue(client);
    (prisma as any).$transaction = vi.fn().mockImplementation((fn: any) => fn(prisma));
    const service = new OpportunitiesService(prisma as any);
    const updated = await service.changeStage('o1', { stage: 'WON' });
    expect(prisma.client.create).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({ stage: 'WON', clientId: 'novo-cliente' });
    expect(updated.wonAt).toBeInstanceOf(Date);
  });

  it('WON com clientId já preenchido não cria Client', async () => {
    const prisma = makePrisma({
      opportunity: {
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', stage: 'PROPOSAL', clientId: 'c1' }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'o1', clientId: 'c1', ...data })),
      },
    });
    (prisma as any).$transaction = vi.fn().mockImplementation((fn: any) => fn(prisma));
    const service = new OpportunitiesService(prisma as any);
    const updated = await service.changeStage('o1', { stage: 'WON' });
    expect((prisma as any).client.create).not.toHaveBeenCalled();
    expect(updated).toMatchObject({ stage: 'WON', clientId: 'c1' });
  });
});

describe('OpportunitiesService.addNote', () => {
  it('cria nota vinculada à oportunidade e ao autor', async () => {
    const prisma = makePrisma({
      opportunityNote: { create: vi.fn().mockResolvedValue({ id: 'n1', text: 'Ligou de volta' }) },
    });
    const service = new OpportunitiesService(prisma as any);
    const note = await service.addNote('o1', { text: 'Ligou de volta' }, 'u1');
    expect(note).toMatchObject({ id: 'n1', text: 'Ligou de volta' });
    expect((prisma as any).opportunityNote.create).toHaveBeenCalledWith({
      data: { opportunityId: 'o1', authorId: 'u1', text: 'Ligou de volta' },
    });
  });
});

describe('OpportunitiesService.followUps', () => {
  it('filtra por nextFollowUpAt <= agora e exclui WON/LOST', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ opportunity: { findMany } });
    const service = new OpportunitiesService(prisma as any);
    await service.followUps('overdue');
    const where = findMany.mock.calls[0][0].where;
    expect(where.stage.notIn).toEqual(['WON', 'LOST']);
    expect(where.nextFollowUpAt.lt).toBeInstanceOf(Date);
  });

  it('scope "today" filtra até o fim do dia', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ opportunity: { findMany } });
    const service = new OpportunitiesService(prisma as any);
    await service.followUps('today');
    const where = findMany.mock.calls[0][0].where;
    expect(where.nextFollowUpAt.lte).toBeInstanceOf(Date);
  });
});
