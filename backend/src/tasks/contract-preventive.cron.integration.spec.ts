import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaService } from '../sla/sla.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { ContractPreventiveCron } from './contract-preventive.cron.js';

// Teste de INTEGRAÇÃO: Postgres real. O cron grava o Ticket direto via Prisma
// (não passa pelo TicketsService), então só um banco de verdade prova que o
// registro é válido. Sobe com `docker compose up -d postgres`. Sem banco no ar,
// pula com aviso (exit 0).
const PFX = `PREV-${Date.now()}`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticket.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.contract.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('ContractPreventiveCron — chamado real no banco (Postgres real)', () => {
  let cron: ContractPreventiveCron;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[contract-preventive.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const location = await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Matriz` } });
    const contract = await prisma.contract.create({
      data: {
        clientId: client.id,
        name: `${PFX} Contrato`,
        startDate: new Date(Date.now() - 60 * 24 * 3600_000),
        endDate: new Date(Date.now() + 365 * 24 * 3600_000),
        franchiseUnit: 'VISITS',
        franchiseAmount: 4,
        preventiveFrequencyMonths: 1,
        nextGenerationAt: new Date(Date.now() - 24 * 3600_000),
        locations: { connect: { id: location.id } },
      },
    });
    id.clientId = client.id;
    id.locationId = location.id;
    id.contractId = contract.id;

    await prisma.slaPolicy.upsert({
      where: { priority: 'MEDIUM' },
      update: { hours: 24 },
      create: { priority: 'MEDIUM', hours: 24 },
    });

    const prismaService = prisma as unknown as PrismaService;
    cron = new ContractPreventiveCron(
      prismaService,
      new TicketNumberService(),
      new TicketEventsService(),
      new SlaService(prismaService),
    );
  });

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('cria o Ticket preventivo no banco e avança nextGenerationAt', async () => {
    if (!available) return;

    await cron.run();

    const tickets = await prisma!.ticket.findMany({ where: { contractId: id.contractId } });
    expect(tickets).toHaveLength(1);
    const ticket = tickets[0];
    expect(ticket.origin).toBe('CONTRACT');
    expect(ticket.locationId).toBe(id.locationId);
    expect(ticket.clientId).toBe(id.clientId);
    expect(ticket.needsTriage).toBe(false);
    expect(ticket.slaDueAt).toBeTruthy();

    const events = await prisma!.ticketEvent.findMany({ where: { ticketId: ticket.id } });
    expect(events.map((e) => e.type)).toContain('CREATED');

    const contract = await prisma!.contract.findUnique({ where: { id: id.contractId } });
    expect(contract!.nextGenerationAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
