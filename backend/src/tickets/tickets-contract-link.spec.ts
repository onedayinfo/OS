import { TicketsService } from './tickets.service.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    ticket: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ id: 't1', clientId: 'cli1', locationId: null, assets: [] }),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ active: true, type: 'CLIENT', clientId: 'cli1' }) },
    location: { findUnique: vi.fn().mockResolvedValue({ id: 'loc1', clientId: 'cli1' }) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    ...overrides,
  };
  (prisma.ticket.create as any).mockImplementation(({ data }: any) =>
    Promise.resolve({ id: 't1', ...data }),
  );
  (prisma.ticket.update as any).mockImplementation(({ data }: any) =>
    Promise.resolve({ id: 't1', ...data }),
  );
  const sla = { dueAt: vi.fn().mockResolvedValue(new Date()) };
  const events = { record: vi.fn() };
  const contracts = { resolveForTicket: vi.fn().mockResolvedValue('c1') };
  const notifier = { created: vi.fn() };
  const ticketNumber = { next: vi.fn().mockResolvedValue('2026-0001') };
  const statusRules = { assertTransition: vi.fn() };
  const service = new TicketsService(
    prisma as any,
    ticketNumber as any,
    sla as any,
    events as any,
    statusRules as any,
    notifier as any,
    contracts as any,
    { createForTicket: vi.fn().mockResolvedValue(null) } as any,
  );
  return { service, prisma, contracts, sla };
}

const actor = { id: 'u1', type: 'INTERNAL', role: 'ADMIN', clientId: null };

describe('TicketsService — vínculo automático a contrato', () => {
  it('create: resolve o contrato pelo local e grava contractId + usa no SLA', async () => {
    const { service, prisma, contracts, sla } = makeDeps();
    await service.create(
      {
        title: 'x',
        description: 'y',
        clientId: 'cli1',
        requesterId: 'req1',
        locationId: 'loc1',
      },
      actor,
    );
    expect(contracts.resolveForTicket).toHaveBeenCalledWith('cli1', 'loc1', []);
    expect(sla.dueAt).toHaveBeenCalledWith('MEDIUM', expect.any(Date), 'c1');
    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contractId: 'c1' }) }),
    );
  });

  it('setTicketAssets: resolve o contrato pelo local novo e grava contractId', async () => {
    const { service, prisma, contracts } = makeDeps();
    await service.setTicketAssets('t1', { locationId: 'loc1', assetIds: [] }, actor);
    expect(contracts.resolveForTicket).toHaveBeenCalledWith('cli1', 'loc1', []);
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contractId: 'c1' }) }),
    );
  });
});
