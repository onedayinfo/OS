import { WhatsappCron } from './whatsapp.cron.js';

function make(days?: number) {
  const prisma = { whatsappMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) } };
  const settings = { getNumber: vi.fn().mockResolvedValue(days) };
  const triage = { run: vi.fn().mockResolvedValue(undefined) };
  const status = { check: vi.fn().mockResolvedValue({}) };
  return { cron: new WhatsappCron(triage as any, status as any, prisma as any, settings as any), prisma, triage, status };
}

describe('WhatsappCron', () => {
  it('retenção apaga mensagens mais antigas que o configurado (padrão 90 dias)', async () => {
    const { cron, prisma } = make();
    const before = Date.now();
    await cron.retention();
    const cutoff: Date = prisma.whatsappMessage.deleteMany.mock.calls[0][0].where.sentAt.lt;
    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(90 * 24 * 3600_000 - 1000);
  });

  it('retenção configurada é respeitada; valor inválido (0) cai no padrão', async () => {
    const a = make(30);
    await a.cron.retention();
    const c1: Date = a.prisma.whatsappMessage.deleteMany.mock.calls[0][0].where.sentAt.lt;
    expect(Date.now() - c1.getTime()).toBeLessThan(31 * 24 * 3600_000);
    const b = make(0);
    await b.cron.retention();
    const c2: Date = b.prisma.whatsappMessage.deleteMany.mock.calls[0][0].where.sentAt.lt;
    expect(Date.now() - c2.getTime()).toBeGreaterThan(89 * 24 * 3600_000);
  });

  it('triageRun e statusCheck delegam', async () => {
    const { cron, triage, status } = make();
    await cron.triageRun();
    await cron.statusCheck();
    expect(triage.run).toHaveBeenCalled();
    expect(status.check).toHaveBeenCalled();
  });
});
