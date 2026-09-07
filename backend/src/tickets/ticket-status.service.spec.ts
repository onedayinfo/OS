import { TicketsService } from './tickets.service.js';
import { TicketEventsService } from './ticket-events.service.js';
import { TicketStatusService, resolveClientReply } from './ticket-status.service.js';

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
    ticket: { findUnique: vi.fn().mockResolvedValue({ id: 't1', number: '2026-0001', ...current }) },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
  };
  const notifier = { created: vi.fn(), resolved: vi.fn().mockResolvedValue(undefined), assigned: vi.fn() };
  const service = new TicketsService(
    prisma as any,
    {} as any,
    {} as any,
    new TicketEventsService(),
    new TicketStatusService(),
    notifier as any,
  );
  return { service, notifier, events, tx };
}

describe('TicketsService.changeStatus', () => {
  it('OPEN→RESOLVED grava resolvedAt e chama notifier.resolved', async () => {
    const { service, notifier, events, tx } = makeService({ status: 'OPEN', resolvedAt: null });
    const res = await service.changeStatus('t1', 'RESOLVED', { id: 'ag' });

    expect(tx.ticket.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
    expect(res.status).toBe('RESOLVED');
    expect(notifier.resolved).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({ type: 'STATUS_CHANGED', data: { from: 'OPEN', to: 'RESOLVED' }, actorId: 'ag' }),
    ]);
  });

  it('RESOLVED→IN_PROGRESS → permitido (RESOLVED não é terminal, spec §5.2)', async () => {
    const { service, events } = makeService({ status: 'RESOLVED', resolvedAt: new Date() });
    const res = await service.changeStatus('t1', 'IN_PROGRESS', { id: 'ag' });
    expect(res.status).toBe('IN_PROGRESS');
    expect(events).toEqual([
      expect.objectContaining({ type: 'STATUS_CHANGED', data: { from: 'RESOLVED', to: 'IN_PROGRESS' } }),
    ]);
  });

  it('RESOLVED→CLOSED → seta closedAt, preserva resolvedAt, evento {RESOLVED→CLOSED}', async () => {
    const resolvedAt = new Date('2026-09-01T00:00:00Z');
    const { service, events, tx } = makeService({ status: 'RESOLVED', resolvedAt });
    const res = await service.changeStatus('t1', 'CLOSED', { id: 'ag' });

    const data = tx.ticket.update.mock.calls[0][0].data;
    expect(data.closedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('resolvedAt'); // não é tocado → preservado
    expect(res.status).toBe('CLOSED');
    expect(res.resolvedAt).toEqual(resolvedAt);
    expect(events).toEqual([
      expect.objectContaining({ type: 'STATUS_CHANGED', data: { from: 'RESOLVED', to: 'CLOSED' }, actorId: 'ag' }),
    ]);
  });

  it('RESOLVED→OPEN limpa resolvedAt/closedAt', async () => {
    const { service, tx } = makeService({ status: 'RESOLVED', resolvedAt: new Date() });
    await service.changeStatus('t1', 'OPEN', { id: 'ag' });
    const data = tx.ticket.update.mock.calls[0][0].data;
    expect(data.resolvedAt).toBeNull();
    expect(data.closedAt).toBeNull();
  });
});

describe('resolveClientReply', () => {
  it('em ticket WAITING_CLIENT → vira IN_PROGRESS + evento', async () => {
    const created: any[] = [];
    const client = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue({ status: 'WAITING_CLIENT' }),
        update: vi.fn().mockResolvedValue({}),
      },
      ticketEvent: { create: vi.fn().mockImplementation(({ data }: any) => created.push(data)) },
    };
    await resolveClientReply(client as any, 't1');
    expect(client.ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'IN_PROGRESS' },
    });
    expect(created[0]).toMatchObject({ type: 'STATUS_CHANGED', data: { from: 'WAITING_CLIENT', to: 'IN_PROGRESS' } });
  });

  it('em ticket OPEN → no-op', async () => {
    const client = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue({ status: 'OPEN' }),
        update: vi.fn(),
      },
      ticketEvent: { create: vi.fn() },
    };
    await resolveClientReply(client as any, 't1');
    expect(client.ticket.update).not.toHaveBeenCalled();
  });
});
