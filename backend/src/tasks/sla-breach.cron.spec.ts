import { SlaBreachCron } from './sla-breach.cron.js';

function make(overdue: any[]) {
  const prisma = {
    ticket: {
      findMany: vi.fn().mockResolvedValue(overdue),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
  const notifier = { slaBreached: vi.fn().mockResolvedValue(undefined) };
  const cron = new SlaBreachCron(prisma as any, notifier as any);
  vi.spyOn((cron as any).logger, 'log').mockImplementation(() => {});
  vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
  return { cron, prisma, notifier };
}

describe('SlaBreachCron', () => {
  it('notifica só os vencidos não-notificados e marca slaBreachNotifiedAt (1x cada)', async () => {
    const { cron, prisma, notifier } = make([{ id: 't1' }, { id: 't2' }]);

    await cron.run();

    expect(prisma.ticket.findMany).toHaveBeenCalledWith({
      where: {
        slaDueAt: { lt: expect.any(Date) },
        status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
        slaBreachNotifiedAt: null,
      },
    });
    expect(notifier.slaBreached).toHaveBeenCalledTimes(2);
    expect(prisma.ticket.update).toHaveBeenCalledTimes(2);
    for (const id of ['t1', 't2']) {
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id },
        data: { slaBreachNotifiedAt: expect.any(Date) },
      });
    }
  });

  it('segunda chamada com tickets já marcados não renotifica', async () => {
    const { cron, prisma, notifier } = make([]);

    await cron.run();

    expect(notifier.slaBreached).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('falha de slaBreached num ticket não trava os outros nem marca o que falhou', async () => {
    const { cron, prisma, notifier } = make([{ id: 't1' }, { id: 't2' }, { id: 't3' }]);
    notifier.slaBreached.mockRejectedValueOnce(new Error('smtp down'));

    await cron.run();

    expect(notifier.slaBreached).toHaveBeenCalledTimes(3);
    // t1 falhou → não marcado; t2 e t3 marcados
    expect(prisma.ticket.update).toHaveBeenCalledTimes(2);
    expect(prisma.ticket.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } }),
    );
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't2' },
      data: { slaBreachNotifiedAt: expect.any(Date) },
    });
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't3' },
      data: { slaBreachNotifiedAt: expect.any(Date) },
    });
  });
});
