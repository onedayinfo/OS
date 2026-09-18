import { ContractExpiryCron } from './contract-expiry.cron.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    contract: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', email: 'admin@x.test' }]) },
    ...overrides,
  };
  const email = {
    send: vi.fn().mockResolvedValue(undefined),
    brand: vi.fn().mockResolvedValue({}),
  };
  const cron = new ContractExpiryCron(prisma as any, email as any);
  return { cron, prisma, email };
}

describe('ContractExpiryCron', () => {
  it('sem contratos vencendo, não envia nada', async () => {
    const { cron, email } = makeDeps();
    await cron.run();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('envia pra todo ADMIN e marca renewalWarnedAt', async () => {
    const contract = {
      id: 'c1',
      name: 'Contrato X',
      endDate: new Date(Date.now() + 10 * 24 * 3600_000),
      client: { name: 'Cliente Y' },
    };
    const { cron, prisma, email } = makeDeps({
      contract: { findMany: vi.fn().mockResolvedValue([contract]), update: vi.fn() },
    });
    await cron.run();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@x.test', subject: expect.stringContaining('Contrato X') }),
    );
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { renewalWarnedAt: expect.any(Date) },
    });
  });

  it('falha de e-mail não represa a fila: marca renewalWarnedAt mesmo assim', async () => {
    const bad = { id: 'bad', name: 'Ruim', endDate: new Date(), client: { name: 'X' } };
    const good = { id: 'good', name: 'Bom', endDate: new Date(), client: { name: 'Y' } };
    const prisma = {
      contract: {
        findMany: vi.fn().mockResolvedValue([bad, good]),
        update: vi.fn(),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', email: 'admin@x.test' }]) },
    };
    const email = {
      send: vi.fn().mockRejectedValueOnce(new Error('smtp fora')).mockResolvedValue(undefined),
      brand: vi.fn().mockResolvedValue({}),
    };
    const cron = new ContractExpiryCron(prisma as any, email as any);
    await cron.run();
    expect(prisma.contract.update).toHaveBeenCalledTimes(2);
    expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bad' } }));
    expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'good' } }));
  });
});
