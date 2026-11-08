import { ContractGate } from './contract-gate.service.js';

describe('ContractGate', () => {
  it('consulta contrato ACTIVE com endDate >= now', async () => {
    const prisma = { contract: { count: vi.fn().mockResolvedValue(1) } };
    const now = new Date('2026-01-01');
    expect(await new ContractGate(prisma as any).hasValidContract('c1', now)).toBe(true);
    expect(prisma.contract.count).toHaveBeenCalledWith({
      where: { clientId: 'c1', status: 'ACTIVE', endDate: { gte: now } },
    });
    prisma.contract.count.mockResolvedValue(0);
    expect(await new ContractGate(prisma as any).hasValidContract('c1', now)).toBe(false);
  });
});
