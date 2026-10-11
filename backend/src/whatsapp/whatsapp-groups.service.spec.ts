import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsappGroupsService } from './whatsapp-groups.service.js';

function make(over: Record<string, any> = {}) {
  const prisma = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'c1' }) },
    whatsappGroup: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'g1', active: true, ...data })),
      update: vi.fn(),
      delete: vi.fn(),
      ...over,
    },
  };
  return { service: new WhatsappGroupsService(prisma as any), prisma };
}

describe('WhatsappGroupsService', () => {
  it('cria com ID válido e apelido aparado', async () => {
    const { service, prisma } = make();
    await service.create({ clientId: 'c1', externalId: ' 120363000000000001@g.us ', name: '  Suporte  ' });
    expect(prisma.whatsappGroup.create.mock.calls[0][0].data).toEqual({
      externalId: '120363000000000001@g.us',
      name: 'Suporte',
      clientId: 'c1',
    });
  });

  it('aceita o formato antigo de ID com hífen', async () => {
    const { service } = make();
    await expect(service.create({ clientId: 'c1', externalId: '5511999990000-1630000000@g.us' })).resolves.toBeDefined();
  });

  it.each(['abc', '5519999991234@s.whatsapp.net', '@g.us', ''])('rejeita ID inválido "%s"', async (externalId) => {
    const { service } = make();
    await expect(service.create({ clientId: 'c1', externalId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cliente inexistente → 404', async () => {
    const { service, prisma } = make();
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.create({ clientId: 'x', externalId: '1203630@g.us' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ID já usado por outro cliente → 409 citando o cliente', async () => {
    const { service, prisma } = make({
      create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      findUnique: vi.fn().mockResolvedValue({ client: { name: 'Acme' } }),
    });
    await expect(service.create({ clientId: 'c1', externalId: '1203630@g.us' })).rejects.toThrow(/Acme/);
    await expect(service.create({ clientId: 'c1', externalId: '1203630@g.us' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.whatsappGroup.findUnique).toHaveBeenCalled();
  });

  it('update atualiza só os campos enviados; remove apaga', async () => {
    const { service, prisma } = make();
    await service.update('g1', { active: false });
    expect(prisma.whatsappGroup.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { active: false } });
    await service.remove('g1');
    expect(prisma.whatsappGroup.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
  });
});
