import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { KnowledgeService } from './knowledge.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Artigo vinculado a categoria + tipo
// de ativo → sugestão bate num chamado com a mesma categoria/tipo de
// ativo. Sobe com `docker compose up -d postgres`. Sem banco no ar, pula
// com aviso (exit 0).
const PFX = `KB-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.knowledgeArticle.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.ticket.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.asset.deleteMany({ where: { label: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.assetType.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.category.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Base de conhecimento — sugestão por categoria/tipo de ativo (Postgres real)', () => {
  let knowledge: KnowledgeService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[knowledge.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente`, emailDomains: [EMAIL_DOMAIN] } });
    const actorUser = await prisma.user.create({
      data: { email: `admin@${EMAIL_DOMAIN}`, name: `${PFX} Admin`, type: 'INTERNAL', role: 'ADMIN' },
    });
    const category = await prisma.category.create({ data: { name: `${PFX} Categoria` } });
    const assetType = await prisma.assetType.create({ data: { name: `${PFX} Tipo` } });
    const location = await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Local` } });
    const asset = await prisma.asset.create({
      data: { clientId: client.id, locationId: location.id, typeId: assetType.id, label: `${PFX} Ativo` },
    });
    id.clientId = client.id;
    id.actorId = actorUser.id;
    id.categoryId = category.id;
    id.assetTypeId = assetType.id;
    id.assetId = asset.id;

    const prismaService = prisma as unknown as PrismaService;
    knowledge = new KnowledgeService(prismaService);

    await knowledge.create(
      { title: `${PFX} Artigo`, body: 'Procedimento de teste', categoryId: category.id, assetTypeId: assetType.id },
      { id: actorUser.id } as any,
    );

    await prisma.ticket.create({
      data: {
        title: `${PFX} Chamado`,
        description: 'desc',
        clientId: client.id,
        categoryId: category.id,
        origin: 'MANUAL',
        number: `${PFX}-0001`,
        assets: { connect: [{ id: asset.id }] },
      },
    });
  });

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('sugestão bate pelo artigo vinculado à mesma categoria e ao mesmo tipo de ativo', async () => {
    if (!available) return;

    const ticket = await prisma!.ticket.findFirst({ where: { title: `${PFX} Chamado` } });
    const suggestions = await knowledge.suggestFor(ticket!.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe(`${PFX} Artigo`);
  });
});
