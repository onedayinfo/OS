import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlaService } from './sla.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketStatusService } from '../tickets/ticket-status.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { SurveysService } from '../surveys/surveys.service.js';

// Teste de INTEGRAÇÃO: Postgres real. SLA por categoria (sem contrato) +
// pausa/retomada em WAITING_CLIENT. Sobe com `docker compose up -d
// postgres`. Sem banco no ar, pula com aviso (exit 0).
const PFX = `SLR-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.category.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('SLA real — categoria e pausa (Postgres real)', () => {
  let tickets: TicketsService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[sla-real.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente`, emailDomains: [EMAIL_DOMAIN] } });
    const requester = await prisma.user.create({
      data: { email: `contato@${EMAIL_DOMAIN}`, name: `${PFX} Contato`, type: 'CLIENT', role: 'CONTACT', clientId: client.id },
    });
    const actorUser = await prisma.user.create({
      data: { email: `admin@${EMAIL_DOMAIN}`, name: `${PFX} Admin`, type: 'INTERNAL', role: 'ADMIN' },
    });
    const category = await prisma.category.create({
      data: { name: `${PFX} Categoria`, slaOverrides: { create: [{ priority: 'MEDIUM', hours: 3 }] } },
    });
    id.clientId = client.id;
    id.requesterId = requester.id;
    id.actorId = actorUser.id;
    id.categoryId = category.id;

    const prismaService = prisma as unknown as PrismaService;
    const sla = new SlaService(prismaService);
    const events = new TicketEventsService();
    const ticketNumber = new TicketNumberService();
    const statusRules = new TicketStatusService();
    const notifier = { created: async () => {}, resolved: async () => {}, assigned: async () => {}, publicComment: async () => {}, slaBreached: async () => {}, surveyRequested: async () => {} };
    const contracts = new ContractsService(prismaService);
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

  it('chamado com categoria (sem contrato) usa o SLA da categoria', async () => {
    if (!available) return;

    const before = new Date();
    const ticket = await tickets.create(
      {
        title: `${PFX} sla categoria`,
        description: 'desc',
        clientId: id.clientId,
        requesterId: id.requesterId,
        categoryId: id.categoryId,
      },
      { id: id.actorId, type: 'INTERNAL', role: 'ADMIN', clientId: null },
    );
    // categoria dá 3h (< 24h global) — confirma que a categoria venceu.
    expect(ticket.slaDueAt!.getTime() - before.getTime()).toBeLessThan(4 * 3600_000);
    expect(ticket.slaDueAt!.getTime() - before.getTime()).toBeGreaterThan(2 * 3600_000);
  });

  it('pausar em WAITING_CLIENT e voltar empurra slaDueAt pra frente', async () => {
    if (!available) return;

    const ticket = await tickets.create(
      {
        title: `${PFX} pausa`,
        description: 'desc',
        clientId: id.clientId,
        requesterId: id.requesterId,
      },
      { id: id.actorId, type: 'INTERNAL', role: 'ADMIN', clientId: null },
    );
    const dueBefore = ticket.slaDueAt!.getTime();

    await tickets.changeStatus(ticket.id, 'WAITING_CLIENT', { id: id.actorId });
    await new Promise((r) => setTimeout(r, 1100)); // pausa real de >1s
    const resumed = await tickets.changeStatus(ticket.id, 'IN_PROGRESS', { id: id.actorId });

    expect(resumed.slaPausedAt).toBeNull();
    expect(resumed.slaPausedMs).toBeGreaterThanOrEqual(1000);
    expect(resumed.slaDueAt!.getTime()).toBeGreaterThan(dueBefore);
  });
});
