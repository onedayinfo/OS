import { BadRequestException } from '@nestjs/common';
import { AssetsService } from './assets.service.js';
import * as crypto from '../settings/crypto.util.js';

const baseLocation = { id: 'l1', clientId: 'c1' };
const makePrisma = () => ({
  location: { findUnique: vi.fn().mockResolvedValue(baseLocation) },
  assetType: { findUnique: vi.fn().mockResolvedValue({ id: 't1', active: true }) },
  asset: {
    create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
    findUnique: vi.fn().mockResolvedValue({
      id: 'a1', clientId: 'c1', locationId: 'l1', credentialsEnc: null,
    }),
    update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  ticket: { findMany: vi.fn().mockResolvedValue([]) },
});

describe('AssetsService', () => {
  it('create exige que o local pertença ao cliente', async () => {
    const prisma = makePrisma();
    prisma.location.findUnique.mockResolvedValue({ id: 'l1', clientId: 'OUTRO' });
    const s = new AssetsService(prisma as any);
    await expect(
      s.create({ clientId: 'c1', locationId: 'l1', typeId: 't1', label: 'CAM-01' } as any),
    ).rejects.toThrow('O local informado não pertence ao cliente.');
  });

  it('create cifra credenciais e nunca devolve o segredo', async () => {
    const prisma = makePrisma();
    vi.spyOn(crypto, 'encrypt').mockReturnValue('BLOB');
    const s = new AssetsService(prisma as any);
    const out = await s.create({
      clientId: 'c1', locationId: 'l1', typeId: 't1', label: 'CAM-01',
      credentials: { username: 'admin', password: '1234' },
    } as any);
    expect(prisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ credentialsEnc: 'BLOB' }) }),
    );
    expect(out).not.toHaveProperty('credentialsEnc');
    expect(out.hasCredentials).toBe(true);
  });

  it('serialNumber vazio vira null', async () => {
    const prisma = makePrisma();
    const s = new AssetsService(prisma as any);
    await s.create({ clientId: 'c1', locationId: 'l1', typeId: 't1', label: 'X', serialNumber: '' } as any);
    expect(prisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serialNumber: null }) }),
    );
  });

  it('revealCredentials decifra o blob quando existe', async () => {
    const prisma = makePrisma();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a1', credentialsEnc: 'BLOB' });
    vi.spyOn(crypto, 'decrypt').mockReturnValue('{"username":"admin","password":"1234"}');
    const s = new AssetsService(prisma as any);
    expect(await s.revealCredentials('a1')).toEqual({ username: 'admin', password: '1234' });
  });

  it('revealCredentials devolve nulos quando não há credencial', async () => {
    const prisma = makePrisma();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a1', credentialsEnc: null });
    const s = new AssetsService(prisma as any);
    expect(await s.revealCredentials('a1')).toEqual({ username: null, password: null });
  });

  it('findAll aplica filtros e serializa (sem credentialsEnc)', async () => {
    const prisma = makePrisma();
    prisma.asset.findMany.mockResolvedValue([{ id: 'a1', credentialsEnc: 'BLOB' }]);
    prisma.asset.count.mockResolvedValue(1);
    const s = new AssetsService(prisma as any);
    const out = await s.findAll({ clientId: 'c1', status: 'ACTIVE', page: 1, pageSize: 20 } as any);
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientId: 'c1', status: 'ACTIVE' }) }),
    );
    expect(out.data[0]).not.toHaveProperty('credentialsEnc');
    expect(out.data[0].hasCredentials).toBe(true);
  });
});
