import { PrismaClient } from '@prisma/client';
import { TicketNumberService } from './ticket-number.service.js';

// Teste com Postgres real (o brief exige exercitar a concorrência do upsert).
// Sobe com `docker compose up -d postgres`; usa a DATABASE_URL do backend/.env.
const TEST_YEAR = 3999;
// Pool grande o bastante para 20 transações interativas simultâneas segurarem
// cada uma sua conexão; senão elas expiram só tentando *iniciar*.
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('connection_limit', '30');
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const service = new TicketNumberService();
const TX_OPTS = { maxWait: 20000, timeout: 20000 };

describe('TicketNumberService.next (Postgres real)', () => {
  beforeEach(async () => {
    await prisma.counter.deleteMany({ where: { year: TEST_YEAR } });
  });
  afterEach(async () => {
    await prisma.counter.deleteMany({ where: { year: TEST_YEAR } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('3 transações sequenciais → 0001, 0002, 0003', async () => {
    const a = await prisma.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS);
    const b = await prisma.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS);
    const c = await prisma.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS);
    expect([a, b, c]).toEqual([
      `${TEST_YEAR}-0001`,
      `${TEST_YEAR}-0002`,
      `${TEST_YEAR}-0003`,
    ]);
  });

  it('20 transações concorrentes → 20 números distintos', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => service.next(tx, TEST_YEAR), TX_OPTS),
      ),
    );
    expect(new Set(results).size).toBe(20);
    expect(results.every((n) => n.startsWith(`${TEST_YEAR}-`))).toBe(true);
  });
});
