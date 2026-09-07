import { ForbiddenException } from '@nestjs/common';
import { CommentsService } from './comments.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';

type TicketRow = {
  id: string;
  number: string;
  firstResponseAt: Date | null;
  status?: string;
};

function makeDeps(ticket: Partial<TicketRow> = {}) {
  const row: TicketRow = {
    id: 't1',
    number: '2026-0001',
    firstResponseAt: null,
    status: 'OPEN',
    ...ticket,
  };
  const events: any[] = [];
  const tx = {
    ticketComment: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'c1', createdAt: new Date(), ...data }),
      ),
    },
    ticketEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        events.push(data);
        return Promise.resolve({ id: `e${events.length}`, ...data });
      }),
    },
    ticket: {
      findUnique: vi.fn().mockResolvedValue({ status: row.status }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = { $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)) };
  const tickets = { assertAccess: vi.fn().mockResolvedValue(row) };
  const notifier = {
    created: vi.fn(),
    resolved: vi.fn(),
    assigned: vi.fn(),
    publicComment: vi.fn().mockResolvedValue(undefined),
  };
  const service = new CommentsService(
    prisma as any,
    tickets as any,
    new TicketEventsService(),
    notifier as any,
  );
  return { service, prisma, tickets, notifier, tx, events };
}

const agent = { id: 'a1', type: 'INTERNAL', role: 'AGENT', clientId: null };
const client = { id: 'u1', type: 'CLIENT', role: 'CONTACT', clientId: 'x1' };

describe('CommentsService.create', () => {
  it('CLIENT com visibility=INTERNAL → ForbiddenException', async () => {
    const { service, tx } = makeDeps();
    await expect(
      service.create('t1', { body: 'oi', visibility: 'INTERNAL' }, client),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.ticketComment.create).not.toHaveBeenCalled();
  });

  it('1º comentário PUBLIC de AGENT grava firstResponseAt; o 2º não altera', async () => {
    const first = makeDeps({ firstResponseAt: null });
    await first.service.create('t1', { body: 'resposta', visibility: 'PUBLIC' }, agent);
    expect(first.tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: { firstResponseAt: expect.any(Date) },
      }),
    );

    const second = makeDeps({ firstResponseAt: new Date('2026-01-01') });
    await second.service.create('t1', { body: 'outra', visibility: 'PUBLIC' }, agent);
    expect(second.tx.ticket.update).not.toHaveBeenCalled();
  });

  it('comentário de CLIENT em ticket WAITING_CLIENT → resolveClientReply (volta a IN_PROGRESS)', async () => {
    const { service, tx } = makeDeps({ status: 'WAITING_CLIENT' });
    await service.create('t1', { body: 'segue', visibility: 'PUBLIC' }, client);
    expect(tx.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
    );
  });

  it('PUBLIC → notifier.publicComment chamado; INTERNAL → não', async () => {
    const pub = makeDeps();
    await pub.service.create('t1', { body: 'p', visibility: 'PUBLIC' }, agent);
    expect(pub.notifier.publicComment).toHaveBeenCalledTimes(1);

    const int = makeDeps();
    await int.service.create('t1', { body: 'i', visibility: 'INTERNAL' }, agent);
    expect(int.notifier.publicComment).not.toHaveBeenCalled();
  });

  it('grava TicketEvent COMMENT com a visibilidade e o actorId', async () => {
    const { service, events } = makeDeps();
    await service.create('t1', { body: 'x', visibility: 'PUBLIC' }, agent);
    const comment = events.filter((e) => e.type === 'COMMENT');
    expect(comment).toHaveLength(1);
    expect(comment[0].data).toEqual({ visibility: 'PUBLIC' });
    expect(comment[0].actorId).toBe('a1');
  });
});
