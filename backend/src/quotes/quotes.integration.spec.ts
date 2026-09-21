import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotesService } from './quotes.service.js';
import { QuoteNumberService } from './quote-number.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketStatusService } from '../tickets/ticket-status.service.js';
import { SlaService } from '../sla/sla.service.js';
import { ContractsService } from '../contracts/contracts.service.js';
import { SurveysService } from '../surveys/surveys.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Criar orçamento avulso → enviar →
// aprovar por token → chamado criado com origin QUOTE e originQuoteId certo.
const PFX = `QT-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.quote.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.catalogItem.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.category.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Quotes — aprovação avulsa vira chamado (Postgres real)', () => {
  let quotes: QuotesService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[quotes.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const category = await prisma.category.create({ data: { name: `${PFX} Categoria` } });
    const item = await prisma.catalogItem.create({
      data: { name: `${PFX} Instalação`, type: 'SERVICE', unit: 'un', price: 500 },
    });
    const user = await prisma.user.create({
      data: { email: `admin@${EMAIL_DOMAIN}`, name: `${PFX} Admin`, type: 'INTERNAL', role: 'ADMIN' },
    });
    id.client = client.id;
    id.category = category.id;
    id.item = item.id;
    id.user = user.id;

    await prisma.slaPolicy.upsert({
      where: { priority: 'MEDIUM' },
      update: { hours: 24 },
      create: { priority: 'MEDIUM', hours: 24 },
    });

    const prismaService = prisma as unknown as PrismaService;
    const sla = new SlaService(prismaService);
    const events = new TicketEventsService();
    const ticketNumber = new TicketNumberService();
    const statusRules = new TicketStatusService();
    const contracts = new ContractsService(prismaService);
    const notifier = { created: async () => {}, resolved: async () => {}, assigned: async () => {}, publicComment: async () => {}, slaBreached: async () => {} };
    const surveys = new SurveysService(prismaService);
    const tickets = new TicketsService(prismaService, ticketNumber, sla, events, statusRules, notifier as any, contracts, surveys);
    quotes = new QuotesService(prismaService, new QuoteNumberService(), tickets);
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('orçamento avulso aprovado gera chamado origin QUOTE', async () => {
    if (!available) return;

    const created = await quotes.create(
      {
        clientId: id.client,
        categoryId: id.category,
        title: `${PFX} Instalação nova`,
        items: [{ catalogItemId: id.item, quantity: 1 }],
      },
      id.user,
    );
    await quotes.send(created.id);
    const sentRow = await prisma!.quote.findUnique({ where: { id: created.id } });
    const approved = await quotes.approve(sentRow!.publicToken);

    expect(approved.status).toBe('APPROVED');
    expect(approved.ticketId).toBeTruthy();
    const ticket = await prisma!.ticket.findUnique({ where: { id: approved.ticketId! } });
    expect(ticket?.origin).toBe('QUOTE');
    expect(ticket?.originQuoteId).toBe(created.id);
  });
});
