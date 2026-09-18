import { ContractPreventiveCron } from './contract-preventive.cron.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    contract: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    ticket: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 't1', ...data })) },
    counter: { upsert: vi.fn().mockResolvedValue({ value: 1 }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    ...overrides,
  };
  const ticketNumber = { next: vi.fn().mockResolvedValue('2026-0001') };
  const events = { record: vi.fn() };
  const sla = { dueAt: vi.fn().mockResolvedValue(new Date('2026-10-05T00:00:00.000Z')) };
  const cron = new ContractPreventiveCron(prisma as any, ticketNumber as any, events as any, sla as any);
  return { cron, prisma, ticketNumber, events, sla };
}

describe('ContractPreventiveCron', () => {
  it('sem contratos devidos, não faz nada', async () => {
    const { cron, prisma } = makeDeps();
    await cron.run();
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('gera um chamado por Local do escopo (direto + derivado dos ativos) e avança nextGenerationAt', async () => {
    const contract = {
      id: 'c1',
      clientId: 'cli1',
      name: 'Contrato X',
      defaultCategoryId: null,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      nextGenerationAt: new Date('2026-09-01T00:00:00.000Z'),
      preventiveFrequencyMonths: 1,
      locations: [{ id: 'loc1' }],
      assets: [{ id: 'a1', locationId: 'loc2' }],
    };
    const { cron, prisma } = makeDeps({
      contract: { findMany: vi.fn().mockResolvedValue([contract]), update: vi.fn() },
    });
    await cron.run();

    expect(prisma.ticket.create).toHaveBeenCalledTimes(2); // loc1 (direto) + loc2 (via ativo)
    const locIds = (prisma.ticket.create as any).mock.calls.map((c: any) => c[0].data.locationId);
    expect(locIds.sort()).toEqual(['loc1', 'loc2']);

    const loc2Call = (prisma.ticket.create as any).mock.calls.find((c: any) => c[0].data.locationId === 'loc2');
    expect(loc2Call[0].data.assets).toEqual({ connect: [{ id: 'a1' }] });
    expect(loc2Call[0].data.origin).toBe('CONTRACT');
    expect(loc2Call[0].data.needsTriage).toBe(false);
    expect(loc2Call[0].data.contractId).toBe('c1');

    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { nextGenerationAt: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('falha num contrato não impede os demais', async () => {
    const bad = {
      id: 'bad',
      clientId: 'cli1',
      name: 'Ruim',
      defaultCategoryId: null,
      startDate: new Date(),
      nextGenerationAt: new Date(),
      preventiveFrequencyMonths: 1,
      locations: [{ id: 'loc1' }],
      assets: [],
    };
    const good = { ...bad, id: 'good', locations: [{ id: 'loc2' }] };
    const prisma = {
      contract: {
        findMany: vi.fn().mockResolvedValue([bad, good]),
        update: vi.fn(),
      },
      ticket: {
        create: vi
          .fn()
          .mockRejectedValueOnce(new Error('boom'))
          .mockImplementation(({ data }: any) => Promise.resolve({ id: 't1', ...data })),
      },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };
    const { cron } = makeDeps(prisma);
    await cron.run();
    expect(prisma.contract.update).toHaveBeenCalledTimes(1);
    expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'good' } }));
  });
});
