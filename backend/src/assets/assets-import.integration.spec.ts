import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssetsImportService } from './assets-import.service.js';

// Teste de INTEGRAÇÃO: Postgres real (`docker compose up -d postgres`). Sem
// DATABASE_URL / banco no ar, o bloco pula com aviso (exit 0). Cobre o import
// CSV ponta a ponta: 1 linha boa + 3 erros (tipo inexistente, data inválida,
// número de série duplicado — este último é o caminho P2002 do @@unique).
const PFX = `ATL-${Date.now()}`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.asset.deleteMany({ where: { label: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.assetType.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('AssetsImportService.import — integração (Postgres real)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn(
        '[integration] DATABASE_URL ausente — pulando import de ativos. ' +
          'Rode `docker compose up -d postgres`.',
      );
      return;
    }
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch (err) {
      console.warn(`[integration] Postgres indisponível (${(err as Error).message}).`);
      await prisma.$disconnect().catch(() => {});
      prisma = undefined;
      return;
    }

    await cleanup(prisma);
    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    id.client = client.id;
    id.loc = (await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Matriz` } })).id;
    id.type = (await prisma.assetType.create({ data: { name: `${PFX} Câmera` } })).id;
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup(prisma).catch(() => {});
      await prisma.$disconnect();
    }
  });

  it('created: 1 e 3 erros com as linhas certas; 1 asset no banco', async (ctx) => {
    if (!available || !prisma) return ctx.skip();
    const cli = `${PFX} Cliente`;
    const loc = `${PFX} Matriz`;
    const tipo = `${PFX} Câmera`;
    const head =
      'cliente,local,tipo,identificacao,marca,modelo,numero_serie,ip,mac,instalado_em,garantia_ate,observacoes';
    const rows = [
      `${cli},${loc},${tipo},${PFX} CAM-BOA,,,SN-GOOD,,,,,`, // linha 2 — boa
      `${cli},${loc},${PFX} Inexistente,${PFX} CAM-TIPO,,,,,,,,`, // linha 3 — tipo inexistente
      `${cli},${loc},${tipo},${PFX} CAM-DATA,,,,,,31-12-2026,,`, // linha 4 — data inválida
      `${cli},${loc},${tipo},${PFX} CAM-DUP,,,SN-GOOD,,,,,`, // linha 5 — série duplicada
    ];
    const csv = Buffer.from(`${head}\n${rows.join('\n')}\n`, 'utf8');

    const svc = new AssetsImportService(prisma as unknown as PrismaService);
    const result = await svc.import(csv);

    expect(result.created).toBe(1);
    expect(result.errors.map((e) => e.line).sort()).toEqual([3, 4, 5]);

    const count = await prisma.asset.count({ where: { label: { startsWith: PFX } } });
    expect(count).toBe(1);
  });
});
