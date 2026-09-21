import { ConflictException, NotFoundException } from '@nestjs/common';
import { SurveysService } from './surveys.service.js';

describe('SurveysService.createForTicket', () => {
  it('não cria nada se o chamado não tem solicitante', async () => {
    const tx = { ticketSatisfactionSurvey: { findUnique: vi.fn(), create: vi.fn() } } as any;
    const service = new SurveysService({} as any);
    const result = await service.createForTicket(tx, { id: 't1', requesterId: null } as any);
    expect(result).toBeNull();
    expect(tx.ticketSatisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it('não duplica se já existe pesquisa pro chamado', async () => {
    const tx = {
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1' }),
        create: vi.fn(),
      },
    } as any;
    const service = new SurveysService({} as any);
    const result = await service.createForTicket(tx, { id: 't1', requesterId: 'u1' } as any);
    expect(result).toBeNull();
    expect(tx.ticketSatisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it('cria a pesquisa com token quando há solicitante e ainda não existe uma', async () => {
    const tx = {
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 's1', ...data })),
      },
    } as any;
    const service = new SurveysService({} as any);
    const result = await service.createForTicket(tx, { id: 't1', requesterId: 'u1' } as any);
    expect(result).not.toBeNull();
    expect(tx.ticketSatisfactionSurvey.create).toHaveBeenCalledWith({
      data: { ticketId: 't1', publicToken: expect.any(String) },
    });
    expect(result!.publicToken).toHaveLength(48);
  });
});

describe('SurveysService.findByToken / respond', () => {
  function makePrisma(overrides: Record<string, unknown> = {}) {
    return {
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          ticketId: 't1',
          publicToken: 'tok123',
          score: null,
          comment: null,
          respondedAt: null,
          ticket: { number: '2026-0001', title: 'PC não liga' },
        }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 's1', ...data })),
      },
      ...overrides,
    };
  }

  it('findByToken lança NotFoundException pra token inexistente', async () => {
    const prisma = makePrisma({ ticketSatisfactionSurvey: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new SurveysService(prisma as any);
    await expect(service.findByToken('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByToken devolve os dados pro front decidir o que mostrar', async () => {
    const prisma = makePrisma();
    const service = new SurveysService(prisma as any);
    const result = await service.findByToken('tok123');
    expect(result).toEqual({
      ticketNumber: '2026-0001',
      ticketTitle: 'PC não liga',
      score: null,
      comment: null,
      respondedAt: null,
    });
  });

  it('respond grava score/comment/respondedAt', async () => {
    const prisma = makePrisma();
    const service = new SurveysService(prisma as any);
    await service.respond('tok123', { score: 4, comment: 'Ótimo atendimento' });
    expect(prisma.ticketSatisfactionSurvey.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { score: 4, comment: 'Ótimo atendimento', respondedAt: expect.any(Date) },
    });
  });

  it('respond rejeita responder duas vezes', async () => {
    const prisma = makePrisma({
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1', respondedAt: new Date(), ticket: {} }),
        update: vi.fn(),
      },
    });
    const service = new SurveysService(prisma as any);
    await expect(service.respond('tok123', { score: 3 })).rejects.toBeInstanceOf(ConflictException);
  });
});
