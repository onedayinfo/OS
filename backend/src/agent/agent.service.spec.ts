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
      findUnique: vi.fn().mockResolvedValue(null),
    },
    asset: { update: vi.fn().mockResolvedValue({}) },
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

describe('AgentService.checkin', () => {
  const dev = (o: any = {}) => ({ id: 'd1', clientId: 'c1', status: 'PENDING', inventoryAt: null, ...o });
  const upd = () => (({ data }: any) => Promise.resolve({ ...dev(), ...data }));

  it('token desconhecido -> 401', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findUnique.mockResolvedValue(null);
    await expect(s.checkin('x', { hostname: 'h' })).rejects.toThrow('Token inválido.');
    expect(prisma.agentDevice.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashToken('x') });
  });

  it('IGNORED -> 403 sem update', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findUnique.mockResolvedValue(dev({ status: 'IGNORED' }));
    await expect(s.checkin('x', { hostname: 'h' })).rejects.toThrow('Dispositivo ignorado.');
    expect(prisma.agentDevice.update).not.toHaveBeenCalled();
  });

  it('sem contrato -> 403 sem update', async () => {
    const { prisma, gate, s } = make();
    prisma.agentDevice.findUnique.mockResolvedValue(dev());
    gate.hasValidContract.mockResolvedValue(false);
    await expect(s.checkin('x', { hostname: 'h' })).rejects.toThrow('O cliente não possui contrato ativo.');
    expect(prisma.agentDevice.update).not.toHaveBeenCalled();
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('sem inventário atualiza lastSeenAt/hostname/agentVersion e pede inventário', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findUnique.mockResolvedValue(dev());
    prisma.agentDevice.update.mockImplementation(upd());
    const out = await s.checkin('x', { hostname: 'PC9', agentVersion: '1.2' });
    const data = prisma.agentDevice.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ hostname: 'PC9', agentVersion: '1.2' });
    expect(data.lastSeenAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('specs');
    expect(out).toEqual({ status: 'PENDING', wantInventory: true });
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('com inventário grava specs/software/inventoryAt e não pede mais', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findUnique.mockResolvedValue(dev());
    prisma.agentDevice.update.mockImplementation(upd());
    const out = await s.checkin('x', { hostname: 'h', inventory: { specs: { cpu: 'i5' }, software: [{ name: 'Chrome' }] } });
    const data = prisma.agentDevice.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ specs: { cpu: 'i5' }, software: [{ name: 'Chrome' }] });
    expect(data.inventoryAt).toBeInstanceOf(Date);
    expect(out.wantInventory).toBe(false);
  });

  it('inventário com mais de 24h pede novo', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findUnique.mockResolvedValue(dev());
    prisma.agentDevice.update.mockImplementation(async () => dev({ inventoryAt: new Date(Date.now() - 25 * 3600e3) }));
    expect((await s.checkin('x', { hostname: 'h' })).wantInventory).toBe(true);
  });

  it('LINKED sincroniza o ativo', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findUnique
      .mockResolvedValueOnce(dev({ status: 'LINKED' }))
      .mockResolvedValue({ id: 'd1', asset: { id: 'a1' } });
    prisma.agentDevice.update.mockImplementation(({ data }: any) => Promise.resolve({ ...dev({ status: 'LINKED' }), ...data }));
    await s.checkin('x', { hostname: 'h' });
    expect(prisma.asset.update).toHaveBeenCalled();
  });
});
