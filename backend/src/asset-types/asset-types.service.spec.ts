import { AssetTypesService } from './asset-types.service.js';

const makePrisma = () => ({
  assetType: {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({ id: 't1', name: 'Câmera' }),
    findUnique: vi.fn().mockResolvedValue({ id: 't1', name: 'Câmera' }),
    update: vi.fn().mockResolvedValue({ id: 't1', name: 'Câmera IP' }),
  },
});

describe('AssetTypesService', () => {
  it('seed usa createMany com skipDuplicates e a lista padrão', async () => {
    const prisma = makePrisma();
    const service = new AssetTypesService(prisma as any);
    await service.onModuleInit();
    const arg = prisma.assetType.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual(
      expect.arrayContaining([{ name: 'Câmera' }, { name: 'DVR/NVR' }, { name: 'Controladora de acesso' }]),
    );
  });

  it('findAll ordena por name asc', async () => {
    const prisma = makePrisma();
    const service = new AssetTypesService(prisma as any);
    await service.findAll();
    expect(prisma.assetType.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('update lança NotFound quando o tipo não existe', async () => {
    const prisma = makePrisma();
    prisma.assetType.findUnique.mockResolvedValue(null);
    const service = new AssetTypesService(prisma as any);
    await expect(service.update('x', { name: 'y' } as any)).rejects.toThrow('Tipo de ativo não encontrado.');
  });
});
