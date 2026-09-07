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
