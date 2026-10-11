import { AiClassifierService, AiNotConfiguredError, buildUserPrompt, sanitizeItems } from './ai-classifier.service.js';

describe('buildUserPrompt', () => {
  it('numera só as mensagens novas e separa o contexto', () => {
    const p = buildUserPrompt({
      clientName: 'Acme',
      context: [{ sender: 'Ana', text: 'bom dia' }],
      pending: [{ sender: 'Beto', text: 'a internet caiu' }, { sender: 'Ana', text: 'e o wifi também' }],
    });
    expect(p).toContain('Cliente: Acme');
    expect(p).toContain('Ana: bom dia');
    expect(p).toContain('[0] Beto: a internet caiu');
    expect(p).toContain('[1] Ana: e o wifi também');
    expect(p.indexOf('Contexto')).toBeLessThan(p.indexOf('[0]'));
  });
});

describe('sanitizeItems', () => {
  it('descarta índices fora do intervalo/duplicados e limita faixas', () => {
    const items = sanitizeItems(
      [{ messageIndexes: [0, 0, 7, -1, 1.5, 1], isRequest: true, urgency: 9, sentiment: -3, summary: '  Internet caiu  ' }],
      2,
    );
    expect(items).toEqual([{ messageIndexes: [0, 1], isRequest: true, urgency: 5, sentiment: -1, summary: 'Internet caiu' }]);
  });

  it('item sem nenhum índice válido ou sem resumo é descartado', () => {
    expect(sanitizeItems([{ messageIndexes: [9], isRequest: true, urgency: 3, sentiment: 0, summary: 'x' }], 2)).toEqual([]);
    expect(sanitizeItems([{ messageIndexes: [0], isRequest: true, urgency: 3, sentiment: 0, summary: '   ' }], 2)).toEqual([]);
  });

  it('urgência vira inteira de 1 a 5; lixo vira lista vazia', () => {
    const [i] = sanitizeItems([{ messageIndexes: [0], isRequest: false, urgency: 2.6, sentiment: 0.2, summary: 'ok' }], 1);
    expect(i.urgency).toBe(3);
    expect(sanitizeItems('lixo', 1)).toEqual([]);
    expect(sanitizeItems(null, 1)).toEqual([]);
  });
});

describe('AiClassifierService', () => {
  it('sem chave configurada → AiNotConfiguredError (e nunca chama a API)', async () => {
    const service = new AiClassifierService({ get: vi.fn().mockResolvedValue(undefined) } as any);
    await expect(service.classify({ clientName: 'A', context: [], pending: [{ sender: 'x', text: 'y' }] })).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});
