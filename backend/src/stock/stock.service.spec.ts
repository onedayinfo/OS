import { BadRequestException } from '@nestjs/common';
import { StockService } from './stock.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    warehouse: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w1', active: true, ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: 'w1', name: 'Almoxarifado', active: true }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w1', ...data })),
    },
    stockBalance: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(({ create, update }: any) => Promise.resolve({ ...create, ...update })),
    },
    catalogItem: { findUnique: vi.fn() },
    ...overrides,
  };
}

describe('StockService — depósitos', () => {
  it('cria um depósito', async () => {
    const prisma = makePrisma();
    const service = new StockService(prisma as any);
    const w = await service.createWarehouse({ name: 'Van do João' });
    expect(prisma.warehouse.create).toHaveBeenCalledWith({ data: { name: 'Van do João' } });
    expect(w.id).toBe('w1');
  });

  it('bloqueia desativar depósito com saldo > 0', async () => {
    const prisma = makePrisma({
      stockBalance: { findFirst: vi.fn().mockResolvedValue({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 5 }) },
    });
    const service = new StockService(prisma as any);
    await expect(service.updateWarehouse('w1', { active: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite desativar depósito sem saldo', async () => {
    const prisma = makePrisma();
    const service = new StockService(prisma as any);
    await service.updateWarehouse('w1', { active: false });
    expect(prisma.warehouse.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { name: 'Almoxarifado', active: false },
    });
  });
});

describe('StockService — saldos', () => {
  it('marca belowMinimum quando quantity < minQuantity', async () => {
    const prisma = makePrisma({
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { catalogItemId: 'ci1', warehouseId: 'w1', quantity: 2, minQuantity: 5, avgCost: 10 },
          { catalogItemId: 'ci2', warehouseId: 'w1', quantity: 20, minQuantity: 5, avgCost: 10 },
        ]),
      },
    });
    const service = new StockService(prisma as any);
    const balances = await service.listBalances({});
    expect(balances.find((b) => b.catalogItemId === 'ci1')!.belowMinimum).toBe(true);
    expect(balances.find((b) => b.catalogItemId === 'ci2')!.belowMinimum).toBe(false);
  });

  it('filtra só os abaixo do mínimo quando pedido', async () => {
    const prisma = makePrisma({
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { catalogItemId: 'ci1', warehouseId: 'w1', quantity: 2, minQuantity: 5, avgCost: 10 },
          { catalogItemId: 'ci2', warehouseId: 'w1', quantity: 20, minQuantity: 5, avgCost: 10 },
        ]),
      },
    });
    const service = new StockService(prisma as any);
    const balances = await service.listBalances({ belowMinimum: 'true' });
    expect(balances).toHaveLength(1);
    expect(balances[0].catalogItemId).toBe('ci1');
  });
});

function makePrismaWithTx(overrides: Record<string, unknown> = {}) {
  const tx = {
    stockEntry: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'se1', ...data })) },
    stockBalance: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve(create)),
      update: vi.fn(),
    },
    ...overrides,
  };
  return {
    catalogItem: { findUnique: vi.fn().mockResolvedValue({ id: 'ci1', type: 'PRODUCT' }) },
    warehouse: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', active: true }) },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    tx,
  };
}

describe('StockService — entrada de estoque', () => {
  it('rejeita item que não é PRODUCT', async () => {
    const prisma = makePrismaWithTx({});
    prisma.catalogItem.findUnique = vi.fn().mockResolvedValue({ id: 'ci1', type: 'SERVICE' });
    const service = new StockService(prisma as any);
    await expect(
      service.createEntry({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, unitCost: 5 }, 'user1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria saldo do zero com avgCost = custo da entrada', async () => {
    const prisma = makePrismaWithTx();
    const service = new StockService(prisma as any);
    await service.createEntry({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, unitCost: 5 }, 'user1');
    expect(prisma.tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ quantity: 10, avgCost: 5 }),
      }),
    );
  });

  it('pondera avgCost quando já existe saldo', async () => {
    const prisma = makePrismaWithTx({
      stockBalance: {
        findUnique: vi.fn().mockResolvedValue({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, avgCost: 5 }),
        upsert: vi.fn().mockImplementation(({ update }: any) => Promise.resolve(update)),
        update: vi.fn(),
      },
    });
    const service = new StockService(prisma as any);
    await service.createEntry({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, unitCost: 15 }, 'user1');
    // (10*5 + 10*15) / 20 = 10
    expect(prisma.tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ quantity: 20, avgCost: 10 }) }),
    );
  });
});
