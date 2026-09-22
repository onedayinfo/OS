import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardService } from './dashboard.service.js';
import { ContractsService } from '../contracts/contracts.service.js';

// Teste de INTEGRAÇÃO: Postgres real. 1 chamado avulso com orçamento
// aprovado + material usado, 1 chamado de contrato, 1 contrato com
// franquia estourada, 1 visita com horas apontadas → overview() confere
// os 5 blocos. Sobe com `docker compose up -d postgres`. Sem banco no ar,
// pula com aviso.
const PFX = `DASH-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticketMaterialUsage.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.quoteItem.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.quote.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.visit.deleteMany({ where: { ticket: { number: { startsWith: PFX } } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.contract.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.warehouse.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.catalogItem.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Dashboard — overview com dados reais (Postgres real)', () => {
  let dashboard: DashboardService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[dashboard.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const location = await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Local` } });
    const technician = await prisma.user.create({
      data: { email: `tec@${EMAIL_DOMAIN}`, name: `${PFX} Técnico`, type: 'INTERNAL', role: 'AGENT' },
    });
    const item = await prisma.catalogItem.create({
      data: { name: `${PFX} Instalação`, type: 'SERVICE', unit: 'un', price: 500 },
    });

    // Contrato ativo com franquia de 1 visita/mês — vamos estourar com 2 chamados.
    const contract = await prisma.contract.create({
      data: {
        clientId: client.id,
        name: `${PFX} Contrato`,
        startDate: new Date('2020-01-01'),
        endDate: new Date('2030-01-01'),
        franchiseUnit: 'VISITS',
        franchiseAmount: 1,
        locations: { connect: [{ id: location.id }] },
      },
    });

    const now = new Date();

    // Chamado avulso, resolvido, com orçamento aprovado + material usado.
    const standaloneTicket = await prisma.ticket.create({
      data: {
        number: `${PFX}-0001`,
        title: 'Chamado avulso',
        description: 'x',
        clientId: client.id,
        assigneeId: technician.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
        origin: 'MANUAL',
        resolvedAt: now,
      },
    });
    const quote = await prisma.quote.create({
      data: {
        number: 1,
        clientId: client.id,
        ticketId: standaloneTicket.id,
        status: 'APPROVED',
        version: 1,
        publicToken: `${PFX}-token`,
        approvedAt: now,
        createdById: technician.id,
        items: { create: [{ catalogItemId: item.id, quantity: 1, unitPrice: 500 }] },
      },
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `${PFX} Depósito` } });
    await prisma.ticketMaterialUsage.create({
      data: { ticketId: standaloneTicket.id, catalogItemId: item.id, warehouseId: warehouse.id, quantity: 1, unitCost: 100, createdById: technician.id },
    });

    // 2 chamados de contrato no mês → estoura a franquia de 1.
    for (let i = 0; i < 2; i++) {
      await prisma.ticket.create({
        data: {
          number: `${PFX}-000${i + 2}`,
          title: 'Chamado de contrato',
          description: 'x',
          clientId: client.id,
          contractId: contract.id,
          priority: 'MEDIUM',
          status: 'OPEN',
          origin: 'MANUAL',
        },
      });
    }

    // Visita com horas apontadas pro técnico.
    await prisma.visit.create({
      data: {
        ticketId: standaloneTicket.id,
        technicianId: technician.id,
        status: 'DONE',
        scheduledStart: now,
        scheduledEnd: now,
        laborStartAt: new Date(now.getTime() - 2 * 3_600_000),
        laborEndAt: now,
      },
    });

    id.quoteId = quote.id;

    const prismaService = prisma as unknown as PrismaService;
    const contracts = new ContractsService(prismaService);
    dashboard = new DashboardService(prismaService, contracts);
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('overview() reflete o cenário criado', async () => {
    if (!available) return;

    const result = await dashboard.overview();

    expect(result.tickets.recurring).toBeGreaterThanOrEqual(2);
    expect(result.tickets.standalone).toBeGreaterThanOrEqual(1);
    expect(result.avgResolutionHours).not.toBeNull();
    expect(result.technicianProductivity.find((t) => t.name === `${PFX} Técnico`)).toMatchObject({
      ticketsResolved: 1,
      hoursWorked: 2,
    });
    expect(result.contractsExceeded.find((c) => c.name === `${PFX} Contrato`)).toMatchObject({
      unit: 'VISITS',
      used: 2,
      franchiseAmount: 1,
    });
    expect(result.margin.ticketsCount).toBeGreaterThanOrEqual(1);
    expect(result.margin.totalRevenue).toBeGreaterThanOrEqual(500);
    expect(result.margin.totalMaterialCost).toBeGreaterThanOrEqual(100);
  });
});
