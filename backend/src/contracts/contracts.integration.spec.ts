import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractsService } from './contracts.service.js';
import { SlaService } from '../sla/sla.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketStatusService } from '../tickets/ticket-status.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { SurveysService } from '../surveys/surveys.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Escopo do contrato → chamado no local
// coberto → contractId resolvido + SLA do contrato aplicado. Sobe com
// `docker compose up -d postgres`. Sem banco no ar, pula com aviso (exit 0).
const PFX = `CTR-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.contract.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Contracts — vínculo automático e SLA (Postgres real)', () => {
  let contracts: ContractsService;
  let tickets: TicketsService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[contracts.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente`, emailDomains: [EMAIL_DOMAIN] } });
    const location = await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Matriz` } });
    const requester = await prisma.user.create({
      data: { email: `contato@${EMAIL_DOMAIN}`, name: `${PFX} Contato`, type: 'CLIENT', role: 'CONTACT', clientId: client.id },
    });
    // Ator interno real: TicketEventsService.record grava actorId com FK
    // pra User, então precisa existir de fato (não dá pra usar um id fake).
    const actorUser = await prisma.user.create({
      data: { email: `admin@${EMAIL_DOMAIN}`, name: `${PFX} Admin`, type: 'INTERNAL', role: 'ADMIN' },
    });
    id.clientId = client.id;
    id.locationId = location.id;
    id.requesterId = requester.id;
    id.actorId = actorUser.id;

    const prismaService = prisma as unknown as PrismaService;
    contracts = new ContractsService(prismaService);
    const sla = new SlaService(prismaService);
    const events = new TicketEventsService();
    const ticketNumber = new TicketNumberService();
    const statusRules = new TicketStatusService();
    const notifier = { created: async () => {}, resolved: async () => {}, assigned: async () => {}, publicComment: async () => {}, slaBreached: async () => {} };
    const surveys = new SurveysService(prismaService);
    tickets = new TicketsService(prismaService, ticketNumber, sla, events, statusRules, notifier as any, contracts, surveys);

    await prisma.slaPolicy.upsert({
      where: { priority: 'MEDIUM' },
      update: { hours: 24 },
      create: { priority: 'MEDIUM', hours: 24 },
    });
  });

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('chamado no local do contrato resolve contractId e usa o SLA do contrato', async () => {
    if (!available) return;

    const contract = await contracts.create({
      clientId: id.clientId,
      name: `${PFX} Contrato`,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      franchiseUnit: 'VISITS',
      franchiseAmount: 2,
      locationIds: [id.locationId],
      slaOverrides: [{ priority: 'MEDIUM', hours: 2 }],
    });
    expect(contract.locations).toHaveLength(1);

    const before = new Date();
    const ticket = await tickets.create(
      {
        title: 'Chamado no escopo',
        description: 'desc',
        clientId: id.clientId,
        locationId: id.locationId,
        requesterId: id.requesterId,
      },
      { id: id.actorId, type: 'INTERNAL', role: 'ADMIN', clientId: null },
    );
    expect(ticket.contractId).toBe(contract.id);
    expect(ticket.slaDueAt!.getTime() - before.getTime()).toBeLessThan(3 * 3600_000 + 60_000);
    expect(ticket.slaDueAt!.getTime() - before.getTime()).toBeGreaterThan(1 * 3600_000);

    const consumption = await contracts.consumption(contract.id);
    expect(consumption.used).toBe(1);
    expect(consumption.exceeded).toBe(false);
  });
});
