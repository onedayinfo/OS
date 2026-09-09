import { PrismaClient } from '@prisma/client';
import { BackupService, TABLE_ORDER } from './backup.service.js';

// Teste de INTEGRAÇÃO: Postgres real (`docker compose up -d postgres`).
// Sem DATABASE_URL / banco no ar, o bloco pula com aviso (exit 0).
//
// NÃO exercita `import()` aqui: a restauração é destrutiva (apaga todas as
// tabelas) e este alvo roda contra o banco de dev compartilhado com os outros
// specs de integração. A ordem/validação do import já é coberta pelos unit
// tests com mocks; aqui garantimos só que `export()` lê o schema real.
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
});
