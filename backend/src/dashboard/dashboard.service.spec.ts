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
    expect(calls[1][0].where.status).toEqual({ notIn: ['RESOLVED', 'CLOSED', 'CANCELLED', 'WAITING_CLIENT'] });
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

describe('DashboardService.avgResolutionHours', () => {
  it('devolve null se nenhum chamado foi resolvido no mês', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.avgResolutionHours(MONTH_START, MONTH_END);
    expect(result).toBeNull();
    expect(prisma.ticket.findMany).toHaveBeenCalledWith({
      where: { resolvedAt: { gte: MONTH_START, lt: MONTH_END } },
      select: { createdAt: true, resolvedAt: true },
    });
  });

  it('calcula a média em horas de resolvedAt - createdAt', async () => {
    const prisma = makePrisma({
      ticket: {
        count: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { createdAt: new Date('2026-09-01T00:00:00Z'), resolvedAt: new Date('2026-09-01T10:00:00Z') }, // 10h
          { createdAt: new Date('2026-09-02T00:00:00Z'), resolvedAt: new Date('2026-09-02T02:00:00Z') }, // 2h
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.avgResolutionHours(MONTH_START, MONTH_END);
    expect(result).toBe(6); // (10+2)/2
  });
});

describe('DashboardService.technicianProductivity', () => {
  it('devolve lista vazia sem chamados resolvidos nem visitas no mês', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.technicianProductivity(MONTH_START, MONTH_END);
    expect(result).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('mescla chamados resolvidos e horas trabalhadas por técnico', async () => {
    const prisma = makePrisma({
      ticket: {
        count: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { assigneeId: 'tec1' },
          { assigneeId: 'tec1' },
          { assigneeId: 'tec2' },
        ]),
      },
      visit: {
        findMany: vi.fn().mockResolvedValue([
          {
            technicianId: 'tec1',
            laborStartAt: new Date('2026-09-05T08:00:00Z'),
            laborEndAt: new Date('2026-09-05T12:00:00Z'), // 4h
          },
          {
            technicianId: 'tec3', // sem chamado resolvido, só visita
            laborStartAt: new Date('2026-09-06T08:00:00Z'),
            laborEndAt: new Date('2026-09-06T09:30:00Z'), // 1.5h
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'tec1', name: 'Técnico Um' },
          { id: 'tec2', name: 'Técnico Dois' },
          { id: 'tec3', name: 'Técnico Três' },
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.technicianProductivity(MONTH_START, MONTH_END);

    expect(result).toEqual(
      expect.arrayContaining([
        { technicianId: 'tec1', name: 'Técnico Um', ticketsResolved: 2, hoursWorked: 4 },
        { technicianId: 'tec2', name: 'Técnico Dois', ticketsResolved: 1, hoursWorked: 0 },
        { technicianId: 'tec3', name: 'Técnico Três', ticketsResolved: 0, hoursWorked: 1.5 },
      ]),
    );
    expect(result).toHaveLength(3);
  });
});

describe('DashboardService.contractsExceeded', () => {
  it('filtra só os contratos com consumption.exceeded=true e projeta os campos certos', async () => {
    const contractsService = {
      findAll: vi.fn().mockResolvedValue([
        {
          id: 'c1',
          name: 'Contrato A',
          client: { id: 'cli1', name: 'Cliente A' },
          consumption: { unit: 'VISITS', used: 5, franchiseAmount: 4, exceeded: true },
        },
        {
          id: 'c2',
          name: 'Contrato B',
          client: { id: 'cli2', name: 'Cliente B' },
          consumption: { unit: 'HOURS', used: 3, franchiseAmount: 10, exceeded: false },
        },
      ]),
    };
    const service = new DashboardService({} as any, contractsService as any);
    const result = await service.contractsExceeded();

    expect(contractsService.findAll).toHaveBeenCalledWith({ status: 'ACTIVE' });
    expect(result).toEqual([
      { contractId: 'c1', name: 'Contrato A', clientName: 'Cliente A', unit: 'VISITS', used: 5, franchiseAmount: 4 },
    ]);
  });
});

describe('DashboardService.margin', () => {
  it('devolve tudo zerado sem orçamento aprovado no mês', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.margin(MONTH_START, MONTH_END);
    expect(result).toEqual({
      ticketsCount: 0,
      totalRevenue: 0,
      totalMaterialCost: 0,
      totalMargin: 0,
      avgMarginPerTicket: null,
    });
    expect(prisma.ticketMaterialUsage.findMany).not.toHaveBeenCalled();
  });

  it('soma receita dos itens do orçamento e cruza com o custo de material do chamado', async () => {
    const prisma = makePrisma({
      quote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'q1', ticketId: 't1', items: [{ quantity: 2, unitPrice: 100 }] }, // receita 200
          { id: 'q2', ticketId: 't2', items: [{ quantity: 1, unitPrice: 500 }] }, // receita 500
        ]),
      },
      ticketMaterialUsage: {
        findMany: vi.fn().mockResolvedValue([
          { ticketId: 't1', quantity: 3, unitCost: 10 }, // custo 30 pro t1
          { ticketId: 't2', quantity: 2, unitCost: 50 }, // custo 100 pro t2
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.margin(MONTH_START, MONTH_END);

    expect(prisma.quote.findMany).toHaveBeenCalledWith({
      where: { status: 'APPROVED', approvedAt: { gte: MONTH_START, lt: MONTH_END }, ticket: { contractId: null } },
      include: { items: true },
    });
    expect(prisma.ticketMaterialUsage.findMany).toHaveBeenCalledWith({
      where: { ticketId: { in: ['t1', 't2'] } },
    });
    expect(result).toEqual({
      ticketsCount: 2,
      totalRevenue: 700, // 200 + 500
      totalMaterialCost: 130, // 30 + 100
      totalMargin: 570,
      avgMarginPerTicket: 285,
    });
  });

  it('dois orçamentos aprovados pro mesmo chamado não duplicam custo nem contagem', async () => {
    const prisma = makePrisma({
      quote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'q1', ticketId: 't1', items: [{ quantity: 1, unitPrice: 100 }] },
          { id: 'q2', ticketId: 't1', items: [{ quantity: 1, unitPrice: 50 }] },
        ]),
      },
      ticketMaterialUsage: {
        findMany: vi.fn().mockResolvedValue([{ ticketId: 't1', quantity: 2, unitCost: 10 }]), // custo 20
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.margin(MONTH_START, MONTH_END);
    expect(result.ticketsCount).toBe(1);
    expect(result.totalRevenue).toBe(150); // 100 + 50, receita soma os dois orçamentos
    expect(result.totalMaterialCost).toBe(20); // custo contado 1x, não 2x
    expect(result.totalMargin).toBe(130);
  });

  it('chamado com orçamento aprovado mas sem material usado conta custo 0', async () => {
    const prisma = makePrisma({
      quote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'q1', ticketId: 't1', items: [{ quantity: 1, unitPrice: 300 }] },
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.margin(MONTH_START, MONTH_END);
    expect(result).toEqual({
      ticketsCount: 1,
      totalRevenue: 300,
      totalMaterialCost: 0,
      totalMargin: 300,
      avgMarginPerTicket: 300,
    });
  });
});

describe('DashboardService.overview', () => {
  it('calcula os limites do mês corrente e agrega os 5 blocos', async () => {
    const prisma = makePrisma();
    const contractsService = { findAll: vi.fn().mockResolvedValue([]) };
    const service = new DashboardService(prisma as any, contractsService as any);

    const spyTickets = vi.spyOn(service, 'ticketsBlock').mockResolvedValue({ open: 1, overdue: 0, recurring: 0, standalone: 1 });
    const spyAvg = vi.spyOn(service, 'avgResolutionHours').mockResolvedValue(5);
    const spyTech = vi.spyOn(service, 'technicianProductivity').mockResolvedValue([]);
    const spyContracts = vi.spyOn(service, 'contractsExceeded').mockResolvedValue([]);
    const spyMargin = vi.spyOn(service, 'margin').mockResolvedValue({
      ticketsCount: 0, totalRevenue: 0, totalMaterialCost: 0, totalMargin: 0, avgMarginPerTicket: null,
    });

    const result = await service.overview();

    expect(result.tickets).toEqual({ open: 1, overdue: 0, recurring: 0, standalone: 1 });
    expect(result.avgResolutionHours).toBe(5);
    expect(result.technicianProductivity).toEqual([]);
    expect(result.contractsExceeded).toEqual([]);
    expect(result.margin.ticketsCount).toBe(0);
    expect(result.period.start).toBeTypeOf('string');
    expect(result.period.end).toBeTypeOf('string');

    // os 4 métodos que recebem período foram chamados com os MESMOS limites
    const [start1, end1] = spyTickets.mock.calls[0];
    const [start2, end2] = spyAvg.mock.calls[0];
    const [start3, end3] = spyTech.mock.calls[0];
    const [start4, end4] = spyMargin.mock.calls[0];
    expect(start1).toEqual(start2);
    expect(start1).toEqual(start3);
    expect(start1).toEqual(start4);
    expect(end1).toEqual(end2);
    expect(end1).toEqual(end3);
    expect(end1).toEqual(end4);
    expect(spyContracts).toHaveBeenCalledWith();
  });
});
