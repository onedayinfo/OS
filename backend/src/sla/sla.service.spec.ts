import { SlaService } from './sla.service.js';

const makePrisma = () => ({
  slaPolicy: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
  },
  contractSlaPolicy: {
    findUnique: vi.fn(),
  },
});

describe('SlaService.dueAt', () => {
  it('calcula vencimento a partir da política', async () => {
    const prisma = makePrisma();
    prisma.slaPolicy.findUnique.mockResolvedValue({ priority: 'HIGH', hours: 8 });
    const service = new SlaService(prisma as any);
    const due = await service.dueAt('HIGH', new Date('2026-01-01T00:00:00Z'));
    expect(due.toISOString()).toBe('2026-01-01T08:00:00.000Z');
  });

  it('lança erro claro quando a política não existe', async () => {
    const prisma = makePrisma();
    prisma.slaPolicy.findUnique.mockResolvedValue(null);
    const service = new SlaService(prisma as any);
    await expect(service.dueAt('HIGH', new Date())).rejects.toThrow(/SLA/);
  });
});

describe('SlaService.dueAt — override de contrato', () => {
  it('usa o SlaPolicy global quando não há override', async () => {
    const prisma = {
      slaPolicy: { findUnique: vi.fn().mockResolvedValue({ priority: 'MEDIUM', hours: 8 }) },
      contractSlaPolicy: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new SlaService(prisma as any);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const due = await service.dueAt('MEDIUM', from, 'c1');
    expect(due.toISOString()).toBe('2026-01-01T08:00:00.000Z');
    expect(prisma.contractSlaPolicy.findUnique).toHaveBeenCalledWith({
      where: { contractId_priority: { contractId: 'c1', priority: 'MEDIUM' } },
    });
  });

  it('usa o override do contrato quando existe', async () => {
    const prisma = {
      slaPolicy: { findUnique: vi.fn().mockResolvedValue({ priority: 'MEDIUM', hours: 8 }) },
      contractSlaPolicy: { findUnique: vi.fn().mockResolvedValue({ hours: 2 }) },
    };
    const service = new SlaService(prisma as any);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const due = await service.dueAt('MEDIUM', from, 'c1');
    expect(due.toISOString()).toBe('2026-01-01T02:00:00.000Z');
  });

  it('sem contractId, comportamento idêntico ao de antes', async () => {
    const prisma = {
      slaPolicy: { findUnique: vi.fn().mockResolvedValue({ priority: 'MEDIUM', hours: 8 }) },
      contractSlaPolicy: { findUnique: vi.fn() },
    };
    const service = new SlaService(prisma as any);
    await service.dueAt('MEDIUM', new Date('2026-01-01T00:00:00.000Z'));
    expect(prisma.contractSlaPolicy.findUnique).not.toHaveBeenCalled();
  });
});
