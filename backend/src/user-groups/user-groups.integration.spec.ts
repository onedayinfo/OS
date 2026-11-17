import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { RolesGuard } from '../common/roles.guard.js';
import { ScreenGuard } from '../common/screen.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientsController } from '../clients/clients.controller.js';
import { ClientsService } from '../clients/clients.service.js';
import { OpportunitiesController } from '../crm/opportunities.controller.js';
import { OpportunitiesService } from '../crm/opportunities.service.js';
import { DashboardController } from '../dashboard/dashboard.controller.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { BackupController } from '../backup/backup.controller.js';
import { BackupService } from '../backup/backup.service.js';
import { SettingsController } from '../settings/settings.controller.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { UsersController } from '../users/users.controller.js';
import { UsersService } from '../users/users.service.js';
import { UserGroupsController } from './user-groups.controller.js';
import { UserGroupsService } from './user-groups.service.js';
import { SCREENS } from './screens.js';

// Teste de INTEGRAÇÃO: Postgres real. Controllers, RolesGuard e ScreenGuard reais;
// só o JwtAuthGuard é trocado por um stub que lê o usuário do header `x-test-user`.
// Sem DATABASE_URL / banco no ar, pula com aviso.
const PFX = `UGR-${Date.now()}`;
const EMAIL = `@${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
let app: INestApplication | undefined;
const id: Record<string, string> = {};
const backupMock = { export: vi.fn(async () => ({})), import: vi.fn(async () => {}) };
const settingsMock = { set: vi.fn(async () => {}), describe: vi.fn(async () => ({})) };

async function cleanup(p: PrismaClient) {
  await p.user.deleteMany({ where: { email: { endsWith: EMAIL } } });
  await p.userGroup.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Grupos de permissão — integração (Postgres real)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('[integration] DATABASE_URL ausente — pulando integração de grupos.');
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

    id.g = (
      await prisma.userGroup.create({
        data: {
          name: `${PFX} Quase admin`,
          screens: SCREENS.filter((s) => s !== 'crm' && s !== 'clientes'),
        },
      })
    ).id;
    // Grupo sem `config`, para o caso "sem tela de configurações".
    id.gNoCfg = (
      await prisma.userGroup.create({
        data: { name: `${PFX} Sem config`, screens: SCREENS.filter((s) => s !== 'config') },
      })
    ).id;
    id.u0 = (
      await prisma.user.create({
        data: { name: 'u0', email: `u0${EMAIL}`, role: 'ADMIN', type: 'INTERNAL', passwordHash: 'x' },
      })
    ).id;
    id.u1 = (
      await prisma.user.create({
        data: {
          name: 'u1',
          email: `u1${EMAIL}`,
          role: 'ADMIN',
          type: 'INTERNAL',
          passwordHash: 'x',
          groupId: id.g,
        },
      })
    ).id;
    id.u2 = (
      await prisma.user.create({
        data: {
          name: 'u2',
          email: `u2${EMAIL}`,
          role: 'ADMIN',
          type: 'INTERNAL',
          passwordHash: 'x',
          groupId: id.gNoCfg,
        },
      })
    ).id;
    id.client = (await prisma.client.create({ data: { name: `${PFX} Cliente` } })).id;

    const moduleRef = await Test.createTestingModule({
      controllers: [
        OpportunitiesController,
        ClientsController,
        DashboardController,
        UsersController,
        UserGroupsController,
        BackupController,
        SettingsController,
      ],
      providers: [
        OpportunitiesService,
        ClientsService,
        UsersService,
        UserGroupsService,
        Reflector,
        { provide: BackupService, useValue: backupMock },
        { provide: StorageService, useValue: { list: async () => [] } },
        { provide: SettingsService, useValue: settingsMock },
        { provide: PrismaService, useValue: prisma },
        { provide: 'MailSender', useValue: { sendInvite: async () => {} } },
        { provide: DashboardService, useValue: { overview: async () => ({ ok: true }) } },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (c: any) => {
              const req = c.switchToHttp().getRequest();
              const uid = req.headers['x-test-user'];
              if (!uid) return false;
              req.user = { id: uid, role: 'ADMIN', type: 'INTERNAL', clientId: null };
              return true;
            },
          },
        },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: ScreenGuard },
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

  const http = () => request(app!.getHttpServer());
  const as = (r: request.Test, who: 'u0' | 'u1') => r.set('x-test-user', id[who]);

  it('u1 (sem crm) → GET /opportunities 403 com mensagem', async (ctx) => {
    if (!available) return ctx.skip();
    const res = await as(http().get('/opportunities'), 'u1').expect(403);
    expect(res.body.message).toBe('Sem acesso a esta tela.');
  });

  it('u1 (sem clientes) → GET /clients 200 (seletor) e GET /clients/:id 403', async (ctx) => {
    if (!available) return ctx.skip();
    await as(http().get('/clients'), 'u1').expect(200);
    await as(http().get(`/clients/${id.client}`), 'u1').expect(403);
  });

  it('u1 → GET /dashboard/overview 200', async (ctx) => {
    if (!available) return ctx.skip();
    await as(http().get('/dashboard/overview'), 'u1').expect(200);
  });

  it('u1 não mexe no próprio grupo nem gerencia grupos', async (ctx) => {
    if (!available) return ctx.skip();
    await as(http().patch(`/users/${id.u1}`).send({ groupId: null }), 'u1').expect(403);
    await as(http().post('/user-groups').send({ name: `${PFX} X`, screens: [] }), 'u1').expect(403);
  });

  it('groupId inexistente → 400; grupo em CLIENT → 400', async (ctx) => {
    if (!available) return ctx.skip();
    const res = await as(http().patch(`/users/${id.u1}`).send({ groupId: 'nao-existe' }), 'u0').expect(400);
    expect(res.body.message).toBe('Grupo não encontrado.');
    const c = await prisma!.user.create({
      data: {
        name: 'c',
        email: `c${EMAIL}`,
        role: 'CONTACT',
        type: 'CLIENT',
        clientId: id.client,
        passwordHash: 'x',
      },
    });
    const r2 = await as(http().patch(`/users/${c.id}`).send({ groupId: id.g }), 'u0').expect(400);
    expect(r2.body.message).toBe('Grupos são só para usuários internos.');
  });

  it('u1 (admin com grupo) cria ADMIN sem groupId → herda o grupo de u1', async (ctx) => {
    if (!available) return ctx.skip();
    const res = await as(
      http().post('/users/internal').send({
        name: 'novo',
        email: `novo${EMAIL}`,
        role: 'ADMIN',
        password: 'senha-12345',
      }),
      'u1',
    ).expect(201);
    const row = await prisma!.user.findUnique({ where: { id: res.body.id } });
    expect(row?.groupId).toBe(id.g);
    await as(
      http().post('/users/internal').send({
        name: 'x', email: `x${EMAIL}`, role: 'ADMIN', password: 'senha-12345', groupId: null,
      }),
      'u1',
    ).expect(403);
  });

  it('u1 (config, com grupo) → backup export/import/list 403 e nada é executado', async (ctx) => {
    if (!available) return ctx.skip();
    await as(http().get('/backup/export'), 'u1').expect(403);
    await as(http().get('/backup/list'), 'u1').expect(403);
    await as(
      http().post('/backup/import').field('confirm', 'RESTAURAR').attach('file', Buffer.from('{}'), 'b.json'),
      'u1',
    ).expect(403);
    expect(backupMock.export).not.toHaveBeenCalled();
    expect(backupMock.import).not.toHaveBeenCalled();
    await as(http().get('/backup/export'), 'u0').expect(200);
  });

  it('u1 → PUT /settings: chave sensível 403; chave comum 200', async (ctx) => {
    if (!available) return ctx.skip();
    for (const k of ['resend.apiKey', 'mail.from', 'storage.driver']) {
      await as(http().put('/settings').send({ values: { [k]: 'x' } }), 'u1').expect(403);
    }
    expect(settingsMock.set).not.toHaveBeenCalled();
    await as(http().put('/settings').send({ values: { 'branding.companyName': 'Acme' } }), 'u1').expect(200);
    expect(settingsMock.set).toHaveBeenCalledWith('branding.companyName', 'Acme');
    await as(http().put('/settings').send({ values: { 'resend.apiKey': 'k' } }), 'u0').expect(200);
  });

  it('u1 não edita o admin pleno (PATCH /users/u0 → 403)', async (ctx) => {
    if (!available) return ctx.skip();
    await as(http().patch(`/users/${id.u0}`).send({ active: false }), 'u1').expect(403);
    const u0 = await prisma!.user.findUnique({ where: { id: id.u0 } });
    expect(u0?.active).toBe(true);
  });

  it('u2 (grupo sem config) → POST /users/internal e PATCH /users/:id 403', async (ctx) => {
    if (!available) return ctx.skip();
    await as(
      http().post('/users/internal').send({ name: 'y', email: `y${EMAIL}`, role: 'AGENT', password: 'senha-12345' }),
      'u2',
    ).expect(403);
    await as(http().patch(`/users/${id.u1}`).send({ active: true }), 'u2').expect(403);
    const c = await prisma!.user.create({
      data: { name: 'c2', email: `c2${EMAIL}`, role: 'CONTACT', type: 'CLIENT', clientId: id.client, passwordHash: 'x' },
    });
    await as(http().patch(`/users/${c.id}`).send({ phone: '11987654321', active: false }), 'u2').expect(200);
  });

  it('u0 (admin pleno) não coloca grupo em si mesmo → 403', async (ctx) => {
    if (!available) return ctx.skip();
    const res = await as(http().patch(`/users/${id.u0}`).send({ groupId: id.g }), 'u0').expect(403);
    expect(res.body.message).toBe('Você não pode restringir o próprio acesso.');
  });

  it('u0 libera crm no grupo → u1 passa na hora', async (ctx) => {
    if (!available) return ctx.skip();
    await as(http().patch(`/user-groups/${id.g}`).send({ screens: [...SCREENS] }), 'u0').expect(200);
    await as(http().get('/opportunities'), 'u1').expect(200);
  });

  it('u0 apaga o grupo → u1.groupId vira null', async (ctx) => {
    if (!available) return ctx.skip();
    await as(http().delete(`/user-groups/${id.g}`), 'u0').expect(200);
    const u1 = await prisma!.user.findUnique({ where: { id: id.u1 } });
    expect(u1?.groupId).toBeNull();
  });
});
