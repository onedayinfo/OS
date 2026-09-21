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
