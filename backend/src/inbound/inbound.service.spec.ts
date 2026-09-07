import { InboundService } from './inbound.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';

function makeDeps(over: {
  ticketStatus?: string;
  threadTicket?: any;
  existingInbound?: any;
  contact?: any;
  client?: any;
} = {}) {
  const events: any[] = [];
  const tx = {
    ticketComment: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'c1', ...data }),
      ),
    },
    ticketEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        events.push(data);
        return Promise.resolve({ id: `e${events.length}`, ...data });
      }),
    },
    ticket: {
      findUnique: vi.fn().mockResolvedValue({ status: over.ticketStatus ?? 'OPEN' }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    inboundEmail: {
      findUnique: vi.fn().mockResolvedValue(over.existingInbound ?? null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ie1', ...data })),
    },
    ticket: {
      findUnique: vi.fn().mockResolvedValue(over.threadTicket ?? null),
    },
    user: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'u-new', ...data })),
    },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
  };
  const users = {
    findByEmail: vi.fn().mockImplementation((email: string) => {
      if (email === process.env.SEED_ADMIN_EMAIL) return Promise.resolve({ id: 'admin1' });
      return Promise.resolve(over.contact ?? null);
    }),
  };
  const clients = { findByEmailDomain: vi.fn().mockResolvedValue(over.client ?? null) };
  const tickets = {
    create: vi.fn().mockImplementation((input: any) =>
      Promise.resolve({ id: 't-new', number: '2026-0009', needsTriage: !input.clientId, ...input }),
    ),
  };
  const attachments = { saveForTicket: vi.fn().mockResolvedValue({ id: 'at1' }) };

  const service = new InboundService(
    prisma as any,
    users as any,
    clients as any,
    tickets as any,
    new TicketEventsService(),
    attachments as any,
  );
  return { service, prisma, users, clients, tickets, attachments, tx, events };
}

const basePayload = (over: Record<string, unknown> = {}) => ({
  from: 'Fulano <fulano@empresa.com>',
  subject: 'Impressora não liga',
  text: 'A impressora do RH parou.',
  headers: [{ name: 'Message-ID', value: '<m-1@mail>' }],
  attachments: [],
  ...over,
});

beforeAll(() => {
  process.env.SEED_ADMIN_EMAIL = 'admin@exemplo.com.br';
});

describe('InboundService.handle', () => {
  it('messageId repetido → no-op (dedupe), não cria ticket', async () => {
    const { service, prisma, tickets } = makeDeps({ existingInbound: { id: 'ie1', ticketId: 't1' } });
    const res = await service.handle(basePayload());

    expect(res).toEqual({ ticketId: 't1', deduped: true });
    expect(tickets.create).not.toHaveBeenCalled();
    expect(prisma.inboundEmail.create).not.toHaveBeenCalled();
  });

  it('[#2026-0001] no assunto → comentário PUBLIC no ticket + EMAIL_IN + resolveClientReply', async () => {
    const threadTicket = {
      id: 't1',
      number: '2026-0001',
      requesterId: 'r1',
      clientId: 'cli1',
      status: 'WAITING_CLIENT',
    };
    const { service, tickets, tx, events, prisma } = makeDeps({
      threadTicket,
      ticketStatus: 'WAITING_CLIENT',
    });

    await service.handle(
      basePayload({ subject: 'Re: [#2026-0001] Impressora', text: 'Voltou a funcionar?\n> antigo' }),
    );

    expect(tickets.create).not.toHaveBeenCalled();
    expect(tx.ticketComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: 't1',
          authorId: 'r1',
          visibility: 'PUBLIC',
          body: 'Voltou a funcionar?',
        }),
      }),
    );
    expect(events.some((e) => e.type === 'EMAIL_IN')).toBe(true);
    // resolveClientReply: WAITING_CLIENT → IN_PROGRESS
    expect(tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
    );
    expect(prisma.inboundEmail.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ticketId: 't1' }) }),
    );
  });

  it('domínio desconhecido → TicketsService.create com clientId/requesterId nulos e needsTriage', async () => {
    const { service, tickets } = makeDeps();
    const res = await service.handle(basePayload({ from: 'quem@desconhecido.com' }));

    expect(tickets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'EMAIL',
        clientId: null,
        requesterId: null,
        title: 'Impressora não liga',
      }),
    );
    expect(res.deduped).toBe(false);
  });

  it('domínio conhecido sem contato → cria User CONTACT active=false e usa como requesterId', async () => {
    const { service, prisma, tickets } = makeDeps({ client: { id: 'cli1' } });
    await service.handle(basePayload({ from: 'novo@acme.com' }));

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'novo@acme.com',
          type: 'CLIENT',
          role: 'CONTACT',
          active: false,
          clientId: 'cli1',
        }),
      }),
    );
    expect(tickets.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'cli1', requesterId: 'u-new', origin: 'EMAIL' }),
    );
  });

  it('contato existente → usa como requesterId, sem criar usuário', async () => {
    const { service, prisma, tickets } = makeDeps({
      contact: { id: 'ct1', type: 'CLIENT', role: 'CONTACT', clientId: 'cli9' },
    });
    await service.handle(basePayload({ from: 'fulano@empresa.com' }));

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(tickets.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'cli9', requesterId: 'ct1' }),
    );
  });

  it('anexos do payload → saveForTicket por arquivo', async () => {
    const { service, attachments } = makeDeps({ client: { id: 'cli1' } });
    await service.handle(
      basePayload({
        from: 'novo@acme.com',
        attachments: [
          { filename: 'foto.png', content: Buffer.from('x').toString('base64'), content_type: 'image/png' },
        ],
      }),
    );
    expect(attachments.saveForTicket).toHaveBeenCalledTimes(1);
    const [ticketId, file] = attachments.saveForTicket.mock.calls[0];
    expect(ticketId).toBe('t-new');
    expect(file.originalname).toBe('foto.png');
  });
});
