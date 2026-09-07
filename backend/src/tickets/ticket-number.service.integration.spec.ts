import { PrismaClient } from '@prisma/client';
import { TicketNumberService } from './ticket-number.service.js';

// Teste de INTEGRAÇÃO: Postgres real (o brief exige exercitar a concorrência do
// upsert). Sobe com `docker compose up -d postgres`; usa a DATABASE_URL do
// backend/.env. Sem banco no ar, o bloco pula com aviso (exit 0) — não quebra.
const TEST_YEAR = 3999;
const TX_OPTS = { maxWait: 20000, timeout: 20000 };

const service = new TicketNumberService();
let prisma: PrismaClient | undefined;
let available = false;

describe('TicketNumberService.next (Postgres real)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn(
        '[integration] DATABASE_URL ausente — pulando testes de concorrência. ' +
          'Rode `docker compose up -d postgres`.',
      );
      return;
    }
    // Pool grande o bastante para 20 transações interativas simultâneas
    // segurarem cada uma sua conexão; senão elas expiram só tentando *iniciar*.
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('connection_limit', '30');
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      await prisma.$connect();
      available = true;
    } catch (err) {
      console.warn(
        `[integration] Postgres indisponível (${(err as Error).message}) — ` +
          'pulando testes de concorrência.',
      );
      await prisma.$disconnect().catch(() => {});
      prisma = undefined;
    }
  });

  beforeEach(async (ctx) => {
    if (!available) return ctx.skip();
    await prisma!.counter.deleteMany({ where: { year: TEST_YEAR } });
  });
  afterEach(async () => {
    if (available) await prisma!.counter.deleteMany({ where: { year: TEST_YEAR } });
  });
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('3 transações sequenciais → 0001, 0002, 0003', async () => {
    const a = await prisma!.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS);
    const b = await prisma!.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS);
    const c = await prisma!.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS);
    expect([a, b, c]).toEqual([
      `${TEST_YEAR}-0001`,
      `${TEST_YEAR}-0002`,
      `${TEST_YEAR}-0003`,
    ]);
  });

  it('20 transações concorrentes → 20 números distintos', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma!.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS),
      ),
    );
    expect(new Set(results).size).toBe(20);
    expect(results.every((n) => n.startsWith(`${TEST_YEAR}-`))).toBe(true);
  });
});
