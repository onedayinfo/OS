import { Prisma, PrismaClient } from '@prisma/client';
import { BackupService, TABLE_ORDER } from './backup.service.js';

// Teste de INTEGRAÇÃO: Postgres real (`docker compose up -d postgres`).
// Sem DATABASE_URL / banco no ar, o bloco pula com aviso (exit 0).
//
// A restauração roda de verdade (exporta e reimporta o próprio banco de dev, em uma
// transação: se falhar, nada muda). Cobre ordem de FK e tabelas novas esquecidas.
let prisma: PrismaClient | undefined;
let svc: BackupService | undefined;
let available = false;

describe('BackupService.export (Postgres real)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('[integration] DATABASE_URL ausente — pulando export de backup.');
      return;
    }
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
      svc = new BackupService(prisma as never);
    } catch (err) {
      console.warn(`[integration] Postgres indisponível (${(err as Error).message}).`);
      prisma = undefined;
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => {});
  });

  it('lê todas as tabelas do schema e serializa em JSON', async () => {
    if (!available || !svc) return;
    const file = await svc.export();
    for (const t of TABLE_ORDER) expect(Array.isArray(file.data[t])).toBe(true);
    expect(() => JSON.stringify(file)).not.toThrow();
  });

  it('TABLE_ORDER cobre todos os modelos do Prisma (exceto refreshToken)', () => {
    const delegates = Prisma.dmmf.datamodel.models.map((m) => m.name[0].toLowerCase() + m.name.slice(1));
    const missing = delegates.filter((d) => d !== 'refreshToken' && !(TABLE_ORDER as readonly string[]).includes(d));
    expect(missing).toEqual([]);
  });

  it('exportar e restaurar o próprio banco preserva a contagem de cada tabela', async () => {
    if (!available || !svc || !prisma) return;
    // Semeia as tabelas do WhatsApp/IA (vazias no banco de dev) e limpa no fim.
    const client = await prisma.client.findFirst();
    const tag = `bkp-${Date.now()}`;
    const day = `1999-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`;
    let groupId: string | undefined;
    if (client) {
      const g = await prisma.whatsappGroup.create({ data: { externalId: `${tag}@g.us`, clientId: client.id } });
      groupId = g.id;
      await prisma.whatsappMessage.create({
        data: { externalId: tag, groupId, type: 'TEXT', body: 'x', sentAt: new Date(), aiResult: { a: 1 } },
      });
      await prisma.ticketSuggestion.create({
        data: { groupId, clientId: client.id, messageIds: [tag], excerpt: 'x', urgency: 3, summary: 'x' },
      });
    }
    await prisma.aiUsage.upsert({ where: { day }, create: { day, inputTokens: 5 }, update: {} });
    try {
      await roundTrip();
    } finally {
      if (groupId) await prisma.whatsappGroup.deleteMany({ where: { id: groupId } });
      await prisma.aiUsage.deleteMany({ where: { day } });
    }
  });
});

async function roundTrip() {
  const svc2 = svc!;
  {
    const before = await svc2.export();
    const file = JSON.parse(JSON.stringify(before));
    await svc2.import(file);
    const after = await svc2.export();
    for (const t of TABLE_ORDER) expect(after.data[t].length, t).toBe(before.data[t].length);
    expect(after.data.whatsappGroup.length).toBeGreaterThan(0);
    expect(after.data.whatsappMessage.length).toBeGreaterThan(0);
    expect(after.data.ticketSuggestion.length).toBeGreaterThan(0);
    expect(after.data.aiUsage.length).toBeGreaterThan(0);
  }
}
