import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  describe('installer', () => {
    afterEach(() => delete process.env.AGENT_MSI_PATH);

    it('cliente sem código -> 409', async () => {
      const { prisma, s } = make();
      prisma.client.findUnique.mockResolvedValue({ id: 'c1', agentEnrollCode: null });
      await expect(s.installer('c1')).rejects.toThrow('Gere o código de instalação antes de baixar o instalador.');
    });

    it('MSI ausente -> 404', async () => {
      const { s } = make();
      process.env.AGENT_MSI_PATH = join(tmpdir(), 'nao-existe-agente.msi');
      await expect(s.installer('c1')).rejects.toThrow('Instalador ainda não publicado.');
    });

    it('MSI presente -> caminho e nome AgenteOS-<codigo>.msi', async () => {
      const { s } = make();
      const f = join(mkdtempSync(join(tmpdir(), 'msi-')), 'AgenteOS.msi');
      writeFileSync(f, 'x');
      process.env.AGENT_MSI_PATH = f;
      await expect(s.installer('c1')).resolves.toEqual({ path: f, filename: 'AgenteOS-abc.msi' });
      await expect(s.installer('c1', undefined, 'os.cliente.com.br:443')).resolves.toEqual({
        path: f,
        filename: 'AgenteOS-abc-os.cliente.com.br.msi',
      });
    });
  });
});
