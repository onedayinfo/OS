import { DEFAULT_PHRASES, normalizePhrase, seedDefaultPhrases } from './seed-phrases.js';

function fake(initialFlag = false, existing: string[] = []) {
  const phrases = existing.map((phraseNorm) => ({ clientId: null, phraseNorm }));
  const state = { flag: initialFlag };
  const prisma = {
    setting: {
      findUnique: vi.fn(async () => (state.flag ? { key: 'whatsapp.defaultPhrasesSeeded', value: 'true' } : null)),
      create: vi.fn(async () => { state.flag = true; return {}; }),
    },
    triggerPhrase: {
      findFirst: vi.fn(async ({ where }: any) => phrases.find((p) => p.clientId === where.clientId && p.phraseNorm === where.phraseNorm) ?? null),
      create: vi.fn(async ({ data }: any) => { phrases.push(data); return data; }),
    },
  };
  return { prisma, phrases, state };
}

describe('seedDefaultPhrases', () => {
  it('tem as 10 frases aprovadas com as prioridades certas', () => {
    expect(DEFAULT_PHRASES.map((p) => [p.phrase, p.priority])).toEqual([
      ['Sistema caiu', 'URGENT'],
      ['Sem conexão', 'HIGH'],
      ['Sem internet', 'HIGH'],
      ['Wi-Fi caiu', 'HIGH'],
      ['Servidor fora do ar', 'URGENT'],
      ['Computador não liga', 'MEDIUM'],
      ['Impressora parada', 'MEDIUM'],
      ['Câmera offline', 'HIGH'],
      ['Alarme disparado', 'URGENT'],
      ['Cerca/portão parado', 'HIGH'],
    ]);
  });

  it('normaliza como o normalizeText do sistema', () => {
    expect(normalizePhrase('  Sem   Conexão ')).toBe('sem conexao');
    expect(normalizePhrase('Cerca/portão parado')).toBe('cerca/portao parado');
  });

  it('primeira execução cria as 10 globais sem categoria e grava a flag', async () => {
    const { prisma, phrases, state } = fake();
    expect(await seedDefaultPhrases(prisma as any)).toEqual({ created: 10, skipped: false });
    expect(phrases).toHaveLength(10);
    expect(phrases[0]).toMatchObject({ clientId: null, phrase: 'Sistema caiu', phraseNorm: 'sistema caiu', priority: 'URGENT', categoryId: null });
    expect(state.flag).toBe(true);
  });

  it('segunda execução não faz nada; apagar uma frase não a ressuscita', async () => {
    const { prisma, phrases } = fake();
    await seedDefaultPhrases(prisma as any);
    phrases.splice(0, 1); // admin apagou "Sistema caiu"
    expect(await seedDefaultPhrases(prisma as any)).toEqual({ created: 0, skipped: true });
    expect(phrases).toHaveLength(9);
  });

  it('não duplica uma frase global que já existe (flag ausente)', async () => {
    const { prisma, phrases } = fake(false, ['sem internet']);
    const r = await seedDefaultPhrases(prisma as any);
    expect(r.created).toBe(9);
    expect(phrases.filter((p) => p.phraseNorm === 'sem internet')).toHaveLength(1);
  });
});
