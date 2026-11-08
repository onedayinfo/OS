import { syncAsset } from './asset-sync.js';

const device = (asset: any) => ({
  id: 'd1', ip: '10.0.0.5', mac: 'AA', manufacturer: 'Dell', model: 'X1', serialNumber: 'SN1',
  specs: { cpu: 'i5' }, lastSeenAt: new Date('2026-01-01'), asset,
});
const make = (asset: any) => {
  const prisma: any = {
    agentDevice: { findUnique: vi.fn().mockResolvedValue(device(asset)) },
    asset: { update: vi.fn().mockResolvedValue({}) },
  };
  return prisma;
};
const FORBIDDEN = ['label', 'description', 'assignedTo', 'notes', 'locationId', 'status'];

describe('syncAsset', () => {
  it('nunca toca campos curados pelo usuário', async () => {
    const prisma = make({ id: 'a1', label: 'L', description: 'D', assignedTo: 'Ana', notes: 'N', locationId: 'l', status: 'ACTIVE', brand: 'B', model: 'M', serialNumber: 'S' });
    await syncAsset(prisma, 'd1');
    const data = prisma.asset.update.mock.calls[0][0].data;
    for (const k of FORBIDDEN) expect(data).not.toHaveProperty(k);
    expect(data).not.toHaveProperty('brand');
    expect(data).not.toHaveProperty('model');
    expect(data).not.toHaveProperty('serialNumber');
    expect(data).toMatchObject({ ip: '10.0.0.5', mac: 'AA', specs: { cpu: 'i5' } });
  });

  it('preenche brand/model/serialNumber quando vazios', async () => {
    const prisma = make({ id: 'a1', brand: null, model: '', serialNumber: null });
    await syncAsset(prisma, 'd1');
    expect(prisma.asset.update.mock.calls[0][0].data).toMatchObject({ brand: 'Dell', model: 'X1', serialNumber: 'SN1' });
  });

  it('P2002 é engolido e repete sem serialNumber', async () => {
    const prisma = make({ id: 'a1', brand: null, model: null, serialNumber: null });
    prisma.asset.update.mockRejectedValueOnce({ code: 'P2002' });
    await syncAsset(prisma, 'd1');
    expect(prisma.asset.update).toHaveBeenCalledTimes(2);
    expect(prisma.asset.update.mock.calls[1][0].data).not.toHaveProperty('serialNumber');
  });

  it('outro erro propaga', async () => {
    const prisma = make({ id: 'a1', serialNumber: null });
    prisma.asset.update.mockRejectedValue(new Error('boom'));
    await expect(syncAsset(prisma, 'd1')).rejects.toThrow('boom');
  });

  it('sem ativo vinculado não faz nada', async () => {
    const prisma = make(null);
    await syncAsset(prisma, 'd1');
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });
});
