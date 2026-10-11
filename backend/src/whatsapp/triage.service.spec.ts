import { AiNotConfiguredError } from './ai-classifier.service.js';
import { TriageService } from './triage.service.js';

const group = { id: 'g1', clientId: 'c1', client: { name: 'Acme' } };
const m = (id: string, body: string, over: any = {}) => ({
  id, body, senderName: 'Beto', senderPhone: '55', sentAt: new Date(`2026-10-11T12:0${id.slice(1)}:00Z`), ...over,
});

function make(over: { pending?: any[]; context?: any[]; paused?: boolean; classify?: any } = {}) {
  const prisma: any = {
    whatsappGroup: { findMany: vi.fn().mockResolvedValue([group]) },
    whatsappMessage: {
      findMany: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.aiStatus === 'PENDING' ? (over.pending ?? []) : (over.context ?? [])),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    ticketSuggestion: { create: vi.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: any) => fn(prisma));
  const classifier = {
    classify: over.classify ?? vi.fn().mockResolvedValue({ items: [], inputTokens: 100, outputTokens: 10 }),
  };
  const usage = { isPaused: vi.fn().mockResolvedValue(over.paused ?? false), add: vi.fn().mockResolvedValue(undefined) };
  return { service: new TriageService(prisma, classifier as any, usage as any), prisma, classifier, usage };
}

describe('TriageService.run', () => {
  it('pausado pelo teto diário → não chama a IA', async () => {
    const { service, classifier } = make({ paused: true, pending: [m('m1', 'a rede caiu')] });
    await service.run();
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('triviais viram SKIPPED e não vão para a IA', async () => {
    const { service, prisma, classifier } = make({ pending: [m('m1', 'ok'), m('m2', 'bom dia')] });
    await service.run();
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
      data: { aiStatus: 'SKIPPED' },
    });
  });

  it('envia pendentes úteis com contexto; cria sugestão e marca ANALYZED', async () => {
    const classify = vi.fn().mockResolvedValue({
      items: [{ messageIndexes: [0, 1], isRequest: true, urgency: 4, sentiment: -0.6, summary: 'Internet caiu no escritório' }],
      inputTokens: 300,
      outputTokens: 40,
    });
    const { service, prisma, usage } = make({
      classify,
      pending: [m('m1', 'a internet caiu'), m('m2', 'ninguém consegue acessar'), m('m3', 'ok')],
      context: [m('m0', 'bom dia pessoal')],
    });
    await service.run();

    const input = classify.mock.calls[0][0];
    expect(input.clientName).toBe('Acme');
    expect(input.pending.map((l: any) => l.text)).toEqual(['a internet caiu', 'ninguém consegue acessar']);
    expect(input.context.map((l: any) => l.text)).toEqual(['bom dia pessoal']);
    expect(usage.add).toHaveBeenCalledWith(300, 40);

    const s = prisma.ticketSuggestion.create.mock.calls[0][0].data;
    expect(s).toMatchObject({ groupId: 'g1', clientId: 'c1', messageIds: ['m1', 'm2'], urgency: 4, summary: 'Internet caiu no escritório' });
    expect(prisma.ticketSuggestion.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000 });
    expect(s.excerpt).toContain('a internet caiu');
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
      data: { aiStatus: 'ANALYZED' },
    });
  });

  it('item que não é pedido não gera sugestão, mas a mensagem é ANALYZED com sentimento', async () => {
    const classify = vi.fn().mockResolvedValue({
      items: [{ messageIndexes: [0], isRequest: false, urgency: 1, sentiment: 0.8, summary: 'Agradecimento' }],
      inputTokens: 50, outputTokens: 5,
    });
    const { service, prisma } = make({ classify, pending: [m('m1', 'muito obrigado pelo atendimento')] });
    await service.run();
    expect(prisma.ticketSuggestion.create).not.toHaveBeenCalled();
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['m1'] } }, data: expect.objectContaining({ sentiment: 0.8 }) }),
    );
  });

  it('IA sem chave → mensagens ficam PENDING, sem contar tentativa', async () => {
    const { service, prisma } = make({
      classify: vi.fn().mockRejectedValue(new AiNotConfiguredError()),
      pending: [m('m1', 'a rede caiu')],
    });
    await service.run();
    expect(prisma.whatsappMessage.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { aiAttempts: { increment: 1 } } }),
    );
  });

  it('erro da IA → conta tentativa e marca FAILED quem chegou a 3', async () => {
    const { service, prisma } = make({
      classify: vi.fn().mockRejectedValue(new Error('rate limit')),
      pending: [m('m1', 'a rede caiu')],
    });
    await service.run();
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] } },
      data: { aiAttempts: { increment: 1 } },
    });
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { groupId: 'g1', aiStatus: 'PENDING', aiAttempts: { gte: 3 } },
      data: { aiStatus: 'FAILED' },
    });
  });

  it('falha ao gravar após a IA → não propaga, conta tentativa, tokens contabilizados', async () => {
    const classify = vi.fn().mockResolvedValue({
      items: [{ messageIndexes: [0], isRequest: true, urgency: 3, sentiment: 0, summary: 'x' }],
      inputTokens: 10, outputTokens: 2,
    });
    const { service, prisma, usage } = make({ classify, pending: [m('m1', 'a rede caiu')] });
    prisma.$transaction.mockRejectedValue(new Error('timeout'));
    await expect(service.run()).resolves.toBeUndefined();
    expect(usage.add).toHaveBeenCalledWith(10, 2);
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] } },
      data: { aiAttempts: { increment: 1 } },
    });
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { groupId: 'g1', aiStatus: 'PENDING', aiAttempts: { gte: 3 } },
      data: { aiStatus: 'FAILED' },
    });
  });

  it('índice fora do intervalo é ignorado; índices mistos mantêm só os válidos', async () => {
    const classify = vi.fn().mockResolvedValue({
      items: [
        { messageIndexes: [5], isRequest: true, urgency: 3, sentiment: 0, summary: 'a' },
        { messageIndexes: [0, 9], isRequest: true, urgency: 3, sentiment: 0, summary: 'b' },
      ],
      inputTokens: 1, outputTokens: 1,
    });
    const { service, prisma } = make({ classify, pending: [m('m1', 'a rede caiu')] });
    await service.run();
    expect(prisma.ticketSuggestion.create).toHaveBeenCalledTimes(1);
    expect(prisma.ticketSuggestion.create.mock.calls[0][0].data.messageIds).toEqual(['m1']);
  });

  it('mensagem com body nulo vira SKIPPED e não vai para a IA', async () => {
    const { service, prisma, classifier } = make({ pending: [m('m1', null as any)] });
    await service.run();
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(prisma.whatsappMessage.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] } },
      data: { aiStatus: 'SKIPPED' },
    });
  });
});
