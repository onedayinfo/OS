import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SurveysService } from './surveys.service.js';
import { RespondSurveyDto } from './dto/respond-survey.dto.js';

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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

  it('respond grava score/comment/respondedAt de forma atômica e devolve os dados públicos', async () => {
    const prisma = makePrisma();
    const service = new SurveysService(prisma as any);
    const result = await service.respond('tok123', { score: 4, comment: 'Ótimo atendimento' });
    expect(prisma.ticketSatisfactionSurvey.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', respondedAt: null },
      data: { score: 4, comment: 'Ótimo atendimento', respondedAt: expect.any(Date) },
    });
    expect(result).toEqual({
      ticketNumber: '2026-0001',
      ticketTitle: 'PC não liga',
      score: null,
      comment: null,
      respondedAt: null,
    });
  });

  it('respond rejeita responder duas vezes (guarda atômica via updateMany)', async () => {
    const prisma = makePrisma({
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1', respondedAt: new Date(), ticket: {} }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const service = new SurveysService(prisma as any);
    await expect(service.respond('tok123', { score: 3 })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RespondSurveyDto', () => {
  it('rejeita score fora de 1-5', async () => {
    const dto = plainToInstance(RespondSurveyDto, { score: 6 });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('aceita score de 1 a 5', async () => {
    const dto = plainToInstance(RespondSurveyDto, { score: 3 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
