import { AgentCodeService } from './agent-code.service.js';

const make = () => {
  const prisma: any = {
    client: {
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', agentEnrollCode: 'abc' }),
      update: vi.fn().mockResolvedValue({}),
    },
    agentDevice: {
      count: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.OR ? 4 : where.status === 'LINKED' ? 7 : where.status === 'PENDING' ? 2 : 1)),
    },
  };
  const gate: any = { hasValidContract: vi.fn().mockResolvedValue(true) };
  return { prisma, gate, s: new AgentCodeService(prisma, gate) };
};

describe('AgentCodeService', () => {
  it('regenerate grava 32 hex', async () => {
    const { prisma, s } = make();
    const { code } = await s.regenerate('c1');
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(prisma.client.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { agentEnrollCode: code } });
  });

  it('regenerate com cliente inexistente -> 404', async () => {
    const { prisma, s } = make();
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(s.regenerate('x')).rejects.toThrow('Cliente não encontrado.');
  });

  it('summary zera stale sem contrato válido', async () => {
    const { gate, s } = make();
    gate.hasValidContract.mockResolvedValue(false);
    const out = await s.summary('c1');
    expect(out.contractValid).toBe(false);
    expect(out.counts.stale).toBe(0);
    expect(out.counts.linked).toBe(7);
  });

  it('summary conta stale como LINKED sem contato há 30 dias', async () => {
    const { prisma, s } = make();
    const out = await s.summary('c1');
    expect(out).toEqual({ code: 'abc', contractValid: true, counts: { linked: 7, pending: 2, ignored: 1, stale: 4 } });
    const staleCall = prisma.agentDevice.count.mock.calls.find((c: any) => c[0].where.OR)[0];
    expect(staleCall.where.clientId).toBe('c1');
    expect(staleCall.where.status).toBe('LINKED');
    expect(staleCall.where.OR[0]).toEqual({ lastSeenAt: null });
    expect(staleCall.where.OR[1].lastSeenAt.lt).toBeInstanceOf(Date);
  });
});
