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

  it('MANAGER sem clientId → escopo vazio (não casa clientId=null de triagem)', async () => {
    const { service, findMany } = makeService();
    await service.findAll({} as any, { id: 'u-mgr', type: 'CLIENT', role: 'MANAGER', clientId: null });
    const where = whereOf(findMany);
    expect(where.id).toBe('__no_access__');
    expect(where.clientId).toBeUndefined();
  });

  it('overdue + ?status=OPEN → combina em vez de sobrescrever', async () => {
    const { service, findMany } = makeService();
    await service.findAll({ overdue: true, status: 'OPEN' } as any, {
      id: 'a', type: 'INTERNAL', role: 'AGENT', clientId: null,
    });
    const where = whereOf(findMany);
    expect(where.status).toEqual({ equals: 'OPEN', notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] });
    expect(where.slaDueAt.lt).toBeInstanceOf(Date);
  });

  it('type=INTERNAL mas role=CONTACT (divergente) → escopo vazio (fail-closed)', async () => {
    const { service, findMany } = makeService();
    await service.findAll({} as any, { id: 'u', type: 'INTERNAL', role: 'CONTACT', clientId: null });
    expect(whereOf(findMany).id).toBe('__no_access__');
  });

  it('type=CLIENT mas role=AGENT (divergente) → tratado como CONTACT', async () => {
    const { service, findMany } = makeService();
    await service.findAll({} as any, { id: 'u-x', type: 'CLIENT', role: 'AGENT', clientId: 'cli' });
    expect(whereOf(findMany)).toMatchObject({ requesterId: 'u-x' });
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

  it('CLIENT dono → assignee/slaDueAt nulos e needsTriage false; AGENT vê assignee com nome', async () => {
    const withAssignee = () => ({
      ...fullTicket(),
      slaDueAt: new Date('2026-02-01T00:00:00Z'),
      needsTriage: true,
      assignee: { id: 'ag-1', name: 'Agente', email: 'ag@x.com', type: 'INTERNAL', role: 'AGENT', clientId: null, passwordHash: 'H' },
    });

    const asClient = await serviceWithTicket(withAssignee()).service.findOne('t1', {
      id: 'req-A', type: 'CLIENT', role: 'CONTACT', clientId: 'cli-X',
    });
    expect(asClient.assignee).toBeNull();
    expect(asClient.slaDueAt).toBeNull();
    expect(asClient.needsTriage).toBe(false);

    const asAgent = await serviceWithTicket(withAssignee()).service.findOne('t1', {
      id: 'ag', type: 'INTERNAL', role: 'AGENT', clientId: null,
    });
    expect(asAgent.assignee).toMatchObject({ name: 'Agente' });
    expect(asAgent.assignee).not.toHaveProperty('passwordHash');
    expect(asAgent.slaDueAt).toBeInstanceOf(Date);
  });

  it('CLIENT dono → sem comentários INTERNAL nem eventos internos, requester sem passwordHash', async () => {
    const { service } = serviceWithTicket(fullTicket());
    const res = await service.findOne('t1', {
      id: 'req-A', type: 'CLIENT', role: 'CONTACT', clientId: 'cli-X',
    });
    expect(res.comments.map((c: any) => c.id)).toEqual(['c1']);
    expect(res.events.map((e: any) => e.type)).toEqual(['CREATED', 'STATUS_CHANGED']);
    expect(res.requester).not.toHaveProperty('passwordHash');
  });

  it('CLIENT dono → nenhum evento COMMENT com visibility INTERNAL vaza na timeline', async () => {
    const t = fullTicket();
    t.events = [
      { id: 'e1', type: 'CREATED' },
      { id: 'e2', type: 'COMMENT', data: { visibility: 'INTERNAL' } } as any,
      { id: 'e3', type: 'COMMENT', data: { visibility: 'PUBLIC' } } as any,
      { id: 'e4', type: 'STATUS_CHANGED' },
    ];
    const { service } = serviceWithTicket(t);
    const res = await service.findOne('t1', {
      id: 'req-A', type: 'CLIENT', role: 'CONTACT', clientId: 'cli-X',
    });
    expect(res.events.some((e: any) => e.data?.visibility === 'INTERNAL')).toBe(false);
    expect(res.events.map((e: any) => e.type)).toEqual(['CREATED', 'STATUS_CHANGED']);
  });

  it('AGENT interno → vê tudo', async () => {
    const { service } = serviceWithTicket(fullTicket());
    const res = await service.findOne('t1', {
      id: 'ag', type: 'INTERNAL', role: 'AGENT', clientId: null,
    });
    expect(res.comments).toHaveLength(2);
    expect(res.events).toHaveLength(5);
  });

  it('MANAGER sem clientId → NotFoundException mesmo em chamado de triagem (clientId=null)', async () => {
    const triage = { ...fullTicket(), clientId: null };
    const { service } = serviceWithTicket(triage);
    await expect(
      service.findOne('t1', { id: 'mgr', type: 'CLIENT', role: 'MANAGER', clientId: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('MANAGER de outro cliente → NotFoundException (não compara null===null)', async () => {
    const { service } = serviceWithTicket(fullTicket()); // clientId cli-X
    await expect(
      service.findOne('t1', { id: 'mgr', type: 'CLIENT', role: 'MANAGER', clientId: 'cli-Y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne → assets vêm por `select` de campos seguros (sem credentialsEnc)', async () => {
    // `include` na relação `assets` devolveria TODO scalar de Asset — inclusive
    // `credentialsEnc`, que `findOne` espalharia no retorno (serve o lado cliente).
    // Prova a correção pelo argumento passado ao Prisma: mock não honra `select`.
    const t = fullTicket();
    (t as any).assets = [{ id: 'as1', label: 'CAM-01', type: { id: 'ty1', name: 'Câmera' } }];
    const { service, findUnique } = serviceWithTicket(t);
    await service.findOne('t1', { id: 'ag', type: 'INTERNAL', role: 'AGENT', clientId: null });

    const assetsArg = findUnique.mock.calls[0][0].include.assets;
    expect(assetsArg.include).toBeUndefined();
    expect(assetsArg.select).toBeDefined();
    expect(assetsArg.select).not.toHaveProperty('credentialsEnc');
    expect(assetsArg.select.id).toBe(true);
    expect(assetsArg.select.label).toBe(true);
    expect(assetsArg.select.type).toEqual({ select: { id: true, name: true } });
  });

  it('findOne → anexos allowlistados: sem storedPath/uploadedById, com id/filename/mime/size (ticket e comentário, viewer AGENT)', async () => {
    const raw = {
      id: 'att-t',
      filename: 'nota.pdf',
      mime: 'application/pdf',
      size: 123,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ticketId: 't1',
      commentId: null,
      storedPath: '/abs/uploads/segredo.pdf',
      uploadedById: 'u-secret',
    };
    const t = fullTicket();
    (t as any).attachments = [raw];
    t.comments = [
      {
        id: 'c1',
        visibility: 'PUBLIC',
        body: 'oi',
        attachments: [{ ...raw, id: 'att-c', ticketId: null, commentId: 'c1' }],
      },
    ] as any;
    const { service } = serviceWithTicket(t);
    const res = await service.findOne('t1', {
      id: 'ag', type: 'INTERNAL', role: 'AGENT', clientId: null,
    });
    for (const a of [res.attachments[0], (res.comments[0] as any).attachments[0]]) {
      expect(a).not.toHaveProperty('storedPath');
      expect(a).not.toHaveProperty('uploadedById');
      expect(a).toMatchObject({
        id: expect.any(String),
        filename: 'nota.pdf',
        mime: 'application/pdf',
        size: 123,
      });
    }
  });
});
