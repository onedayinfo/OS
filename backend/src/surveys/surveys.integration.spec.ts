import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SurveysService } from './surveys.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketStatusService } from '../tickets/ticket-status.service.js';
import { SlaService } from '../sla/sla.service.js';
import { ContractsService } from '../contracts/contracts.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Fechar chamado com solicitante →
// survey criada com token → responder pelo token → respondedAt gravado →
// reabrir e fechar de novo não duplica. Sobe com `docker compose up -d
// postgres`. Sem banco no ar, pula com aviso.
const PFX = `SURV-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticketSatisfactionSurvey.deleteMany({ where: { ticket: { number: { startsWith: PFX } } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Surveys — ciclo completo ao fechar chamado (Postgres real)', () => {
  let tickets: TicketsService;
  let surveys: SurveysService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[surveys.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const requester = await prisma.user.create({
      data: { email: `contato@${EMAIL_DOMAIN}`, name: `${PFX} Contato`, type: 'CLIENT', role: 'CONTACT', clientId: client.id },
    });
    const ticket = await prisma.ticket.create({
      data: {
        number: `${PFX}-0001`,
        title: 'Chamado de teste',
        description: 'x',
        clientId: client.id,
        requesterId: requester.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
        origin: 'MANUAL',
        resolvedAt: new Date(),
      },
    });
    id.ticket = ticket.id;

    await prisma.slaPolicy.upsert({
      where: { priority: 'MEDIUM' },
      update: { hours: 24 },
      create: { priority: 'MEDIUM', hours: 24 },
    });

    const prismaService = prisma as unknown as PrismaService;
    surveys = new SurveysService(prismaService);
    const sla = new SlaService(prismaService);
    const events = new TicketEventsService();
    const ticketNumber = new TicketNumberService();
    const statusRules = new TicketStatusService();
    const contracts = new ContractsService(prismaService);
    const notifier = { created: async () => {}, resolved: async () => {}, assigned: async () => {}, publicComment: async () => {}, slaBreached: async () => {}, surveyRequested: async () => {} };
    tickets = new TicketsService(prismaService, ticketNumber, sla, events, statusRules, notifier as any, contracts, surveys);
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('fechar o chamado cria a pesquisa; responder grava a nota; reabrir e fechar de novo não duplica', async () => {
    if (!available) return;

    await tickets.changeStatus(id.ticket, 'CLOSED');
    const created = await prisma!.ticketSatisfactionSurvey.findUnique({ where: { ticketId: id.ticket } });
    expect(created).not.toBeNull();

    await surveys.respond(created!.publicToken, { score: 5, comment: 'Muito bom' });
    const responded = await prisma!.ticketSatisfactionSurvey.findUnique({ where: { ticketId: id.ticket } });
    expect(responded!.score).toBe(5);
    expect(responded!.respondedAt).not.toBeNull();

    await tickets.changeStatus(id.ticket, 'OPEN');
    await tickets.changeStatus(id.ticket, 'RESOLVED');
    await tickets.changeStatus(id.ticket, 'CLOSED');
    const count = await prisma!.ticketSatisfactionSurvey.count({ where: { ticketId: id.ticket } });
    expect(count).toBe(1);
  });
});
