import { TicketsService } from './tickets.service.js';
import { TicketEventsService } from './ticket-events.service.js';
import { TicketStatusService } from './ticket-status.service.js';

const HOUR = 3600_000;
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

function makeService(current: any) {
  const events: any[] = [];
  const tx = {
    ticket: {
      update: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 't1', number: '2026-0001', ...current, ...data }),
      ),
    },
    ticketEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        events.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    ticket: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't1',
        number: '2026-0001',
        createdAt: CREATED_AT,
        ...current,
      }),
    },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
  };
  // URGENT = 4h
  const sla = {
    dueAt: vi.fn().mockImplementation((_p: string, from: Date) =>
      Promise.resolve(new Date(from.getTime() + 4 * HOUR)),
    ),
  };
  const notifier = { created: vi.fn(), resolved: vi.fn(), assigned: vi.fn().mockResolvedValue(undefined) };
  const service = new TicketsService(
    prisma as any,
    {} as any,
    sla as any,
    new TicketEventsService(),
    new TicketStatusService(),
    notifier as any,
  );
  return { service, sla, notifier, events, tx };
}

describe('TicketsService.changePriority', () => {
  it('MEDIUM→URGENT em ticket ativo recalcula slaDueAt para createdAt + 4h', async () => {
    const { service, sla, tx, events } = makeService({ status: 'IN_PROGRESS', priority: 'MEDIUM' });
    await service.changePriority('t1', 'URGENT', { id: 'ag' });

    expect(sla.dueAt).toHaveBeenCalledWith('URGENT', CREATED_AT);
    const data = tx.ticket.update.mock.calls[0][0].data;
    expect(data.priority).toBe('URGENT');
    expect((data.slaDueAt as Date).getTime()).toBe(CREATED_AT.getTime() + 4 * HOUR);
    expect(events).toEqual([
      expect.objectContaining({ type: 'PRIORITY_CHANGED', data: { from: 'MEDIUM', to: 'URGENT' } }),
    ]);
  });

  it('em ticket CLOSED NÃO recalcula slaDueAt', async () => {
    const { service, sla, tx } = makeService({ status: 'CLOSED', priority: 'MEDIUM' });
    await service.changePriority('t1', 'URGENT', { id: 'ag' });

    expect(sla.dueAt).not.toHaveBeenCalled();
    expect(tx.ticket.update.mock.calls[0][0].data.slaDueAt).toBeUndefined();
  });
});

describe('TicketsService.assign', () => {
  it('novo responsável → grava ASSIGNED {from,to} e chama notifier.assigned', async () => {
    const { service, notifier, events, tx } = makeService({ status: 'OPEN', assigneeId: null });
    await service.assign('t1', 'u-2', { id: 'ag' });

    expect(tx.ticket.update.mock.calls[0][0].data).toEqual({ assigneeId: 'u-2' });
    expect(events).toEqual([
      expect.objectContaining({ type: 'ASSIGNED', data: { from: null, to: 'u-2' }, actorId: 'ag' }),
    ]);
    expect(notifier.assigned).toHaveBeenCalledTimes(1);
  });

  it('desatribuição (null) → evento mas sem notificação', async () => {
    const { service, notifier, events } = makeService({ status: 'OPEN', assigneeId: 'u-1' });
    await service.assign('t1', null, { id: 'ag' });

    expect(events[0]).toMatchObject({ type: 'ASSIGNED', data: { from: 'u-1', to: null } });
    expect(notifier.assigned).not.toHaveBeenCalled();
  });
});
