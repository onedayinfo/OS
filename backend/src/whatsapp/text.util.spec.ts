import { isTrivial, matchStart, normalizeText } from './text.util.js';

describe('normalizeText', () => {
  it('minúscula, sem acento, espaços colapsados', () => {
    expect(normalizeText('  Sem   Conexão ')).toBe('sem conexao');
  });
});

describe('matchStart', () => {
  it('casa sem acento/caixa e devolve o resto com a pontuação inicial removida', () => {
    expect(matchStart('SEM CONEXÃO - escritório, 3 PCs sem rede', 'sem conexao')).toEqual({
      rest: 'escritório, 3 PCs sem rede',
    });
  });
  it('mensagem só com a frase → resto vazio', () => {
    expect(matchStart('Sistema caiu!', 'sistema caiu')).toEqual({ rest: '' });
  });
  it('espaços extras dentro da frase', () => {
    expect(matchStart('sem   conexão agora', 'sem conexao')).toEqual({ rest: 'agora' });
  });
  it('não casa no meio da mensagem', () => {
    expect(matchStart('o sistema caiu ontem', 'sistema caiu')).toBeNull();
  });
  it('exige fronteira de palavra', () => {
    expect(matchStart('sem conexaoXYZ', 'sem conexao')).toBeNull();
  });
  it('frase vazia nunca casa', () => {
    expect(matchStart('qualquer coisa', '')).toBeNull();
  });
});

describe('isTrivial', () => {
  it.each(['ok', 'Ok!!', '👍', 'bom dia', 'Obrigado', 'kkkk', '  '])('"%s" é trivial', (t) => {
    expect(isTrivial(t)).toBe(true);
  });
  it.each(['caiu', 'sistema caiu', 'a internet está lenta'])('"%s" não é trivial', (t) => {
    expect(isTrivial(t)).toBe(false);
  });
});
