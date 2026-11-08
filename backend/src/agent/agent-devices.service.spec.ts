import { AgentDevicesService } from './agent-devices.service.js';

const dev = (o: any = {}) => ({
  id: 'd1', clientId: 'c1', status: 'PENDING', serialNumber: 'SN1', manufacturer: 'Dell', model: 'X',
  ip: '1.1.1.1', mac: 'aa', ...o,
});

const make = (device: any = dev()) => {
  const st = { status: device.status as string };
  const prisma: any = {
    agentDevice: {
      findUnique: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.assetId ? null : { ...device, status: st.status, asset: null })),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        if (where.status && where.status !== st.status) return Promise.resolve({ count: 0 });
        if (data.status) st.status = data.status;
        return Promise.resolve({ count: 1 });
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    asset: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
  };
  const assets: any = { create: vi.fn().mockResolvedValue({ id: 'a1' }) };
  return { prisma, assets, st, s: new AgentDevicesService(prisma, assets) };
};
const body: any = { locationId: 'l1', typeId: 't1', label: 'PC Ana' };

describe('AgentDevicesService', () => {
  it('approve cria ativo com label e serial do dispositivo', async () => {
    const { assets, st, s } = make();
    const out = await s.approve('d1', body);
    expect(out.id).toBe('a1');
    expect(assets.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1', label: 'PC Ana', serialNumber: 'SN1', brand: 'Dell' }),
    );
    expect(st.status).toBe('LINKED');
  });

  it('segundo approve -> 409 e um único asset.create', async () => {
    const { assets, s } = make();
    await s.approve('d1', body);
    await expect(s.approve('d1', body)).rejects.toThrow('Dispositivo já tratado.');
    expect(assets.create).toHaveBeenCalledTimes(1);
  });

  it('approve com serial duplicado propaga erro e volta a PENDING', async () => {
    const { assets, st, s } = make();
    assets.create.mockRejectedValue(new Error('Já existe um ativo com esse número de série para o cliente.'));
    await expect(s.approve('d1', body)).rejects.toThrow('Já existe um ativo');
    expect(st.status).toBe('PENDING');
  });

  it('link em ativo de outro cliente -> 400', async () => {
    const { prisma, s } = make();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a9', clientId: 'c2' });
    await expect(s.link('d1', 'a9')).rejects.toThrow('O ativo não pertence ao mesmo cliente.');
  });

  it('link em ativo já vinculado -> 409', async () => {
    const { prisma, s } = make();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a9', clientId: 'c1' });
    prisma.agentDevice.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.assetId ? { id: 'outro' } : dev()));
    await expect(s.link('d1', 'a9')).rejects.toThrow(/já possui um dispositivo/);
  });

  it('link ok marca LINKED', async () => {
    const { prisma, st, s } = make();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a9', clientId: 'c1' });
    await s.link('d1', 'a9');
    expect(st.status).toBe('LINKED');
    expect(prisma.agentDevice.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { assetId: 'a9' } });
  });

  it('ignore de LINKED -> 409; de PENDING ok; restore volta a PENDING', async () => {
    const linked = make(dev({ status: 'LINKED' }));
    await expect(linked.s.ignore('d1')).rejects.toThrow('Dispositivo já tratado.');
    const m = make();
    await m.s.ignore('d1');
    expect(m.st.status).toBe('IGNORED');
    await m.s.restore('d1');
    expect(m.st.status).toBe('PENDING');
  });

  it('list: suggestedAsset só para PENDING com serial válido; sem tokenHash', async () => {
    const { prisma, s } = make();
    prisma.agentDevice.findMany.mockResolvedValue([
      dev({ id: 'a', serialNumber: 'SN1' }),
      dev({ id: 'b', serialNumber: 'To be filled by O.E.M.' }),
      dev({ id: 'c', status: 'LINKED', serialNumber: 'SN3' }),
    ]);
    prisma.asset.findFirst.mockResolvedValue({ id: 'x', label: 'PC' });
    const { data } = (await s.list({ page: 1, pageSize: 20 } as any)) as { data: any[] };
    expect(data[0].suggestedAsset).toEqual({ id: 'x', label: 'PC' });
    expect(data[1].suggestedAsset).toBeNull();
    expect('suggestedAsset' in data[2]).toBe(false);
    expect(prisma.asset.findFirst).toHaveBeenCalledTimes(1);
    const arg = prisma.agentDevice.findMany.mock.calls[0][0];
    expect(arg.omit.tokenHash).toBe(true);
    expect(arg.orderBy).toBeDefined();
  });
});
