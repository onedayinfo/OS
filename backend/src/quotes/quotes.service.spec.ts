import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { QuotesService } from './quotes.service.js';

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomBytes: vi.fn(() => Buffer.from('a'.repeat(24))) };
});

function makePrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    quoteCounter: { upsert: vi.fn().mockResolvedValue({ year: 2026, value: 1 }) },
    quote: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q1', ...data, items: data.items?.create ?? [] })),
    },
    ...(overrides as any).tx,
  };
  return {
    catalogItem: { findMany: vi.fn().mockResolvedValue([{ id: 'ci1', price: 100 }]) },
    ticket: { findUnique: vi.fn().mockResolvedValue({ id: 't1', clientId: 'cli1' }) },
    quote: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'q1',
        clientId: 'cli1',
        items: [{ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 }],
      }),
    },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    tx,
    ...overrides,
  };
}

describe('QuotesService.create', () => {
  it('exige categoryId e title quando não há ticketId', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any, { next: vi.fn().mockResolvedValue(1) } as any);
    await expect(
      service.create({ clientId: 'cli1', items: [{ catalogItemId: 'ci1', quantity: 1 }] }, 'user1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita ticket de outro cliente', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any, { next: vi.fn().mockResolvedValue(1) } as any);
    await expect(
      service.create(
        { clientId: 'outro-cliente', ticketId: 't1', items: [{ catalogItemId: 'ci1', quantity: 1 }] },
        'user1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('usa o preço do catálogo quando unitPrice não é informado', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any, { next: vi.fn().mockResolvedValue(1) } as any);
    await service.create(
      { clientId: 'cli1', ticketId: 't1', items: [{ catalogItemId: 'ci1', quantity: 2 }] },
      'user1',
    );
    expect(prisma.tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { create: [expect.objectContaining({ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 })] },
        }),
      }),
    );
  });

  it('cria orçamento avulso com categoria e título', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any, { next: vi.fn().mockResolvedValue(1) } as any);
    const quote = await service.create(
      { clientId: 'cli1', categoryId: 'cat1', title: 'Instalação nova', items: [{ catalogItemId: 'ci1', quantity: 1, unitPrice: 500 }] },
      'user1',
    );
    expect(quote.id).toBe('q1');
    expect(prisma.tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', version: 1, number: 1 }) }),
    );
  });
});

describe('QuotesService.findOne', () => {
  it('calcula o total a partir dos itens', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any, { next: vi.fn().mockResolvedValue(1) } as any);
    const quote = await service.findOne('q1');
    expect(quote.total).toBe(200);
  });
});

describe('QuotesService.update / send', () => {
  function makeDraftPrisma(overrides: Record<string, unknown> = {}) {
    const base = makePrisma(overrides);
    base.quote.findUnique = vi.fn().mockResolvedValue({
      id: 'q1',
      clientId: 'cli1',
      status: 'DRAFT',
      items: [{ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 }],
    });
    base.tx.quote.update = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q1', ...data }));
    base.tx.quoteItem = { deleteMany: vi.fn(), createMany: vi.fn() };
    return base;
  }

  it('rejeita update fora de DRAFT', async () => {
    const prisma = makeDraftPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'SENT', items: [] });
    const service = new QuotesService(prisma as any, {} as any);
    await expect(service.update('q1', { title: 'X' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('atualiza campos e substitui itens em DRAFT', async () => {
    const prisma = makeDraftPrisma();
    const service = new QuotesService(prisma as any, {} as any);
    await service.update('q1', { title: 'Novo título', items: [{ catalogItemId: 'ci1', quantity: 3, unitPrice: 90 }] });
    expect(prisma.tx.quoteItem.deleteMany).toHaveBeenCalledWith({ where: { quoteId: 'q1' } });
    expect(prisma.tx.quoteItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quoteId: 'q1', catalogItemId: 'ci1', quantity: 3, unitPrice: 90 })],
    });
  });

  it('rejeita enviar orçamento sem itens', async () => {
    const prisma = makeDraftPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'DRAFT', items: [] });
    const service = new QuotesService(prisma as any, {} as any);
    await expect(service.send('q1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('envia DRAFT com itens, marcando SENT + sentAt', async () => {
    const prisma = makeDraftPrisma();
    prisma.quote.update = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q1', ...data }));
    const service = new QuotesService(prisma as any, {} as any);
    await service.send('q1');
    expect(prisma.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'SENT', sentAt: expect.any(Date) },
    });
  });
});

describe('QuotesService.revise', () => {
  function makeSentPrisma() {
    const prisma = makePrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({
      id: 'q1',
      number: 1,
      clientId: 'cli1',
      ticketId: null,
      categoryId: 'cat1',
      title: 'Instalação',
      status: 'SENT',
      version: 1,
      rootQuoteId: null,
      validUntil: null,
      notes: null,
      createdById: 'user1',
      items: [{ catalogItemId: 'ci1', description: null, quantity: 2, unitPrice: 100 }],
    });
    prisma.tx.quote.update = vi.fn();
    return prisma;
  }

  it('rejeita revisar orçamento em DRAFT', async () => {
    const prisma = makeSentPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'DRAFT', items: [] });
    const service = new QuotesService(prisma as any, {} as any);
    await expect(service.revise('q1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('supersede a versão atual e cria uma nova DRAFT com os mesmos itens', async () => {
    const prisma = makeSentPrisma();
    const service = new QuotesService(prisma as any, {} as any);
    await service.revise('q1');
    expect(prisma.tx.quote.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { status: 'SUPERSEDED' } });
    expect(prisma.tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 1,
          version: 2,
          rootQuoteId: 'q1',
          status: 'DRAFT',
          items: { create: [expect.objectContaining({ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 })] },
        }),
      }),
    );
  });
});

describe('QuotesService.approve / reject', () => {
  function makeSentByTokenPrisma(overrides: Record<string, unknown> = {}) {
    const state: Record<string, unknown> = {
      id: 'q1',
      clientId: 'cli1',
      ticketId: null,
      categoryId: 'cat1',
      title: 'Instalação',
      status: 'SENT',
      items: [],
    };
    const tx = {
      quote: {
        update: vi.fn().mockImplementation(({ data }: any) => {
          Object.assign(state, data);
          return Promise.resolve({ ...state });
        }),
      },
    };
    return {
      quote: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...state })),
        update: vi.fn().mockImplementation(({ data }: any) => {
          Object.assign(state, data);
          return Promise.resolve({ ...state });
        }),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
      tx,
      ...overrides,
    };
  }

  it('approve cria o chamado quando o orçamento é avulso', async () => {
    const prisma = makeSentByTokenPrisma();
    const tickets = { createFromQuote: vi.fn().mockResolvedValue({ id: 'novo-ticket' }) };
    const service = new QuotesService(prisma as any, {} as any, tickets as any);
    const result = await service.approve('tok123');
    expect(tickets.createFromQuote).toHaveBeenCalledWith(prisma.tx, {
      clientId: 'cli1',
      categoryId: 'cat1',
      title: 'Instalação',
    });
    expect(prisma.tx.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'APPROVED', approvedAt: expect.any(Date), ticketId: 'novo-ticket' },
    });
    expect(result.status).toBe('APPROVED');
  });

  it('approve não cria chamado quando o orçamento já tem ticketId', async () => {
    const prisma = makeSentByTokenPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({
      id: 'q1', clientId: 'cli1', ticketId: 't-existente', categoryId: null, title: null, status: 'SENT', items: [],
    });
    const tickets = { createFromQuote: vi.fn() };
    const service = new QuotesService(prisma as any, {} as any, tickets as any);
    await service.approve('tok123');
    expect(tickets.createFromQuote).not.toHaveBeenCalled();
    expect(prisma.tx.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'APPROVED', approvedAt: expect.any(Date), ticketId: 't-existente' },
    });
  });

  it('approve em token já resolvido é idempotente (409 com status atual)', async () => {
    const prisma = makeSentByTokenPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'APPROVED' });
    const service = new QuotesService(prisma as any, {} as any, {} as any);
    await expect(service.approve('tok123')).rejects.toMatchObject({ status: 409 });
  });

  it('reject marca REJECTED e não mexe em chamado', async () => {
    const prisma = makeSentByTokenPrisma();
    const service = new QuotesService(prisma as any, {} as any, {} as any);
    await service.reject('tok123');
    expect(prisma.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'REJECTED', rejectedAt: expect.any(Date) },
    });
  });
});
