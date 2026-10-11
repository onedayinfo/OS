import { ConflictException, NotFoundException } from '@nestjs/common';
import { SuggestionsService, priorityFromUrgency } from './suggestions.service.js';

const suggestion = {
  id: 's1', groupId: 'g1', clientId: 'c1', messageIds: ['m1', 'm2'],
  excerpt: 'Beto: a internet caiu', urgency: 4, summary: 'Internet caiu', status: 'OPEN',
};

function make(over: { found?: any; claimed?: number; createError?: Error } = {}) {
  const prisma = {
    ticketSuggestion: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue('found' in over ? over.found : suggestion),
      updateMany: vi.fn().mockResolvedValue({ count: over.claimed ?? 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsappMessage: {
      findFirst: vi.fn().mockResolvedValue({ senderUserId: 'u7' }),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  };
  const tickets = {
    create: over.createError ? vi.fn().mockRejectedValue(over.createError) : vi.fn().mockResolvedValue({ id: 't1', number: '2026-0001' }),
  };
  return { service: new SuggestionsService(prisma as any, tickets as any), prisma, tickets };
}

describe('priorityFromUrgency', () => {
  it.each([[5, 'URGENT'], [4, 'HIGH'], [3, 'MEDIUM'], [2, 'LOW'], [1, 'LOW']])('urgência %i → %s', (u, p) => {
    expect(priorityFromUrgency(u)).toBe(p);
  });
});

describe('SuggestionsService', () => {
  it('lista por status (padrão OPEN), mais urgentes primeiro', async () => {
    const { service, prisma } = make();
    await service.list();
    const arg = prisma.ticketSuggestion.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'OPEN' });
    expect(arg.orderBy).toEqual([{ urgency: 'desc' }, { createdAt: 'asc' }]);
  });

  it('aceitar cria o chamado WHATSAPP, vincula as mensagens e registra a decisão', async () => {
    const { service, prisma, tickets } = make();
    const t = await service.accept('s1', 'admin1', { categoryId: 'cat1' });
    expect(t.id).toBe('t1');
    expect(tickets.create).toHaveBeenCalledWith({
      origin: 'WHATSAPP', clientId: 'c1', requesterId: 'u7',
      title: 'Internet caiu', description: 'Beto: a internet caiu', categoryId: 'cat1', priority: 'HIGH',
    });
    expect(prisma.ticketSuggestion.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 's1', status: 'OPEN' }, data: { status: 'ACCEPTED', decidedById: 'admin1' },
    });
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['m1', 'm2'] } }, data: { ticketId: 't1' } });
  });

  it('título informado pelo técnico prevalece sobre o resumo', async () => {
    const { service, tickets } = make();
    await service.accept('s1', 'admin1', { title: '  Internet fora do ar  ' });
    expect(tickets.create.mock.calls[0][0].title).toBe('Internet fora do ar');
  });

  it('sugestão inexistente → 404; já decidida → 409 e nenhum chamado criado', async () => {
    const a = make({ found: null });
    await expect(a.service.accept('x', 'u', {})).rejects.toBeInstanceOf(NotFoundException);
    const b = make({ claimed: 0 });
    await expect(b.service.accept('s1', 'u', {})).rejects.toBeInstanceOf(ConflictException);
    expect(b.tickets.create).not.toHaveBeenCalled();
  });

  it('se criar o chamado falha, a sugestão volta para OPEN', async () => {
    const { service, prisma } = make({ createError: new Error('boom') });
    await expect(service.accept('s1', 'u', {})).rejects.toThrow('boom');
    expect(prisma.ticketSuggestion.updateMany).toHaveBeenLastCalledWith({
      where: { id: 's1', status: 'ACCEPTED', ticketId: null },
      data: { status: 'OPEN', decidedById: null, decidedAt: null },
    });
  });

  it('descartar usa a mesma barreira atômica', async () => {
    const { service, prisma } = make();
    await service.discard('s1', 'admin1');
    expect(prisma.ticketSuggestion.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 's1', status: 'OPEN' }, data: { status: 'DISCARDED', decidedById: 'admin1' },
    });
    await expect(make({ claimed: 0 }).service.discard('s1', 'u')).rejects.toBeInstanceOf(ConflictException);
  });

  it('descartar sugestão inexistente → 404 sem tentar a barreira', async () => {
    const { service, prisma } = make({ found: null });
    await expect(service.discard('x', 'u')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ticketSuggestion.updateMany).not.toHaveBeenCalled();
  });
});
