import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from './stock.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Entrada → transferência → requisição
// no chamado → saldo final correto nos dois depósitos. Sobe com
// `docker compose up -d postgres`. Sem banco no ar, pula com aviso.
const PFX = `STK-${Date.now()}`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

async function cleanup(p: PrismaClient) {
  await p.ticketMaterialUsage.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.stockTransfer.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.stockEntry.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.stockBalance.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.catalogItem.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.warehouse.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Stock — ciclo completo (Postgres real)', () => {
  let stock: StockService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[stock.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const prismaService = prisma as unknown as PrismaService;
    stock = new StockService(prismaService);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const almox = await prisma.warehouse.create({ data: { name: `${PFX} Almoxarifado` } });
    const van = await prisma.warehouse.create({ data: { name: `${PFX} Van` } });
    const item = await prisma.catalogItem.create({
      data: { name: `${PFX} Cabo de rede`, type: 'PRODUCT', unit: 'm', price: 3 },
    });
    const ticket = await prisma.ticket.create({
      data: {
        number: `${PFX}-0001`,
        title: 'Chamado de teste',
        description: 'x',
        clientId: client.id,
        priority: 'MEDIUM',
        status: 'IN_PROGRESS',
        origin: 'MANUAL',
      },
    });
    const user = await prisma.user.create({
      data: { email: `admin@${EMAIL_DOMAIN}`, name: `${PFX} Admin`, type: 'INTERNAL', role: 'ADMIN' },
    });
    id.almox = almox.id;
    id.van = van.id;
    id.item = item.id;
    id.ticket = ticket.id;
    id.user = user.id;
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('entrada, transferência e requisição deixam o saldo final correto', async () => {
    if (!available) return;

    await stock.createEntry({ catalogItemId: id.item, warehouseId: id.almox, quantity: 100, unitCost: 2 }, id.user);
    await stock.createTransfer({ catalogItemId: id.item, fromWarehouseId: id.almox, toWarehouseId: id.van, quantity: 30 }, id.user);
    await stock.registerMaterialUsage(id.ticket, { catalogItemId: id.item, warehouseId: id.van, quantity: 10 }, id.user);

    const balances = await stock.listBalances({ catalogItemId: id.item });
    const almoxBalance = balances.find((b) => b.warehouseId === id.almox)!;
    const vanBalance = balances.find((b) => b.warehouseId === id.van)!;
    expect(almoxBalance.quantity).toBe(70);
    expect(vanBalance.quantity).toBe(20);
    expect(vanBalance.avgCost).toBe(2);
  });
});
