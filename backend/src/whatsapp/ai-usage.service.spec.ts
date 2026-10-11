import { AiUsageService, DEFAULT_DAILY_TOKEN_LIMIT, costUsd } from './ai-usage.service.js';

const TODAY = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

function make(row: any, limit?: number, extra: Record<string, number> = {}, monthRows: any[] = []) {
  const prisma = {
    aiUsage: {
      findUnique: vi.fn().mockResolvedValue(row),
      findMany: vi.fn().mockResolvedValue(row ? [{ day: TODAY, ...row }, ...monthRows] : monthRows),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const settings = { getNumber: vi.fn(async (k: string) => (k === 'ai.dailyTokenLimit' ? limit : extra[k])) };
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

  it('custo em dólar: US$0,10/M entrada + US$0,50/M saída', () => {
    expect(costUsd(1_000_000, 1_000_000)).toBeCloseTo(0.6);
  });

  it('pausa pelo teto diário em dólar', async () => {
    const snap = await make({ inputTokens: 0, outputTokens: 5_000_000 }, 100_000_000, { 'ai.dailyCostLimitUsd': 2 }).service.snapshot();
    expect(snap.day.costUsd).toBeCloseTo(2.5);
    expect(snap).toMatchObject({ paused: true, reason: 'DAILY_COST' });
  });

  it('pausa pelo teto mensal somando outros dias do mês', async () => {
    const prev = { day: `${TODAY.slice(0, 7)}-00`, inputTokens: 0, outputTokens: 39_000_000 };
    const snap = await make({ inputTokens: 0, outputTokens: 2_000_000 }, 100_000_000, { 'ai.dailyCostLimitUsd': 5, 'ai.monthlyCostLimitUsd': 20 }, [prev]).service.snapshot();
    expect(snap.month.costUsd).toBeCloseTo(20.5);
    expect(snap).toMatchObject({ paused: true, reason: 'MONTHLY_COST' });
  });

  it('avisa em 80% sem pausar; abaixo disso não avisa', async () => {
    const warn = await make({ inputTokens: 0, outputTokens: 3_300_000 }, 100_000_000, { 'ai.dailyCostLimitUsd': 2 }).service.snapshot();
    expect(warn).toMatchObject({ paused: false, warn: true });
    const ok = await make({ inputTokens: 0, outputTokens: 10_000 }, 100_000_000).service.snapshot();
    expect(ok).toMatchObject({ paused: false, warn: false, reason: null });
  });
});
