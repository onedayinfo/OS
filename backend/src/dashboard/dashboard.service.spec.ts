import { DashboardService } from './dashboard.service.js';

const MONTH_START = new Date('2026-09-01T00:00:00.000Z');
const MONTH_END = new Date('2026-10-01T00:00:00.000Z');

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    ticket: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    visit: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    quote: { findMany: vi.fn().mockResolvedValue([]) },
    ticketMaterialUsage: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('DashboardService.ticketsBlock', () => {
  it('conta open/overdue/recurring/standalone com as queries certas', async () => {
    const prisma = makePrisma({
      ticket: {
        count: vi
          .fn()
          .mockResolvedValueOnce(5) // open
          .mockResolvedValueOnce(2) // overdue
          .mockResolvedValueOnce(3) // recurring
          .mockResolvedValueOnce(7), // standalone
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.ticketsBlock(MONTH_START, MONTH_END);

    expect(result).toEqual({ open: 5, overdue: 2, recurring: 3, standalone: 7 });

    const calls = prisma.ticket.count.mock.calls;
    // open: status fora dos terminais, sem filtro de data
    expect(calls[0][0]).toEqual({ where: { status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } } });
    // overdue: idem + slaDueAt vencido
    expect(calls[1][0].where.status).toEqual({ notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] });
    expect(calls[1][0].where.slaDueAt).toEqual({ lt: expect.any(Date) });
    // recorrente: criado no mês, contractId preenchido
    expect(calls[2][0]).toEqual({
      where: { createdAt: { gte: MONTH_START, lt: MONTH_END }, contractId: { not: null } },
    });
    // avulso: criado no mês, sem contractId
    expect(calls[3][0]).toEqual({
      where: { createdAt: { gte: MONTH_START, lt: MONTH_END }, contractId: null },
    });
  });
});
