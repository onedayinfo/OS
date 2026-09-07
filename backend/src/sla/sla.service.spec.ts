import { SlaService } from './sla.service.js';

const makePrisma = () => ({
  slaPolicy: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
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
