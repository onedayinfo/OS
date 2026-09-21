import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TicketsService } from './tickets.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Cobre o boundary de visibilidade por
// papel (findAll monta o `where`, findOne valida pertinência) com dados de
// verdade. Sobe com `docker compose up -d postgres`. Sem banco no ar, o bloco
// pula com aviso (exit 0) — não quebra.
const PFX = `VIS-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;

// ids preenchidos no beforeAll
const id: Record<string, string> = {};

function svc() {
  return new TicketsService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { createForTicket: vi.fn().mockResolvedValue(null) } as any,
  );
}

const actorA = () => ({ id: id.A, type: 'CLIENT', role: 'CONTACT', clientId: id.X });
const actorMgrX = () => ({ id: id.MGR, type: 'CLIENT', role: 'MANAGER', clientId: id.X });
const actorAgent = () => ({ id: id.AGENT, type: 'INTERNAL', role: 'AGENT', clientId: null });

async function cleanup(p: PrismaClient) {
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('TicketsService — visibilidade por papel (Postgres real)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn(
        '[integration] DATABASE_URL ausente — pulando teste de visibilidade. ' +
          'Rode `docker compose up -d postgres`.',
      );
      return;
    }
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch (err) {
      console.warn(
        `[integration] Postgres indisponível (${(err as Error).message}) — ` +
          'pulando teste de visibilidade.',
      );
      await prisma.$disconnect().catch(() => {});
      prisma = undefined;
      return;
    }

    await cleanup(prisma);

    const X = await prisma.client.create({ data: { name: `${PFX} Cliente X` } });
    const Y = await prisma.client.create({ data: { name: `${PFX} Cliente Y` } });
    id.X = X.id;
    id.Y = Y.id;

    const mk = (name: string, role: any, type: any, clientId: string | null) =>
      prisma!.user.create({
        data: { name: `${PFX} ${name}`, email: `${name}@${EMAIL_DOMAIN}`, role, type, clientId },
      });
    id.A = (await mk('a', 'CONTACT', 'CLIENT', X.id)).id;
    id.B = (await mk('b', 'CONTACT', 'CLIENT', X.id)).id;
    id.MGR = (await mk('mgrx', 'MANAGER', 'CLIENT', X.id)).id;
    id.C = (await mk('c', 'CONTACT', 'CLIENT', Y.id)).id;
    id.AGENT = (await mk('agent', 'AGENT', 'INTERNAL', null)).id;

    const mkT = (n: number, clientId: string | null, requesterId: string | null, needsTriage = false) =>
      prisma!.ticket.create({
        data: {
          number: `${PFX}-${n}`,
          title: `t${n}`,
          description: 'x',
          origin: 'MANUAL',
          clientId,
          requesterId,
          needsTriage,
        },
      });
    id.T1 = (await mkT(1, X.id, id.A)).id;
    id.T2 = (await mkT(2, X.id, id.B)).id;
    id.T3 = (await mkT(3, Y.id, id.C)).id;
    id.T4 = (await mkT(4, null, null, true)).id;
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup(prisma).catch(() => {});
      await prisma.$disconnect();
    }
  });

  const ids = (r: { data: { id: string }[] }) => r.data.map((t) => t.id).sort();

  it('findAll como A (CONTACT) → só T1', async (ctx) => {
    if (!available) return ctx.skip();
    const r = await svc().findAll({ pageSize: 100 } as any, actorA());
    expect(ids(r)).toEqual([id.T1]);
  });

  it('findAll como ManagerX → T1 e T2 (não T3, não T4)', async (ctx) => {
    if (!available) return ctx.skip();
    const r = await svc().findAll({ pageSize: 100 } as any, actorMgrX());
    expect(ids(r)).toEqual([id.T1, id.T2].sort());
  });

  it('findAll como ManagerX com ?clientId=Y → ainda só T1/T2 (filtro não amplia)', async (ctx) => {
    if (!available) return ctx.skip();
    const r = await svc().findAll({ pageSize: 100, clientId: id.Y } as any, actorMgrX());
    expect(ids(r)).toEqual([id.T1, id.T2].sort());
  });

  it('findAll como AGENT → enxerga T1, T2, T3 e T4 (inclui triagem)', async (ctx) => {
    if (!available) return ctx.skip();
    const r = await svc().findAll({ pageSize: 1000 } as any, actorAgent());
    const got = new Set(r.data.map((t) => t.id));
    for (const k of ['T1', 'T2', 'T3', 'T4']) expect(got.has(id[k])).toBe(true);
  });

  it('findOne(T3) como A → NotFoundException', async (ctx) => {
    if (!available) return ctx.skip();
    await expect(svc().findOne(id.T3, actorA())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne(T4 triagem) como ManagerX → NotFoundException (regressão C1)', async (ctx) => {
    if (!available) return ctx.skip();
    await expect(svc().findOne(id.T4, actorMgrX())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne(T2) como A (CONTACT, mesmo cliente, outro requester) → NotFoundException', async (ctx) => {
    if (!available) return ctx.skip();
    await expect(svc().findOne(id.T2, actorA())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOne(T1) como A → ok (controle positivo)', async (ctx) => {
    if (!available) return ctx.skip();
    const t = await svc().findOne(id.T1, actorA());
    expect(t.id).toBe(id.T1);
  });
});
