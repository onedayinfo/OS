import { NotFoundException } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';

function makeService() {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const prisma = { ticket: { findMany, count } };
  const service = new TicketsService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, findMany, count };
}

const whereOf = (findMany: any) => findMany.mock.calls[0][0].where;

describe('TicketsService.findAll — escopo por papel', () => {
  it('CONTACT → where.requesterId = actor.id', async () => {
    const { service, findMany } = makeService();
    await service.findAll({} as any, { id: 'u-contact', type: 'CLIENT', role: 'CONTACT', clientId: 'x' });
    expect(whereOf(findMany)).toMatchObject({ requesterId: 'u-contact' });
    expect(whereOf(findMany).clientId).toBeUndefined();
  });

  it('MANAGER → where.clientId = actor.clientId', async () => {
    const { service, findMany } = makeService();
    await service.findAll({} as any, { id: 'u-mgr', type: 'CLIENT', role: 'MANAGER', clientId: 'cli-x' });
    expect(whereOf(findMany)).toMatchObject({ clientId: 'cli-x' });
    expect(whereOf(findMany).requesterId).toBeUndefined();
  });

  it('AGENT (INTERNAL) → sem requesterId/clientId de escopo', async () => {
    const { service, findMany } = makeService();
    await service.findAll({} as any, { id: 'u-agent', type: 'INTERNAL', role: 'AGENT', clientId: null });
    const where = whereOf(findMany);
    expect(where.requesterId).toBeUndefined();
    expect(where.clientId).toBeUndefined();
  });

  it('overdue=true → slaDueAt < now e status não terminal', async () => {
    const { service, findMany } = makeService();
    await service.findAll({ overdue: true } as any, { id: 'a', type: 'INTERNAL', role: 'AGENT', clientId: null });
    const where = whereOf(findMany);
    expect(where.slaDueAt.lt).toBeInstanceOf(Date);
    expect(where.status.notIn).toEqual(['RESOLVED', 'CLOSED', 'CANCELLED']);
  });

  it('q → OR em number/title, insensitive', async () => {
    const { service, findMany } = makeService();
    await service.findAll({ q: 'abc' } as any, { id: 'a', type: 'INTERNAL', role: 'AGENT', clientId: null });
    expect(whereOf(findMany).OR).toEqual([
      { number: { contains: 'abc', mode: 'insensitive' } },
      { title: { contains: 'abc', mode: 'insensitive' } },
    ]);
  });

  it('retorna { data, total, page, pageSize } e ordena por createdAt desc', async () => {
    const { service, findMany } = makeService();
    const res = await service.findAll({ page: 2, pageSize: 5 } as any, {
      id: 'a', type: 'INTERNAL', role: 'AGENT', clientId: null,
    });
    expect(res).toEqual({ data: [], total: 0, page: 2, pageSize: 5 });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 5,
    });
  });
});

function serviceWithTicket(ticket: any) {
  const findUnique = vi.fn().mockResolvedValue(ticket);
  const prisma = { ticket: { findUnique } };
  const service = new TicketsService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, findUnique };
}

const fullTicket = () => ({
  id: 't1',
  requesterId: 'req-A',
  clientId: 'cli-X',
  requester: { id: 'req-A', name: 'A', email: 'a@x.com', type: 'CLIENT', role: 'CONTACT', clientId: 'cli-X', passwordHash: 'H' },
  assignee: null,
  client: {},
  category: null,
  comments: [
    { id: 'c1', visibility: 'PUBLIC', body: 'oi' },
    { id: 'c2', visibility: 'INTERNAL', body: 'nota interna' },
  ],
  events: [
    { id: 'e1', type: 'CREATED' },
    { id: 'e2', type: 'ASSIGNED' },
    { id: 'e3', type: 'PRIORITY_CHANGED' },
    { id: 'e4', type: 'STATUS_CHANGED' },
    { id: 'e5', type: 'COMMENT' },
  ],
});

describe('TicketsService.findOne — guarda de acesso', () => {
  it('CONTACT de outro cliente → NotFoundException', async () => {
    const { service } = serviceWithTicket(fullTicket());
    await expect(
      service.findOne('t1', { id: 'outro', type: 'CLIENT', role: 'CONTACT', clientId: 'cli-Y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('id inexistente → NotFoundException', async () => {
    const { service } = serviceWithTicket(null);
    await expect(
      service.findOne('nope', { id: 'a', type: 'INTERNAL', role: 'AGENT', clientId: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CLIENT dono → sem comentários INTERNAL nem eventos internos, requester sem passwordHash', async () => {
    const { service } = serviceWithTicket(fullTicket());
    const res = await service.findOne('t1', {
      id: 'req-A', type: 'CLIENT', role: 'CONTACT', clientId: 'cli-X',
    });
    expect(res.comments.map((c: any) => c.id)).toEqual(['c1']);
    expect(res.events.map((e: any) => e.type)).toEqual(['CREATED', 'STATUS_CHANGED', 'COMMENT']);
    expect(res.requester).not.toHaveProperty('passwordHash');
  });

  it('AGENT interno → vê tudo', async () => {
    const { service } = serviceWithTicket(fullTicket());
    const res = await service.findOne('t1', {
      id: 'ag', type: 'INTERNAL', role: 'AGENT', clientId: null,
    });
    expect(res.comments).toHaveLength(2);
    expect(res.events).toHaveLength(5);
  });
});
