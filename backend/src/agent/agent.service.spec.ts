import { AgentService } from './agent.service.js';
import { hashToken } from './token.util.js';

const dto: any = { code: 'a'.repeat(32), machineGuid: 'g1', hostname: 'PC1', serialNumber: 'SN1' };

const make = () => {
  const prisma: any = {
    agentDevice: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ status: 'PENDING', ...data })),
    },
  };
  const codes: any = { clientByCode: vi.fn().mockResolvedValue({ id: 'c1' }) };
  const gate: any = { hasValidContract: vi.fn().mockResolvedValue(true) };
  return { prisma, codes, gate, s: new AgentService(prisma, codes, gate) };
};

describe('AgentService.enroll', () => {
  it('código desconhecido -> 401', async () => {
    const { codes, s } = make();
    codes.clientByCode.mockResolvedValue(null);
    await expect(s.enroll(dto)).rejects.toThrow('Código de instalação inválido.');
  });

  it('sem contrato -> 403', async () => {
    const { gate, s } = make();
    gate.hasValidContract.mockResolvedValue(false);
    await expect(s.enroll(dto)).rejects.toThrow('O cliente não possui contrato ativo.');
  });

  it('cria PENDING com tokenHash, nunca o token', async () => {
    const { prisma, s } = make();
    const out = await s.enroll(dto);
    expect(out.status).toBe('PENDING');
    const data = prisma.agentDevice.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashToken(out.token));
    expect(JSON.stringify(data)).not.toContain(out.token);
    expect(data).toMatchObject({ clientId: 'c1', serialKey: 'SN1', serialNumber: 'SN1', cloneSuspect: false });
  });

  it('com 50 PENDING -> 409', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.count.mockResolvedValue(50);
    await expect(s.enroll(dto)).rejects.toThrow('Limite de dispositivos aguardando cadastro atingido.');
  });

  it('clone cria novo com cloneSuspect', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findMany.mockResolvedValue([{ id: 'd1', serialKey: 'OUTRO', status: 'LINKED' }]);
    await s.enroll(dto);
    expect(prisma.agentDevice.create.mock.calls[0][0].data.cloneSuspect).toBe(true);
  });

  it('IGNORED -> 403', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findMany.mockResolvedValue([{ id: 'd1', serialKey: 'SN1', status: 'IGNORED' }]);
    await expect(s.enroll(dto)).rejects.toThrow('Dispositivo ignorado.');
  });

  it('reenroll gera novo token (hash trocado)', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findMany.mockResolvedValue([{ id: 'd1', serialKey: 'SN1', status: 'LINKED' }]);
    prisma.agentDevice.update.mockImplementation(({ data }: any) => Promise.resolve({ status: 'LINKED', ...data }));
    const a = await s.enroll(dto);
    const b = await s.enroll(dto);
    expect(a.token).not.toBe(b.token);
    expect(a.status).toBe('LINKED');
    const [h1, h2] = prisma.agentDevice.update.mock.calls.map((c: any) => c[0].data.tokenHash);
    expect(h1).toBe(hashToken(a.token));
    expect(h2).toBe(hashToken(b.token));
    expect(prisma.agentDevice.create).not.toHaveBeenCalled();
  });
});
