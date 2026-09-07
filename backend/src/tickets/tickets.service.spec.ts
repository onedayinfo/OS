import { BadRequestException } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';
import { TicketNumberService } from './ticket-number.service.js';
import { TicketEventsService } from './ticket-events.service.js';
import { TicketStatusService } from './ticket-status.service.js';

const HOUR = 3600_000;

function makeDeps() {
  const events: any[] = [];
  const tx = {
    counter: { upsert: vi.fn().mockResolvedValue({ value: 1 }) },
    ticket: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 't1', createdAt: new Date(), ...data }),
      ),
    },
    ticketEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        events.push(data);
        return Promise.resolve({ id: `e${events.length}`, ...data });
      }),
    },
  };
  const prisma = { $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)) };
  const sla = {
    // MEDIUM = 24h
    dueAt: vi.fn().mockImplementation((_p: string, from: Date) =>
      Promise.resolve(new Date(from.getTime() + 24 * HOUR)),
    ),
  };
  const notifier = {
    created: vi.fn().mockResolvedValue(undefined),
    resolved: vi.fn().mockResolvedValue(undefined),
    assigned: vi.fn().mockResolvedValue(undefined),
  };
  const service = new TicketsService(
    prisma as any,
    new TicketNumberService(),
    sla as any,
    new TicketEventsService(),
    new TicketStatusService(),
    notifier as any,
  );
  return { service, prisma, sla, notifier, events };
}

describe('TicketsService.create', () => {
  it('origin=MANUAL sem clientId → BadRequestException', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ title: 't', description: 'd', origin: 'MANUAL' } as any, { id: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('criação válida: number formatado, slaDueAt +24h, 1 evento CREATED, notifier.created 1x', async () => {
    const { service, sla, notifier, events } = makeDeps();
    const before = Date.now();
    const ticket = await service.create(
      { title: 't', description: 'd', clientId: 'c1', requesterId: 'r1', origin: 'MANUAL' },
      { id: 'u1' },
    );

    expect(ticket.number).toMatch(/^\d{4}-\d{4}$/);
    expect(sla.dueAt).toHaveBeenCalledWith('MEDIUM', expect.any(Date));
    expect(ticket.slaDueAt.getTime()).toBeGreaterThanOrEqual(before + 24 * HOUR - 1000);
    expect(ticket.slaDueAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * HOUR + 1000);

    const created = events.filter((e) => e.type === 'CREATED');
    expect(created).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(created[0].actorId).toBe('u1');

    expect(notifier.created).toHaveBeenCalledTimes(1);
  });
});
