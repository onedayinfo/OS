import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { SettingsService } from '../settings/settings.service.js';

// INTEGRAÇÃO: Postgres real + grafo de DI completo (pega o tipo de falha que
// `new Service(mock)` e `nest build` não pegam). Sem banco no ar, pula com aviso.
const PFX = `WA-${Date.now()}`;
const GROUP = `${Date.now()}@g.us`;
const SECRET = 'segredo-de-teste';

let prisma: PrismaClient | undefined;
let app: INestApplication | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.whatsappMessage.deleteMany({ where: { group: { externalId: GROUP } } });
  await p.ticketSuggestion.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.whatsappGroup.deleteMany({ where: { externalId: GROUP } });
  await p.triggerPhrase.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.ticketEvent.deleteMany({ where: { ticket: { client: { name: { startsWith: PFX } } } } });
  await p.ticket.deleteMany({ where: { client: { name: { startsWith: PFX } } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${PFX.toLowerCase()}.itest` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.setting.deleteMany({ where: { key: 'whatsapp.webhookSecret' } });
}

const payload = (msgId: string, text: string, participant = '5519999991234@s.whatsapp.net') => ({
  event: 'messages.upsert',
  instance: 'os',
  data: {
    key: { remoteJid: GROUP, fromMe: false, id: msgId, participant },
    pushName: 'Fulano',
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
  },
});

describe('WhatsApp — webhook até chamado (Postgres real)', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[whatsapp.integration] Postgres indisponível — pulando.');
      return;
    }
    process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    id.clientId = client.id;
    const contact = await prisma.user.create({
      data: {
        name: `${PFX} Contato`, email: `contato@${PFX.toLowerCase()}.itest`,
        type: 'CLIENT', role: 'CONTACT', clientId: client.id, phone: '551999991234', // sem o 9º dígito
      },
    });
    id.contactId = contact.id;
    await prisma.whatsappGroup.create({ data: { externalId: GROUP, clientId: client.id, name: 'Suporte' } });
    await prisma.triggerPhrase.create({
      data: { clientId: client.id, phrase: 'Sem conexão', phraseNorm: 'sem conexao', priority: 'HIGH', title: 'Sem internet' },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    await app.get(SettingsService).set('whatsapp.webhookSecret', SECRET);
  }, 60_000);

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
    await app?.close();
  });

  const post = (body: unknown, secret = SECRET) =>
    request(app!.getHttpServer()).post('/whatsapp/webhook').set('x-webhook-secret', secret).send(body as object);

  it('segredo errado → 401', async () => {
    if (!available) return;
    await post(payload('X0', 'Sem conexão'), 'errado').expect(401);
  });

  it('gatilho cria o chamado WHATSAPP, vinculado ao contato pelo telefone', async () => {
    if (!available) return;
    const res = await post(payload('A1', 'SEM CONEXÃO - escritório sem rede')).expect(200);
    expect(res.body.ticketId).toBeTruthy();
    const t = await prisma!.ticket.findUnique({ where: { id: res.body.ticketId } });
    expect(t).toMatchObject({ origin: 'WHATSAPP', clientId: id.clientId, requesterId: id.contactId, priority: 'HIGH', title: 'Sem internet' });
    expect(t!.description).toContain('escritório sem rede');
    id.ticketId = t!.id;
  });

  it('reentrega do mesmo evento não duplica mensagem nem chamado', async () => {
    if (!available) return;
    await post(payload('A1', 'SEM CONEXÃO - escritório sem rede')).expect(200);
    expect(await prisma!.whatsappMessage.count({ where: { group: { externalId: GROUP } } })).toBe(1);
    expect(await prisma!.ticket.count({ where: { clientId: id.clientId } })).toBe(1);
  });

  it('mesma frase com chamado aberto vira evento no mesmo chamado', async () => {
    if (!available) return;
    await post(payload('A2', 'Sem conexão de novo, agora na recepção')).expect(200);
    expect(await prisma!.ticket.count({ where: { clientId: id.clientId } })).toBe(1);
    const ev = await prisma!.ticketEvent.findMany({ where: { ticketId: id.ticketId, type: 'WHATSAPP_IN' } });
    expect(ev).toHaveLength(1);
  });

  it('mensagem sem gatilho fica PENDING para a IA, de remetente desconhecido (LID)', async () => {
    if (!available) return;
    await post(payload('A3', 'a impressora parou', '99887766554433@lid')).expect(200);
    const m = await prisma!.whatsappMessage.findFirst({ where: { body: 'a impressora parou' } });
    expect(m).toMatchObject({ aiStatus: 'PENDING', senderPhone: '', senderUserId: null, ticketId: null });
  });

  it('grupo não cadastrado é ignorado sem gravar nada', async () => {
    if (!available) return;
    const other = payload('A4', 'Sem conexão');
    other.data.key.remoteJid = '999999999@g.us';
    await post(other).expect(200);
    expect(await prisma!.whatsappMessage.count({ where: { externalId: { contains: '999999999@g.us' } } })).toBe(0);
  });
});
