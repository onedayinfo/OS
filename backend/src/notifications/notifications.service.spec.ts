import { NotificationsService } from './notifications.service.js';

const ticketBase = {
  number: '2026-0001',
  title: 'Rede caiu',
  status: 'OPEN',
  priority: 'HIGH',
  requesterId: 'req1',
  assigneeId: null,
  clientId: 'cli1',
} as any;

function make(users: Record<string, any>, admins: any[] = [], managers: any[] = []) {
  const send = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    user: {
      findUnique: vi.fn(({ where: { id } }: any) => Promise.resolve(users[id] ?? null)),
      findMany: vi.fn(({ where }: any) =>
        Promise.resolve(where.role === 'ADMIN' ? admins : managers),
      ),
    },
  };
  const svc = new NotificationsService(prisma as any, { send } as any);
  return { svc, send };
}

describe('NotificationsService', () => {
  it('created: requester + admins recebem um e-mail cada', async () => {
    const { svc, send } = make(
      { req1: { id: 'req1', email: 'req@a.com' } },
      [{ id: 'ad1', email: 'admin@a.com' }],
    );
    await svc.created(ticketBase);
    expect(send).toHaveBeenCalledTimes(2);
    const tos = send.mock.calls.map((c) => c[0].to);
    expect(tos).toEqual(expect.arrayContaining(['req@a.com', 'admin@a.com']));
    expect(send.mock.calls[0][0].headers).toEqual({ References: '2026-0001' });
  });

  it('created sem requester (triagem): só admins', async () => {
    const { svc, send } = make({}, [{ id: 'ad1', email: 'admin@a.com' }]);
    await svc.created({ ...ticketBase, requesterId: null });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('admin@a.com');
  });

  it('publicComment: não envia para o autor do comentário', async () => {
    const { svc, send } = make(
      { req1: { id: 'req1', email: 'req@a.com' } },
      [],
      [
        { id: 'mgr1', email: 'mgr@a.com' },
        { id: 'req1', email: 'req@a.com' },
      ],
    );
    await svc.publicComment(ticketBase, { id: 'c1', authorId: 'req1', body: 'oi' } as any);
    const tos = send.mock.calls.map((c) => c[0].to);
    expect(tos).toEqual(['mgr@a.com']);
  });

  it('assigned: só o responsável', async () => {
    const { svc, send } = make({ ag1: { id: 'ag1', email: 'ag@a.com' } });
    await svc.assigned({ ...ticketBase, assigneeId: 'ag1' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('ag@a.com');
  });

  it('slaBreached: responsável + admins, sem duplicar', async () => {
    const { svc, send } = make(
      { ag1: { id: 'ag1', email: 'ag@a.com' } },
      [{ id: 'ag1', email: 'ag@a.com' }, { id: 'ad1', email: 'admin@a.com' }],
    );
    await svc.slaBreached({ ...ticketBase, assigneeId: 'ag1' });
    const tos = send.mock.calls.map((c) => c[0].to).sort();
    expect(tos).toEqual(['admin@a.com', 'ag@a.com']);
  });

  it('falha de envio não propaga', async () => {
    const { svc, send } = make({ req1: { id: 'req1', email: 'req@a.com' } });
    send.mockRejectedValueOnce(new Error('smtp down'));
    vi.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});
    await expect(svc.resolved(ticketBase)).resolves.toBeUndefined();
  });
});
