import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AssetsController } from '../assets/assets.controller.js';
import { AssetsService } from '../assets/assets.service.js';
import { AssetsImportService } from '../assets/assets-import.service.js';
import { IS_PUBLIC_KEY } from '../common/public.decorator.js';
import { RolesGuard } from '../common/roles.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentCodeService } from './agent-code.service.js';
import { AgentDevicesController } from './agent-devices.controller.js';
import { AgentDevicesService } from './agent-devices.service.js';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';
import { ClientAgentController } from './client-agent.controller.js';
import { ContractGate } from './contract-gate.service.js';

// Teste de INTEGRAÇÃO: Postgres real (`docker compose up -d postgres`). Sem
// DATABASE_URL / banco no ar, o bloco pula com aviso (exit 0).
const PFX = `AGT-${Date.now()}`;

let prisma: PrismaClient | undefined;
let available = false;
let app: INestApplication | undefined;

const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  const clients = { client: { name: { startsWith: PFX } } };
  await p.agentDevice.deleteMany({ where: clients });
  await p.asset.deleteMany({
    where: { OR: [{ label: { startsWith: PFX } }, { client: { name: { startsWith: PFX } } }] },
  });
  await p.contract.deleteMany({ where: clients });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.assetType.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

const http = () => request(app!.getHttpServer());
const admin = (r: request.Test) => r.set('x-test-role', 'ADMIN');
const WRONG = '0'.repeat(32);

describe('Agente — integração enroll→aprovar→checkin (Postgres real)', () => {
  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
    if (!process.env.DATABASE_URL) {
      console.warn('[integration] DATABASE_URL ausente — pulando integração do agente.');
      return;
    }
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch (err) {
      console.warn(`[integration] Postgres indisponível (${(err as Error).message}).`);
      await prisma.$disconnect().catch(() => {});
      prisma = undefined;
      return;
    }
    await cleanup(prisma);

    const c = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    id.c = c.id;
    id.loc = (await prisma.location.create({ data: { clientId: c.id, name: `${PFX} Matriz` } })).id;
    id.type = (await prisma.assetType.create({ data: { name: `${PFX} Notebook` } })).id;
    id.contract = (
      await prisma.contract.create({
        data: {
          clientId: c.id,
          name: `${PFX} Contrato`,
          status: 'ACTIVE',
          startDate: new Date(Date.now() - 86400e3),
          endDate: new Date(Date.now() + 365 * 86400e3),
          franchiseUnit: 'VISITS',
          franchiseAmount: 1,
        },
      })
    ).id;

    const moduleRef = await Test.createTestingModule({
      controllers: [AgentController, AgentDevicesController, ClientAgentController, AssetsController],
      providers: [
        AssetsService, AssetsImportService, ContractGate, AgentCodeService, AgentService, AgentDevicesService,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        {
          // substitui o JwtAuthGuard: rotas @Public passam; as demais exigem x-test-role.
          provide: APP_GUARD,
          useFactory: (reflector: Reflector) => ({
            canActivate: (c: any) => {
              if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [c.getHandler(), c.getClass()])) return true;
              const req = c.switchToHttp().getRequest();
              const role = req.headers['x-test-role'];
              if (!role) return false;
              req.user = { id: 'tester', role, type: 'INTERNAL', clientId: null };
              return true;
            },
          }),
          inject: [Reflector],
        },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await cleanup(prisma).catch(() => {});
      await prisma.$disconnect();
    }
  });

  const info = (over: object = {}) => ({
    machineGuid: 'guid-1', hostname: 'PC-01', serialNumber: 'SER-AAA', manufacturer: 'Dell', model: 'Latitude',
    ip: '10.0.0.5', mac: 'AA:BB:CC:DD:EE:01', agentVersion: '1.0.0', ...over,
  });
  const checkin = (token: string, body: object) =>
    http().post('/agent/checkin').set('Authorization', `Bearer ${token}`).send(body);

  it('fluxo completo: código → enroll → checkin → aprovar → checkin → contrato cancelado', async (ctx) => {
    if (!available) return ctx.skip();

    const reg = await admin(http().post(`/clients/${id.c}/agent/code`)).expect(201);
    id.code = reg.body.code;
    expect(id.code).toMatch(/^[0-9a-f]{32}$/);

    const en = await http().post('/agent/enroll').send({ code: id.code, ...info() }).expect(200);
    expect(en.body.status).toBe('PENDING');
    id.token = en.body.token;

    const ck = await checkin(id.token, {
      hostname: 'PC-01', ip: '10.0.0.5', agentVersion: '1.0.0',
      inventory: { specs: { cpu: 'i7', ramGb: 16 }, software: [{ name: 'Chrome', version: '120' }] },
    }).expect(200);
    expect(ck.body.status).toBe('PENDING');

    const list = await admin(http().get(`/agent-devices?clientId=${id.c}&status=PENDING`)).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].status).toBe('PENDING');
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    id.dev = list.body.data[0].id;

    const one = await admin(http().get(`/agent-devices/${id.dev}`)).expect(200);
    expect(one.body.specs).toEqual({ cpu: 'i7', ramGb: 16 });
    expect(one.body.software).toHaveLength(1);
    expect(JSON.stringify(one.body)).not.toContain('tokenHash');

    const body = { locationId: id.loc, typeId: id.type, label: `${PFX} Notebook do João`, assignedTo: 'João' };
    const ap = await admin(http().post(`/agent-devices/${id.dev}/approve`)).send(body).expect(200);
    id.asset = ap.body.id;

    // segundo approve: 409 e nenhum ativo extra
    await admin(http().post(`/agent-devices/${id.dev}/approve`)).send(body).expect(409);
    expect(await prisma!.asset.count({ where: { clientId: id.c } })).toBe(1);

    const a1 = await admin(http().get(`/assets/${id.asset}`)).expect(200);
    expect(a1.body).not.toHaveProperty('credentialsEnc');
    expect(a1.body.lastSeenAt).toBeTruthy();
    expect(a1.body.specs).toEqual({ cpu: 'i7', ramGb: 16 });
    expect(a1.body.assignedTo).toBe('João');
    expect(a1.body.label).toBe(`${PFX} Notebook do João`);
    expect(a1.body.ip).toBe('10.0.0.5');

    // novo checkin: ip muda, label/assignedTo não
    const ck2 = await checkin(id.token, { hostname: 'RENOMEADO', ip: '10.0.0.99' }).expect(200);
    expect(ck2.body.status).toBe('LINKED');
    const a2 = await admin(http().get(`/assets/${id.asset}`)).expect(200);
    expect(a2.body.ip).toBe('10.0.0.99');
    expect(a2.body.label).toBe(`${PFX} Notebook do João`);
    expect(a2.body.assignedTo).toBe('João');
    expect(a2.body.specs).toEqual({ cpu: 'i7', ramGb: 16 }); // sem inventário → specs preservadas

    // contrato cancelado → 403
    await prisma!.contract.update({ where: { id: id.contract }, data: { status: 'CANCELLED' } });
    await checkin(id.token, { hostname: 'PC-01' }).expect(403);
    await http().post('/agent/enroll').send({ code: id.code, ...info({ machineGuid: 'guid-x' }) }).expect(403);
  });

  it('enroll com código errado e com código revogado → 401 com a mesma mensagem', async (ctx) => {
    if (!available) return ctx.skip();
    const wrong = await http().post('/agent/enroll').send({ code: WRONG, ...info() }).expect(401);
    const old = id.code;
    await admin(http().post(`/clients/${id.c}/agent/code`)).expect(201); // revoga o antigo
    const revoked = await http().post('/agent/enroll').send({ code: old, ...info() }).expect(401);
    expect(revoked.body.message).toBe(wrong.body.message);
  });

  it('mesmo machineGuid com seriais válidos diferentes → segundo é cloneSuspect', async (ctx) => {
    if (!available) return ctx.skip();
    await prisma!.contract.update({ where: { id: id.contract }, data: { status: 'ACTIVE' } });
    const { body } = await admin(http().post(`/clients/${id.c}/agent/code`)).expect(201);
    const mk = (serial: string) =>
      http().post('/agent/enroll').send({ code: body.code, ...info({ machineGuid: 'guid-clone', serialNumber: serial }) }).expect(200);
    await mk('SER-C1');
    await mk('SER-C2');
    const rows = await prisma!.agentDevice.findMany({
      where: { clientId: id.c, machineGuid: 'guid-clone' },
      orderBy: { serialKey: 'asc' },
    });
    expect(rows.map((r) => [r.serialKey, r.cloneSuspect])).toEqual([['SER-C1', false], ['SER-C2', true]]);
  });
  it('rotas de gestão: sem autenticação → 403; papel fora de ADMIN/AGENT → 403 e nada muda', async (ctx) => {
    if (!available) return ctx.skip();
    // o stub de guard nega (403) quando falta x-test-role
    await http().get('/agent-devices').expect(403);
    await http().post(`/clients/${id.c}/agent/code`).expect(403);
    for (const role of ['CONTACT', 'MANAGER']) {
      await http().get('/agent-devices').set('x-test-role', role).expect(403);
      await http().get(`/clients/${id.c}/agent`).set('x-test-role', role).expect(403);
      await http().post(`/clients/${id.c}/agent/code`).set('x-test-role', role).expect(403);
    }
    const dev = await prisma!.agentDevice.findFirstOrThrow({ where: { clientId: id.c, status: 'PENDING' } });
    const body = { locationId: id.loc, typeId: id.type, label: `${PFX} Nao-deve-criar` };
    await http().post(`/agent-devices/${dev.id}/approve`).set('x-test-role', 'CONTACT').send(body).expect(403);
    expect((await prisma!.agentDevice.findUniqueOrThrow({ where: { id: dev.id } })).status).toBe('PENDING');
    expect(await prisma!.asset.count({ where: { label: { startsWith: `${PFX} Nao` } } })).toBe(0);
  });
});
