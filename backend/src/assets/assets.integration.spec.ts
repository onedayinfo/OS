import { BadRequestException, INestApplication } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { RolesGuard } from '../common/roles.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { AssetsImportService } from './assets-import.service.js';

// Teste de INTEGRAÇÃO: Postgres real (`docker compose up -d postgres`). Sem
// DATABASE_URL / banco no ar, o bloco pula com aviso (exit 0). Cobre o boundary
// de credenciais (nunca sai `credentialsEnc`), local⊂cliente, série única por
// cliente e o gate de papel do endpoint de credenciais.
const PFX = `ATL-${Date.now()}`;

let prisma: PrismaClient | undefined;
let available = false;

const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.asset.deleteMany({ where: { label: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.assetType.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Assets — integração (Postgres real)', () => {
  beforeAll(async () => {
    // crypto.util exige APP_ENCRYPTION_KEY; fora do .env de dev, usa uma chave fixa de teste.
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

    if (!process.env.DATABASE_URL) {
      console.warn(
        '[integration] DATABASE_URL ausente — pulando integração de ativos. ' +
          'Rode `docker compose up -d postgres`.',
      );
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

    const c1 = await prisma.client.create({ data: { name: `${PFX} Cliente 1` } });
    const c2 = await prisma.client.create({ data: { name: `${PFX} Cliente 2` } });
    id.c1 = c1.id;
    id.c2 = c2.id;
    id.loc1 = (await prisma.location.create({ data: { clientId: c1.id, name: `${PFX} Matriz` } })).id;
    id.loc2 = (await prisma.location.create({ data: { clientId: c2.id, name: `${PFX} Filial` } })).id;
    id.type = (await prisma.assetType.create({ data: { name: `${PFX} Câmera` } })).id;
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup(prisma).catch(() => {});
      await prisma.$disconnect();
    }
  });

  const svc = () => new AssetsService(prisma as unknown as PrismaService);

  it('create com credenciais → findOne traz hasCredentials e nunca credentialsEnc', async (ctx) => {
    if (!available) return ctx.skip();
    const created = await svc().create({
      clientId: id.c1,
      locationId: id.loc1,
      typeId: id.type,
      label: `${PFX} CAM-01`,
      credentials: { username: 'admin', password: 's3nh4' },
    } as never);
    id.asset = created.id;
    expect(created).not.toHaveProperty('credentialsEnc');
    expect(created.hasCredentials).toBe(true);

    const found = await svc().findOne(created.id);
    expect(found).not.toHaveProperty('credentialsEnc');
    expect(found.hasCredentials).toBe(true);
  });

  it('revealCredentials devolve o par gravado', async (ctx) => {
    if (!available) return ctx.skip();
    expect(await svc().revealCredentials(id.asset)).toEqual({ username: 'admin', password: 's3nh4' });
  });

  it('create com locationId de outro cliente → BadRequestException', async (ctx) => {
    if (!available) return ctx.skip();
    await expect(
      svc().create({
        clientId: id.c1,
        locationId: id.loc2,
        typeId: id.type,
        label: `${PFX} CAM-X`,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('serialNumber duplicado no mesmo cliente → BadRequestException; outro cliente → OK', async (ctx) => {
    if (!available) return ctx.skip();
    await svc().create({
      clientId: id.c1,
      locationId: id.loc1,
      typeId: id.type,
      label: `${PFX} CAM-SN-A`,
      serialNumber: 'SN-DUP',
    } as never);

    await expect(
      svc().create({
        clientId: id.c1,
        locationId: id.loc1,
        typeId: id.type,
        label: `${PFX} CAM-SN-B`,
        serialNumber: 'SN-DUP',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    const other = await svc().create({
      clientId: id.c2,
      locationId: id.loc2,
      typeId: id.type,
      label: `${PFX} CAM-SN-C`,
      serialNumber: 'SN-DUP',
    } as never);
    expect(other.id).toBeTruthy();
  });

  describe('GET /assets/:id/credentials — gate de papel', () => {
    let app: INestApplication | undefined;

    beforeAll(async () => {
      if (!available) return;
      const moduleRef = await Test.createTestingModule({
        controllers: [AssetsController],
        providers: [
          AssetsService,
          AssetsImportService,
          Reflector,
          { provide: PrismaService, useValue: prisma },
          // roda antes do RolesGuard: popula req.user a partir do header de teste.
          {
            provide: APP_GUARD,
            useValue: {
              canActivate: (c: any) => {
                const req = c.switchToHttp().getRequest();
                const role = req.headers['x-test-role'];
                if (!role) return false;
                req.user = {
                  id: 'tester',
                  role,
                  type: role === 'AGENT' || role === 'ADMIN' ? 'INTERNAL' : 'CLIENT',
                  clientId: null,
                };
                return true;
              },
            },
          },
          { provide: APP_GUARD, useClass: RolesGuard },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('CONTACT → 403', async (ctx) => {
      if (!available || !app) return ctx.skip();
      await request(app.getHttpServer())
        .get(`/assets/${id.asset}/credentials`)
        .set('x-test-role', 'CONTACT')
        .expect(403);
    });

    it('MANAGER → 403', async (ctx) => {
      if (!available || !app) return ctx.skip();
      await request(app.getHttpServer())
        .get(`/assets/${id.asset}/credentials`)
        .set('x-test-role', 'MANAGER')
        .expect(403);
    });

    it('AGENT → 200 com o par de credenciais', async (ctx) => {
      if (!available || !app) return ctx.skip();
      const res = await request(app.getHttpServer())
        .get(`/assets/${id.asset}/credentials`)
        .set('x-test-role', 'AGENT')
        .expect(200);
      expect(res.body).toEqual({ username: 'admin', password: 's3nh4' });
    });
  });
});
