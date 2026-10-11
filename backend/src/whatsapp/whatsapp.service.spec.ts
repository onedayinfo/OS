import { WhatsappService } from './whatsapp.service.js';
import type { ParsedWhatsappMessage } from './evolution-payload.js';

const msg = (over: Partial<ParsedWhatsappMessage> = {}): ParsedWhatsappMessage => ({
  externalId: 'g@g.us:M1',
  groupJid: 'g@g.us',
  senderPhone: '5519999991234',
  senderName: 'Fulano',
  type: 'TEXT',
  body: 'Sem conexão - escritório',
  sentAt: new Date('2026-10-11T12:00:00Z'),
  ...over,
});

const group = { id: 'g1', externalId: 'g@g.us', name: 'Suporte Acme', clientId: 'c1', active: true };
const phrases = [
  { id: 'p1', phrase: 'Sem conexão', phraseNorm: 'sem conexao', title: 'Sem internet', categoryId: 'cat1', priority: 'HIGH' },
  { id: 'p2', phrase: 'Sem conexão total', phraseNorm: 'sem conexao total', title: null, categoryId: null, priority: 'URGENT' },
];

function make(over: { group?: any; phrases?: any[]; contacts?: any[]; open?: any; createError?: any } = {}) {
  const prisma = {
    whatsappGroup: { findUnique: vi.fn().mockResolvedValue('group' in over ? over.group : group) },
    user: { findMany: vi.fn().mockResolvedValue(over.contacts ?? []) },
    triggerPhrase: { findMany: vi.fn().mockResolvedValue(over.phrases ?? phrases) },
    whatsappMessage: {
      create: over.createError
        ? vi.fn().mockRejectedValue(over.createError)
        : vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', ...data })),
      findFirst: vi.fn().mockResolvedValue(over.open ?? null),
      findUnique: vi.fn().mockResolvedValue({ ticketId: 't9' }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const tickets = { create: vi.fn().mockResolvedValue({ id: 't1', number: '2026-0001' }) };
  const events = { record: vi.fn().mockResolvedValue({}) };
  return { service: new WhatsappService(prisma as any, tickets as any, events as any), prisma, tickets, events };
}

describe('WhatsappService.ingest', () => {
  it('grupo desconhecido ou inativo → descarta sem gravar', async () => {
    for (const g of [null, { ...group, active: false }]) {
      const { service, prisma, tickets } = make({ group: g });
      expect(await service.ingest(msg())).toEqual({ stored: false, ticketId: null });
      expect(prisma.whatsappMessage.create).not.toHaveBeenCalled();
      expect(tickets.create).not.toHaveBeenCalled();
    }
  });

  it('sem gatilho → grava PENDING, sem chamado', async () => {
    const { service, prisma, tickets } = make();
    const r = await service.ingest(msg({ body: 'a internet está lenta hoje' }));
    expect(r).toEqual({ stored: true, ticketId: null });
    expect(prisma.whatsappMessage.create.mock.calls[0][0].data).toMatchObject({ groupId: 'g1', aiStatus: 'PENDING', triggerPhraseId: null });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('gatilho cria chamado com os dados da frase e marca a mensagem', async () => {
    const { service, prisma, tickets } = make();
    const r = await service.ingest(msg());
    expect(r).toEqual({ stored: true, ticketId: 't1' });
    const input = tickets.create.mock.calls[0][0];
    expect(input).toMatchObject({
      origin: 'WHATSAPP', clientId: 'c1', requesterId: null,
      title: 'Sem internet', categoryId: 'cat1', priority: 'HIGH',
    });
    expect(input.description).toContain('escritório');
    expect(input.description).toContain('Suporte Acme');
    expect(input.description).toContain('remetente não identificado');
    expect(prisma.whatsappMessage.create.mock.calls[0][0].data).toMatchObject({ aiStatus: 'SKIPPED', triggerPhraseId: 'p1' });
    expect(prisma.whatsappMessage.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { ticketId: 't1' } });
  });

  it('a frase mais longa vence', async () => {
    const { service, tickets } = make();
    await service.ingest(msg({ body: 'Sem conexão total no prédio' }));
    expect(tickets.create.mock.calls[0][0]).toMatchObject({ priority: 'URGENT', title: 'Sem conexão total' });
  });

  it('contato identificado pelo telefone (com/sem 9º dígito) vira solicitante', async () => {
    const { service, tickets } = make({ contacts: [{ id: 'u7', phone: '551999991234' }] });
    await service.ingest(msg({ senderPhone: '5519999991234' }));
    const input = tickets.create.mock.calls[0][0];
    expect(input.requesterId).toBe('u7');
    expect(input.description).not.toContain('não identificado');
  });

  it('remetente sem telefone (LID) ainda cria o chamado, não identificado', async () => {
    const { service, tickets } = make();
    await service.ingest(msg({ senderPhone: '' }));
    expect(tickets.create.mock.calls[0][0].requesterId).toBeNull();
  });

  it('mesma frase no mesmo grupo com chamado aberto → evento no chamado, sem novo', async () => {
    const { service, tickets, events, prisma } = make({ open: { ticketId: 't5' } });
    const r = await service.ingest(msg());
    expect(r).toEqual({ stored: true, ticketId: 't5' });
    expect(tickets.create).not.toHaveBeenCalled();
    expect(events.record).toHaveBeenCalledWith(
      expect.anything(), 't5', 'WHATSAPP_IN',
      expect.objectContaining({ text: 'Sem conexão - escritório', sender: 'Fulano' }),
    );
    expect(prisma.whatsappMessage.update.mock.calls[0][0].data).toEqual({ ticketId: 't5' });
    // a busca de "aberto" exclui chamados encerrados
    expect(prisma.whatsappMessage.findFirst.mock.calls[0][0].where.ticket).toEqual({
      status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
    });
  });

  it('reentrega do mesmo evento (P2002) → não duplica nada', async () => {
    const { service, tickets } = make({ createError: { code: 'P2002' } });
    expect(await service.ingest(msg())).toEqual({ stored: false, ticketId: 't9' });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('tickets.create falha → propaga, e a linha já estava SKIPPED', async () => {
    const { service, prisma, tickets } = make();
    tickets.create.mockRejectedValue(new Error('boom'));
    await expect(service.ingest(msg())).rejects.toThrow('boom');
    expect(prisma.whatsappMessage.create.mock.calls[0][0].data.aiStatus).toBe('SKIPPED');
  });

  it('reentrega com gatilho inacabado → retoma e abre o chamado', async () => {
    const { service, prisma, tickets } = make({ createError: { code: 'P2002' } });
    prisma.whatsappMessage.findUnique.mockResolvedValue({ id: 'm0', ticketId: null, triggerPhraseId: 'p1' });
    expect(await service.ingest(msg())).toEqual({ stored: true, ticketId: 't1' });
    expect(tickets.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsappMessage.update).toHaveBeenCalledWith({ where: { id: 'm0' }, data: { ticketId: 't1' } });
  });

  it('reentrega de linha já com chamado → não recria', async () => {
    const { service, prisma, tickets } = make({ createError: { code: 'P2002' } });
    prisma.whatsappMessage.findUnique.mockResolvedValue({ id: 'm0', ticketId: 't3', triggerPhraseId: 'p1' });
    expect(await service.ingest(msg())).toEqual({ stored: false, ticketId: 't3' });
    expect(tickets.create).not.toHaveBeenCalled();
  });

  it('concorrência: duas mensagens do mesmo gatilho geram um só chamado', async () => {
    const { service, prisma, tickets, events } = make();
    let linked: string | null = null;
    prisma.whatsappMessage.findFirst.mockImplementation(() => Promise.resolve(linked ? { ticketId: linked } : null));
    prisma.whatsappMessage.update.mockImplementation(({ data }: any) => {
      linked = data.ticketId;
      return Promise.resolve({});
    });
    tickets.create.mockImplementation(() => new Promise((r) => setTimeout(() => r({ id: 't1', number: 'N' }), 10)));
    await Promise.all([service.ingest(msg({ externalId: 'a' })), service.ingest(msg({ externalId: 'b' }))]);
    expect(tickets.create).toHaveBeenCalledTimes(1);
    expect(events.record).toHaveBeenCalledTimes(1);
  });

  it('áudio/imagem são gravados como SKIPPED e não disparam gatilho', async () => {
    const { service, prisma, tickets } = make();
    await service.ingest(msg({ type: 'AUDIO', body: null }));
    expect(prisma.whatsappMessage.create.mock.calls[0][0].data.aiStatus).toBe('SKIPPED');
    await service.ingest(msg({ type: 'IMAGE', body: 'Sem conexão' }));
    expect(tickets.create).not.toHaveBeenCalled();
  });
});
