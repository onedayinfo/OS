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
  const prisma = {
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'r1', type: 'CLIENT', active: true, clientId: 'c1' }),
    },
  };
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

  it('ator interno: origin do body é ignorado, chamado nasce MANUAL', async () => {
    const { service } = makeDeps();
    const ticket = await service.create(
      { title: 't', description: 'd', clientId: 'c1', requesterId: 'r1', origin: 'EMAIL' } as any,
      { id: 'u1', type: 'INTERNAL', role: 'AGENT', clientId: null },
    );
    expect(ticket.origin).toBe('MANUAL');
  });

  it('ator interno: requesterId de outro cliente → BadRequestException', async () => {
    const { service, prisma } = makeDeps();
    prisma.user.findUnique.mockResolvedValue({
      id: 'r1', type: 'CLIENT', active: true, clientId: 'OUTRO',
    });
    await expect(
      service.create(
        { title: 't', description: 'd', clientId: 'c1', requesterId: 'r1', origin: 'MANUAL' },
        { id: 'u1', type: 'INTERNAL', role: 'AGENT', clientId: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('inbound (sem actor): mantém origin=EMAIL e não valida requester ∈ client', async () => {
    const { service, prisma } = makeDeps();
    const ticket = await service.create({
      title: 't', description: 'd', clientId: null, requesterId: null, origin: 'EMAIL',
    });
    expect(ticket.origin).toBe('EMAIL');
    expect(ticket.needsTriage).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('actor CLIENT: origin=PORTAL, clientId/requesterId derivados do token', async () => {
    const { service } = makeDeps();
    const ticket = await service.create({ title: 't', description: 'd' } as any, {
      id: 'contact-1',
      type: 'CLIENT',
      role: 'CONTACT',
      clientId: 'client-9',
    });
    expect(ticket.origin).toBe('PORTAL');
    expect(ticket.clientId).toBe('client-9');
    expect(ticket.requesterId).toBe('contact-1');
  });

  it('actor CLIENT: clientId/requesterId do body são ignorados (o do token vence)', async () => {
    const { service } = makeDeps();
    const ticket = await service.create(
      {
        title: 't',
        description: 'd',
        clientId: 'outro-cliente',
        requesterId: 'outro-solicitante',
        origin: 'MANUAL',
      } as any,
      { id: 'contact-1', type: 'CLIENT', role: 'CONTACT', clientId: 'client-9' },
    );
    expect(ticket.clientId).toBe('client-9');
    expect(ticket.requesterId).toBe('contact-1');
    expect(ticket.origin).toBe('PORTAL');
  });

  it('actor CLIENT sem clientId no token → BadRequestException', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ title: 't', description: 'd' } as any, {
        id: 'contact-1',
        type: 'CLIENT',
        role: 'CONTACT',
        clientId: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
