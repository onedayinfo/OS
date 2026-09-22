import { BadRequestException } from '@nestjs/common';
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
    { resolveForTicket: vi.fn().mockResolvedValue(null) } as any,
    { createForTicket: vi.fn().mockResolvedValue(null) } as any,
  );
  return { service, sla, notifier, events, tx };
}

describe('TicketsService.changePriority', () => {
  it('MEDIUM→URGENT em ticket ativo recalcula slaDueAt para createdAt + 4h', async () => {
    const { service, sla, tx, events } = makeService({
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      slaPausedMs: 0,
    });
    await service.changePriority('t1', 'URGENT', { id: 'ag' });

    expect(sla.dueAt).toHaveBeenCalledWith('URGENT', CREATED_AT, undefined, undefined);
    const data = tx.ticket.update.mock.calls[0][0].data;
    expect(data.priority).toBe('URGENT');
    expect((data.slaDueAt as Date).getTime()).toBe(CREATED_AT.getTime() + 4 * HOUR);
    expect(events).toEqual([
      expect.objectContaining({ type: 'PRIORITY_CHANGED', data: { from: 'MEDIUM', to: 'URGENT' } }),
    ]);
  });

  it('passa contractId e categoryId do ticket pro SlaService.dueAt', async () => {
    const { service, sla } = makeService({
      status: 'OPEN',
      priority: 'MEDIUM',
      slaPausedMs: 0,
      contractId: 'c1',
      categoryId: 'cat1',
    });
    await service.changePriority('t1', 'URGENT', { id: 'ag' });
    expect(sla.dueAt).toHaveBeenCalledWith('URGENT', CREATED_AT, 'c1', 'cat1');
  });

  it('soma slaPausedMs acumulado de volta ao novo prazo', async () => {
    const { service, tx } = makeService({
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      slaPausedMs: 2 * HOUR,
    });
    await service.changePriority('t1', 'URGENT', { id: 'ag' });
    const data = tx.ticket.update.mock.calls[0][0].data;
    expect((data.slaDueAt as Date).getTime()).toBe(CREATED_AT.getTime() + 4 * HOUR + 2 * HOUR);
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

describe('TicketsService.triage', () => {
  function makeTriage(over: {
    ticket?: any;
    client?: any;
    requester?: any;
  } = {}) {
    const comments: any[] = [];
    const events: any[] = [];
    const tx = {
      ticket: {
        update: vi.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 't1', number: '2026-0001', ...data }),
        ),
      },
      ticketComment: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          comments.push(data);
          return Promise.resolve({ id: 'c1', ...data });
        }),
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
        findUnique: vi.fn().mockResolvedValue(
          over.ticket ?? { id: 't1', number: '2026-0001', needsTriage: true },
        ),
      },
      client: {
        findUnique: vi.fn().mockResolvedValue(over.client ?? { id: 'cli1', name: 'ACME' }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(
          over.requester ?? { id: 'r1', type: 'CLIENT', clientId: 'cli1' },
        ),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    };
    const service = new TicketsService(
      prisma as any,
      {} as any,
      {} as any,
      new TicketEventsService(),
      new TicketStatusService(),
      {} as any,
      { resolveForTicket: vi.fn().mockResolvedValue(null) } as any,
      { createForTicket: vi.fn().mockResolvedValue(null) } as any,
    );
    return { service, prisma, tx, comments, events };
  }

  const actor = { id: 'ag1', type: 'INTERNAL', role: 'AGENT', clientId: null };

  it('ticket sem needsTriage → BadRequestException', async () => {
    const { service } = makeTriage({
      ticket: { id: 't1', number: '2026-0001', needsTriage: false },
    });
    await expect(
      service.triage('t1', { clientId: 'cli1', requesterId: 'r1' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cliente inativo → BadRequestException', async () => {
    const { service } = makeTriage({ client: { id: 'cli1', name: 'ACME', active: false } });
    await expect(
      service.triage('t1', { clientId: 'cli1', requesterId: 'r1' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solicitante inativo → BadRequestException', async () => {
    const { service } = makeTriage({
      requester: { id: 'r1', type: 'CLIENT', clientId: 'cli1', active: false },
    });
    await expect(
      service.triage('t1', { clientId: 'cli1', requesterId: 'r1' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requesterId de outro cliente → BadRequestException', async () => {
    const { service } = makeTriage({
      requester: { id: 'r1', type: 'CLIENT', clientId: 'OUTRO' },
    });
    await expect(
      service.triage('t1', { clientId: 'cli1', requesterId: 'r1' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('triagem válida → vincula, baixa needsTriage e grava comentário INTERNAL', async () => {
    const { service, tx, comments } = makeTriage();
    const updated = await service.triage('t1', { clientId: 'cli1', requesterId: 'r1' }, actor);

    expect(tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: { clientId: 'cli1', requesterId: 'r1', needsTriage: false },
      }),
    );
    expect(updated.needsTriage).toBe(false);
    expect(comments).toEqual([
      expect.objectContaining({
        ticketId: 't1',
        authorId: 'ag1',
        visibility: 'INTERNAL',
        body: 'Chamado vinculado ao cliente ACME.',
      }),
    ]);
  });
});
