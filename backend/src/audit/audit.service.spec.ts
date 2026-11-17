import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';

function setup(create = vi.fn().mockResolvedValue({})) {
  const prisma = {
    auditLog: {
      create,
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
  };
  return { prisma, svc: new AuditService(prisma as never) };
}

afterEach(() => vi.restoreAllMocks());

describe('AuditService', () => {
  it('record grava data já mascarado', () => {
    const { prisma, svc } = setup();
    svc.record({ kind: 'ACTION', level: 'info', module: 'auth', message: 'login', data: { password: 'x', a: 1 } });
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create.mock.calls[0][0].data.data).toEqual({ password: '***', a: 1 });
  });

  it('record não lança quando o create rejeita e escreve em stderr', async () => {
    const { svc } = setup(vi.fn().mockRejectedValue(new Error('db fora')));
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(() => svc.record({ kind: 'ERROR', level: 'error', module: 'x', message: 'm' })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('db fora'));
  });

  it('record não lança com data cíclico ou BigInt', () => {
    const { svc } = setup();
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = {};
    a.a = a;
    const base = { kind: 'ACTION', level: 'info', module: 'x', message: 'm' } as const;
    expect(() => svc.record({ ...base, data: a })).not.toThrow();
    expect(() => svc.record({ ...base, data: { n: 1n } })).not.toThrow();
    expect(stderr).toHaveBeenCalled();
  });

  it('list monta where e paginação', async () => {
    const { prisma, svc } = setup();
    const r = await svc.list({ kind: 'ERROR', q: 's3', page: 2, pageSize: 10 });
    const arg = prisma.auditLog.findMany.mock.calls[0][0];
    expect(arg.where.kind).toBe('ERROR');
    expect(arg.where.OR).toHaveLength(2);
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
    expect(r).toMatchObject({ total: 0, page: 2, pageSize: 10 });
  });

  it('modules devolve os módulos distintos em ordem alfabética', async () => {
    const { prisma, svc } = setup();
    prisma.auditLog.findMany.mockResolvedValueOnce([{ module: 'auth' }, { module: 'tickets' }]);
    expect(await svc.modules()).toEqual(['auth', 'tickets']);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      distinct: ['module'],
      select: { module: true },
      orderBy: { module: 'asc' },
    });
  });

  it('purgeOlderThan usa now - dias', async () => {
    const { prisma, svc } = setup();
    expect(await svc.purgeOlderThan(90)).toBe(3);
    const lt: Date = prisma.auditLog.deleteMany.mock.calls[0][0].where.createdAt.lt;
    expect(Math.abs(Date.now() - 90 * 86_400_000 - lt.getTime())).toBeLessThan(5000);
  });
});
