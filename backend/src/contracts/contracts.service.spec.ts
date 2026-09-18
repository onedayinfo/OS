import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    location: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    contract: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', clientId: 'cli1', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), franchiseUnit: 'VISITS', franchiseAmount: 4 }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data })),
    },
    contractSlaPolicy: { deleteMany: vi.fn(), createMany: vi.fn() },
    ticket: { count: vi.fn().mockResolvedValue(0) },
    visit: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('ContractsService.create', () => {
  it('rejeita endDate <= startDate', async () => {
    const service = new ContractsService(makePrisma() as any);
    await expect(
      service.create({
        clientId: 'cli1',
        name: 'X',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
        franchiseUnit: 'VISITS',
        franchiseAmount: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita franchiseAmount <= 0', async () => {
    const service = new ContractsService(makePrisma() as any);
    await expect(
      service.create({
        clientId: 'cli1',
        name: 'X',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        franchiseUnit: 'VISITS',
        franchiseAmount: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita local de outro cliente no escopo', async () => {
    const prisma = makePrisma({
      location: { findMany: vi.fn().mockResolvedValue([{ id: 'loc1', clientId: 'outro-cliente' }]) },
    });
    const service = new ContractsService(prisma as any);
    await expect(
      service.create({
        clientId: 'cli1',
        name: 'X',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        franchiseUnit: 'VISITS',
        franchiseAmount: 4,
        locationIds: ['loc1'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria com escopo válido', async () => {
    const prisma = makePrisma({
      location: { findMany: vi.fn().mockResolvedValue([{ id: 'loc1', clientId: 'cli1' }]) },
    });
    const service = new ContractsService(prisma as any);
    await service.create({
      clientId: 'cli1',
      name: 'Contrato X',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
      franchiseUnit: 'VISITS',
      franchiseAmount: 4,
      locationIds: ['loc1'],
    });
    expect(prisma.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: 'cli1', name: 'Contrato X' }),
      }),
    );
  });
});

describe('ContractsService.update / cancel', () => {
  it('update: 404 se não existir', async () => {
    const prisma = makePrisma({ contract: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new ContractsService(prisma as any);
    await expect(service.update('nope', { name: 'Y' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update: editar endDate limpa renewalWarnedAt', async () => {
    const service = new ContractsService(makePrisma() as any);
    await service.update('c1', { endDate: '2027-01-01T00:00:00.000Z' });
    const prisma = (service as unknown as { prisma: ReturnType<typeof makePrisma> }).prisma;
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ renewalWarnedAt: null }),
      }),
    );
  });

  it('cancel: muda status pra CANCELLED', async () => {
    const service = new ContractsService(makePrisma() as any);
    await service.cancel('c1');
    const prisma = (service as unknown as { prisma: ReturnType<typeof makePrisma> }).prisma;
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'CANCELLED' },
    });
  });
});
