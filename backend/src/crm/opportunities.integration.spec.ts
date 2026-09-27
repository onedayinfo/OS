import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OpportunitiesService } from './opportunities.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Ciclo lead → nota → follow-up → WON
// cria Client de verdade. Sobe com `docker compose up -d postgres`. Sem
// banco no ar, pula com aviso (exit 0).
const PFX = `CRM-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.opportunityNote.deleteMany({ where: { opportunity: { title: { startsWith: PFX } } } });
  await p.opportunity.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.quoteItem.deleteMany({ where: { quote: { client: { name: { startsWith: PFX } } } } });
  await p.quote.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.catalogItem.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.category.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Opportunities — ciclo lead até ganho (Postgres real)', () => {
  let opportunities: OpportunitiesService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[opportunities.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const owner = await prisma.user.create({
      data: { email: `admin@${EMAIL_DOMAIN}`, name: `${PFX} Admin`, type: 'INTERNAL', role: 'ADMIN' },
    });
    id.ownerId = owner.id;

    opportunities = new OpportunitiesService(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('lead → nota → follow-up → WON cria Client real e some da lista de follow-ups', async () => {
    if (!available) return;

    const opp = await opportunities.create({
      title: `${PFX} Oportunidade`,
      ownerId: id.ownerId,
      leadName: 'Fulano de Tal',
      leadCompany: `${PFX} Empresa`,
      leadPhone: '11999990000',
    });

    await opportunities.addNote(opp.id, { text: 'Primeira ligação feita.' }, id.ownerId);

    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();
    await opportunities.update(opp.id, { nextFollowUpAt: yesterday, nextFollowUpNote: 'Ligar de volta' });

    const overdue = await opportunities.followUps('overdue');
    expect(overdue.map((o) => o.id)).toContain(opp.id);

    const won = await opportunities.changeStage(opp.id, { stage: 'WON' });
    expect(won.clientId).toBeTruthy();

    const client = await prisma!.client.findUnique({ where: { id: won.clientId! } });
    expect(client?.name).toBe(`${PFX} Empresa`);

    const overdueAfterWin = await opportunities.followUps('overdue');
    expect(overdueAfterWin.map((o) => o.id)).not.toContain(opp.id);
  });

  it('oportunidade linkada a um Quote real traz o total calculado em findOne', async () => {
    if (!available) return;

    const client = await prisma!.client.create({ data: { name: `${PFX} Cliente Orçamento` } });
    const category = await prisma!.category.create({ data: { name: `${PFX} Categoria` } });
    const catalogItem = await prisma!.catalogItem.create({
      data: { name: `${PFX} Serviço`, type: 'SERVICE', unit: 'un', price: 100 },
    });
    const quote = await prisma!.quote.create({
      data: {
        number: 1,
        clientId: client.id,
        categoryId: category.id,
        title: `${PFX} Orçamento`,
        status: 'DRAFT',
        publicToken: `${PFX}-token`,
        createdById: id.ownerId,
        items: { create: [{ catalogItemId: catalogItem.id, quantity: 3, unitPrice: 100 }] },
      },
    });

    const opp = await opportunities.create({
      title: `${PFX} Oportunidade com orçamento`,
      ownerId: id.ownerId,
      clientId: client.id,
      quoteId: quote.id,
    });

    const found = await opportunities.findOne(opp.id);
    expect(found.quote?.total).toBe(3 * 100);
  });
});
