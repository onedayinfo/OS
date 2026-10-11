import { AiUsageService, DEFAULT_DAILY_TOKEN_LIMIT } from './ai-usage.service.js';

function make(row: any, limit?: number) {
  const prisma = {
    aiUsage: { findUnique: vi.fn().mockResolvedValue(row), upsert: vi.fn().mockResolvedValue({}) },
  };
  const settings = { getNumber: vi.fn().mockResolvedValue(limit) };
  return { service: new AiUsageService(prisma as any, settings as any), prisma };
}

describe('AiUsageService', () => {
  it('soma entrada+saída do dia; sem registro = 0', async () => {
    expect(await make({ inputTokens: 100, outputTokens: 20 }).service.usedToday()).toBe(120);
    expect(await make(null).service.usedToday()).toBe(0);
  });

  it('limite configurado ou padrão; valor inválido cai no padrão', async () => {
    expect(await make(null, 1000).service.limit()).toBe(1000);
    expect(await make(null, undefined).service.limit()).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
    expect(await make(null, 0).service.limit()).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
  });

  it('pausa ao atingir o teto', async () => {
    expect(await make({ inputTokens: 900, outputTokens: 100 }, 1000).service.isPaused()).toBe(true);
    expect(await make({ inputTokens: 10, outputTokens: 10 }, 1000).service.isPaused()).toBe(false);
  });

  it('add faz upsert incrementando', async () => {
    const { service, prisma } = make(null);
    await service.add(50, 5);
    const arg = prisma.aiUsage.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ inputTokens: 50, outputTokens: 5, calls: 1 });
    expect(arg.update).toEqual({ inputTokens: { increment: 50 }, outputTokens: { increment: 5 }, calls: { increment: 1 } });
    expect(arg.where.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
