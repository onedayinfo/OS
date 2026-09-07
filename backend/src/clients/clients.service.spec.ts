import { ClientsService } from './clients.service.js';

const makePrisma = () => ({
  client: {
    create: vi.fn().mockResolvedValue({ id: 'c1' }),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
});

describe('ClientsService.create', () => {
  it('normaliza emailDomains para lowercase e sem @ inicial', async () => {
    const prisma = makePrisma();
    const service = new ClientsService(prisma as any);
    await service.create({ name: 'ACME', emailDomains: ['@ACME.com', 'Acme.com.br'] } as any);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailDomains: ['acme.com', 'acme.com.br'] }),
      }),
    );
  });

  it('emailDomains ausente vira []', async () => {
    const prisma = makePrisma();
    const service = new ClientsService(prisma as any);
    await service.create({ name: 'ACME' } as any);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailDomains: [] }) }),
    );
  });
});

describe('ClientsService.findAll', () => {
  it('filtra por q em name (contains, insensitive) e devolve envelope paginado', async () => {
    const prisma = makePrisma();
    prisma.client.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.client.count.mockResolvedValue(1);
    const service = new ClientsService(prisma as any);
    const out = await service.findAll({ page: 2, pageSize: 10, q: 'acme' } as any);
    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { contains: 'acme', mode: 'insensitive' } },
        skip: 10,
        take: 10,
      }),
    );
    expect(out).toEqual({ data: [{ id: 'c1' }], total: 1, page: 2, pageSize: 10 });
  });

  it('sem q não filtra', async () => {
    const prisma = makePrisma();
    const service = new ClientsService(prisma as any);
    await service.findAll({ page: 1, pageSize: 20 } as any);
    expect(prisma.client.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
